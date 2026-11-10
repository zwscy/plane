#!/usr/bin/env python3
"""Quiesced Plane backup. Host requirements: Python stdlib and Docker Compose.

Run as root. Keep backup.key separately: encrypted configuration is unrecoverable
without it. Successful sets contain a custom-format DB dump, complete storage
archives (including hidden files), encrypted configuration and a checksum manifest.
"""

import argparse
import base64
import binascii
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
import uuid


class BackupError(RuntimeError):
    pass


ARTIFACTS = {"database.dump", "uploads.tar", "minio-state.tar", "config.fernet"}
SET_NAME = re.compile(r"\d{8}T\d{12}Z-[0-9a-f]{8}\Z")
WRITERS = ("api", "live", "beat-worker")
CONFIG_LIMIT = 16 * 1024 * 1024


def no_symlinks(path):
    """Reject symlinks in every existing component, including parent directories."""
    path = Path(os.path.abspath(path))
    for item in reversed((path, *path.parents)):
        try:
            mode = item.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode):
            raise BackupError("symlink paths are not allowed")
    return path


def private_directory(path):
    path = no_symlinks(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir():
        raise BackupError("expected a directory")
    path.chmod(0o700)
    return path


def private_write(path, data):
    path = no_symlinks(path)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def validate_key(root):
    key = no_symlinks(Path(root) / "private/backup.key")
    try:
        info = key.stat()
        contents = key.read_bytes().strip()
        decoded = base64.b64decode(contents, altchars=b"-_", validate=True)
    except (OSError, ValueError, binascii.Error):
        raise BackupError("backup key is missing or invalid") from None
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or len(decoded) != 32 or len(contents) != 44:
        raise BackupError("backup key must be a private 0600 Fernet key")
    return key


@contextmanager
def exclusive_lock(root):
    directory = private_directory(Path(root) / "private")
    path = no_symlinks(directory / "backup.lock")
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError("a backup or restore is already running") from None
        yield
    finally:
        os.close(descriptor)


def checked_tree(directory):
    directory = no_symlinks(directory)
    if not directory.is_dir():
        raise BackupError("required source directory is missing")
    result = []
    for current, directories, files in os.walk(directory, followlinks=False):
        for name in sorted(directories + files):
            path = Path(current) / name
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                raise BackupError("symlink entries are not allowed in backups")
            if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise BackupError("special files are not allowed in backups")
            result.append(path)
    return sorted(result)


def add_tree(archive, source, prefix=""):
    for path in checked_tree(source):
        name = str(PurePosixPath(prefix) / path.relative_to(source).as_posix())
        archive.add(path, arcname=name, recursive=False)


def archive_tree(source, destination):
    no_symlinks(destination)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        with tarfile.open(fileobj=output, mode="w") as archive:
            add_tree(archive, source)
        output.flush()
        os.fsync(output.fileno())


def validate_archive(source):
    """Only regular files/directories, no traversal, duplicate names or links."""
    if hasattr(source, "seek"):
        source.seek(0)
    try:
        with tarfile.open(
            fileobj=source if hasattr(source, "read") else None,
            name=None if hasattr(source, "read") else str(source),
            mode="r:*",
        ) as archive:
            seen = set()
            for member in archive:
                name = PurePosixPath(member.name)
                if (
                    name.is_absolute()
                    or ".." in name.parts
                    or not name.parts
                    or "\\" in member.name
                    or member.name in seen
                    or not (member.isfile() or member.isdir())
                    or member.name != name.as_posix()
                ):
                    raise BackupError("unsafe archive member")
                seen.add(member.name)
    except (OSError, tarfile.TarError):
        raise BackupError("invalid archive") from None
    if hasattr(source, "seek"):
        source.seek(0)


def safe_extract(source, destination):
    destination = no_symlinks(destination)
    if destination.exists():
        raise BackupError("restore destination must not exist")
    validate_archive(source)
    private_directory(destination)
    with tarfile.open(
        fileobj=source if hasattr(source, "read") else None,
        name=None if hasattr(source, "read") else str(source),
        mode="r:*",
    ) as archive:
        for member in archive:
            target = destination.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                private_directory(target)
            else:
                private_directory(target.parent)
                with archive.extractfile(member) as content:
                    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                    with os.fdopen(descriptor, "wb") as output:
                        shutil.copyfileobj(content, output)


def digest(path):
    result = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BackupError("duplicate manifest key")
        result[key] = value
    return result


def verify_set(directory, expected_name=None):
    directory = no_symlinks(directory)
    name = expected_name or directory.name
    if not directory.is_dir() or not SET_NAME.fullmatch(name) or directory.name not in (name, ".partial-" + name):
        raise BackupError("invalid backup set name")
    manifest_file = no_symlinks(directory / "manifest.json")
    try:
        if manifest_file.stat().st_size > 64 * 1024:
            raise BackupError("invalid manifest size")
        manifest = json.loads(manifest_file.read_text(), object_pairs_hook=unique_object)
    except (OSError, ValueError):
        raise BackupError("invalid manifest") from None
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"version", "deployment", "status", "set", "created_utc", "files"}
        or type(manifest.get("version")) is not int
        or manifest.get("version") != 1
        or manifest.get("deployment") != "plane-dev2"
        or manifest.get("status") != "success"
        or manifest.get("set") != name
        or not isinstance(manifest.get("created_utc"), str)
        or not isinstance(manifest.get("files"), dict)
        or set(manifest["files"]) != ARTIFACTS
    ):
        raise BackupError("invalid manifest")
    if {p.name for p in directory.iterdir()} != ARTIFACTS | {"manifest.json"}:
        raise BackupError("unexpected files in backup set")
    for name, metadata in manifest["files"].items():
        if (
            not isinstance(metadata, dict)
            or set(metadata) != {"sha256", "size"}
            or not isinstance(metadata["sha256"], str)
            or not re.fullmatch(r"[0-9a-f]{64}", metadata["sha256"])
            or type(metadata["size"]) is not int
            or metadata["size"] < 1
        ):
            raise BackupError("invalid manifest file record")
        artifact = no_symlinks(directory / name)
        if (
            not artifact.is_file()
            or artifact.stat().st_size != metadata["size"]
            or digest(artifact) != metadata["sha256"]
        ):
            raise BackupError("backup checksum mismatch")
    for name in ("uploads.tar", "minio-state.tar"):
        validate_archive(directory / name)
    return manifest


def prune(backups, keep):
    completed = []
    for directory in backups.iterdir():
        if directory.is_symlink() or not directory.is_dir() or not SET_NAME.fullmatch(directory.name):
            continue
        try:
            verify_set(directory)
        except BackupError:
            continue
        completed.append(directory)
    for directory in sorted(completed, reverse=True)[keep:]:
        shutil.rmtree(directory)


class Backup:
    def __init__(self, root=Path("/home/plane"), backups=Path("/www/backup/plane"), keep=3, drain_timeout=120):
        self.root = no_symlinks(root)
        self.backups = no_symlinks(backups)
        self.keep = keep
        self.drain_timeout = drain_timeout
        if keep < 1 or drain_timeout < 0:
            raise BackupError("keep must be positive and drain timeout nonnegative")

    def command(self, args, *, input=None, stdout=None, timeout=180):
        environment = os.environ.copy()
        environment.update(PLANE_DEV2_ENV_FILE=str(self.root / "plane.env"), PLANE_DEV2_PROJECT_NAME="plane-dev2")
        invocation = list(args) if args[0] == "docker" else [str(self.root / "deploy/manage.sh"), *args]
        try:
            result = subprocess.run(
                invocation,
                input=input,
                stdout=stdout or subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
                timeout=timeout,
                check=True,
            )
        except (OSError, subprocess.SubprocessError):
            # Compose diagnostics may include expanded credentials. Keep logs secret-free.
            raise BackupError("deployment command failed or timed out") from None
        return result.stdout or b""

    def crypto(self, data, decrypt=False):
        key = validate_key(self.root)
        image = self.command(["images", "-q", "api"]).decode().strip()
        if not re.fullmatch(r"(?:sha256:)?[0-9a-f]{12,64}", image):
            raise BackupError("expected exactly one existing backend image")
        operation = "decrypt" if decrypt else "encrypt"
        program = (
            "import sys; from cryptography.fernet import Fernet; "
            "key=open('/run/backup.key','rb').read().strip(); "
            f"sys.stdout.buffer.write(Fernet(key).{operation}(sys.stdin.buffer.read()))"
        )
        return self.command(
            [
                "docker",
                "run",
                "--rm",
                "--interactive",
                "--network",
                "none",
                "--memory",
                "128m",
                "--cpus",
                ".25",
                "--cgroup-parent",
                "plane-dev2.slice",
                "--user",
                "0",
                "--mount",
                f"type=bind,src={key},dst=/run/backup.key,readonly",
                "--entrypoint",
                "python",
                image,
                "-c",
                program,
            ],
            input=data,
        )

    def config_archive(self):
        env = no_symlinks(self.root / "plane.env")
        if not env.is_file() or env.stat().st_mode & 0o077:
            raise BackupError("plane.env must be a private regular file")
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w") as archive:
            archive.add(env, arcname="plane.env", recursive=False)
            add_tree(archive, self.root / "deploy", "deploy")
        contents = output.getvalue()
        if len(contents) > CONFIG_LIMIT:
            raise BackupError("deployment configuration exceeds size limit")
        return contents

    def worker_control(self, action):
        # A separate container avoids adding another Django process to worker's cap.
        program = (
            "import json,sys; from plane.celery import app; action=sys.argv[1]; "
            "result=(getattr(app.control.inspect(timeout=5),action)() if action in "
            "('active','reserved','scheduled') else "
            "getattr(app.control,action)('celery',reply=True,timeout=5)); print(json.dumps(result))"
        )
        raw = self.command(["run", "--rm", "--no-deps", "-T", "worker", "python", "-c", program, action], timeout=30)
        try:
            result = json.loads(raw)
        except (ValueError, TypeError):
            raise BackupError("worker control returned invalid JSON") from None
        if action in ("cancel_consumer", "add_consumer"):
            if (
                not isinstance(result, list)
                or len(result) != 1
                or not isinstance(result[0], dict)
                or len(result[0]) != 1
                or not all(isinstance(reply, dict) and "ok" in reply for reply in result[0].values())
            ):
                raise BackupError("worker did not acknowledge consumer state change")
        return result

    def resume_consumer(self):
        deadline = time.monotonic() + 180
        while True:
            try:
                self.worker_control("add_consumer")
                return
            except BackupError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(2)

    def broker_busy(self):
        # Limit the CLI Erlang VM separately from the already bounded broker VM.
        raw = self.command(
            [
                "exec",
                "-T",
                "plane-mq",
                "sh",
                "-ec",
                'RABBITMQ_CTL_ERL_ARGS="+S 1:1" rabbitmqctl --quiet --timeout 10 list_queues '
                '--vhost "$RABBITMQ_DEFAULT_VHOST" name messages_ready messages_unacknowledged --formatter json',
            ],
            timeout=20,
        )
        try:
            queues = json.loads(raw)
        except (ValueError, TypeError):
            raise BackupError("broker drain inspection returned invalid JSON") from None
        if not isinstance(queues, list) or any(
            not isinstance(queue, dict)
            or not isinstance(queue.get("name"), str)
            or any(
                type(queue.get(field)) is not int or queue[field] < 0
                for field in ("messages_ready", "messages_unacknowledged")
            )
            for queue in queues
        ):
            raise BackupError("broker drain inspection returned invalid queue counts")
        return any(queue["messages_ready"] or queue["messages_unacknowledged"] for queue in queues)

    def drain(self, timeout=None):
        deadline = time.monotonic() + (self.drain_timeout if timeout is None else timeout)
        while True:
            busy = False
            for kind in ("active", "reserved", "scheduled"):
                states = self.worker_control(kind)
                if (
                    not isinstance(states, dict)
                    or len(states) != 1
                    or not all(isinstance(value, list) for value in states.values())
                ):
                    raise BackupError("worker drain requires exactly one responding worker")
                busy = busy or any(states.values())
            busy = self.broker_busy() or busy
            if not busy:
                return
            if time.monotonic() >= deadline:
                raise BackupError("worker/broker drain timed out; queue was preserved")
            time.sleep(min(2, max(0, deadline - time.monotonic())))

    def require_clean_storage_stop(self):
        container = self.command(["ps", "-a", "-q", "plane-minio"]).decode().strip()
        if not re.fullmatch(r"[0-9a-f]{12,64}", container):
            raise BackupError("cannot verify clean object-storage shutdown")
        try:
            state = json.loads(self.command(["docker", "inspect", "--format", "{{json .State}}", container]))
        except (ValueError, TypeError):
            raise BackupError("cannot verify clean object-storage shutdown") from None
        if (
            not isinstance(state, dict)
            or state.get("Running") is not False
            or state.get("OOMKilled") is not False
            or state.get("ExitCode") not in (0, 143)
        ):
            raise BackupError("object storage did not stop cleanly; backup aborted")

    def run(self):
        validate_key(self.root)
        # Validate owned source paths before any service state changes.
        config = self.config_archive()
        for name in ("uploads", "minio-state"):
            checked_tree(self.root / "data" / name)
        with exclusive_lock(self.root):
            private_directory(self.backups)
            name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ-") + uuid.uuid4().hex[:8]
            partial = private_directory(self.backups / (".partial-" + name))
            final = self.backups / name
            stopped = []
            consumer_cancelled = False
            original_error = None
            try:
                running = set(self.command(["ps", "--status", "running", "--services"]).decode().split())
                if "migrator" in running:
                    raise BackupError("cannot back up while migrations are running")
                if "plane-db" not in running:
                    raise BackupError("dedicated PostgreSQL must already be running")
                for service in WRITERS:
                    if service in running:
                        stopped.append(service)
                        self.command(["stop", "-t", "30", service])
                if "worker" in running:
                    # Let ready messages finish before disabling further deliveries.
                    self.drain()
                    consumer_cancelled = True
                    self.worker_control("cancel_consumer")
                    # A producer/task racing cancellation must abort, never be lost.
                    self.drain(timeout=0)
                    stopped.append("worker")
                    self.command(["stop", "-t", "30", "worker"])
                elif self.broker_busy():
                    raise BackupError("broker drain requires its previously stopped worker; backup aborted")
                if "plane-minio" in running:
                    stopped.append("plane-minio")
                    self.command(["stop", "-t", "30", "plane-minio"])
                self.require_clean_storage_stop()
                # All application writers and MinIO are now paused in this one window.
                dump = partial / "database.dump"
                descriptor = os.open(dump, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(descriptor, "wb") as output:
                    self.command(
                        [
                            "exec",
                            "-T",
                            "plane-db",
                            "sh",
                            "-ec",
                            'exec pg_dump --host=/var/run/postgresql --no-password --username="$POSTGRES_USER" '
                            "--dbname=plane --format=custom --no-owner --no-acl",
                        ],
                        stdout=output,
                        timeout=900,
                    )
                    output.flush()
                    os.fsync(output.fileno())
                for storage in ("uploads", "minio-state"):
                    archive_tree(self.root / "data" / storage, partial / (storage + ".tar"))
                private_write(partial / "config.fernet", self.crypto(config))
            except BaseException as error:
                original_error = error
            finally:
                # start (not up) cannot pull in previously stopped dependencies.
                resume_errors = []
                # Restore the consumer before cold-starting the other writers.
                for service in ("plane-minio", "worker"):
                    if service in stopped:
                        try:
                            self.command(["start", service])
                        except BaseException as error:
                            resume_errors.append(error)
                if consumer_cancelled:
                    try:
                        self.resume_consumer()
                    except BaseException as error:
                        resume_errors.append(error)
                # An acknowledgment failure must not leave other services paused.
                for service in reversed(stopped):
                    if service not in ("plane-minio", "worker"):
                        try:
                            self.command(["start", service])
                        except BaseException as error:
                            resume_errors.append(error)
                if resume_errors:
                    original_error = BackupError(
                        "backup failed to resume one or more previously running services; inspect project"
                    )
                if original_error is not None:
                    shutil.rmtree(partial)
            if original_error is not None:
                raise original_error
            metadata = {
                artifact: {"size": (partial / artifact).stat().st_size, "sha256": digest(partial / artifact)}
                for artifact in sorted(ARTIFACTS)
            }
            manifest = {
                "version": 1,
                "deployment": "plane-dev2",
                "status": "success",
                "set": name,
                "created_utc": datetime.now(timezone.utc).isoformat(),
                "files": metadata,
            }
            private_write(partial / "manifest.json", (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode())
            # Verify before publishing, and verify again before any retention deletion.
            verify_set(partial, expected_name=name)
            os.rename(partial, final)
            directory_fd = os.open(self.backups, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            prune(self.backups, self.keep)
            return final


def interrupted(signum, frame):
    raise BackupError("backup interrupted")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/home/plane"))
    parser.add_argument("--backups", type=Path, default=Path("/www/backup/plane"))
    parser.add_argument("--keep", type=int, default=3)
    parser.add_argument("--drain-timeout", type=int, default=120)
    args = parser.parse_args()
    os.umask(0o077)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, interrupted)
    try:
        completed = Backup(args.root, args.backups, args.keep, args.drain_timeout).run()
    except (BackupError, OSError) as error:
        print(f"Backup failed: {error}", file=sys.stderr)
        return 1
    print(f"Verified backup: {completed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
