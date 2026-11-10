#!/usr/bin/env python3
"""Verify a Plane backup or restore ONLY to a new disposable DB and file tree.

Configuration is decrypted into scratch/configuration, never the live plane.env.
A failed restore leaves its disposable DB/scratch directory for investigation.
"""

import argparse
import io
import os
from pathlib import Path
import re
import sys

from backup import (
    Backup,
    BackupError,
    exclusive_lock,
    no_symlinks,
    private_directory,
    safe_extract,
    validate_archive,
    validate_key,
    verify_set,
)


def restore_set(backup_set, root, database, destination):
    if not re.fullmatch(r"plane_restore_[a-z0-9][a-z0-9_]{0,40}", database):
        raise BackupError("restore database must be an explicitly disposable plane_restore_* name")
    backup_set = no_symlinks(backup_set)
    root = no_symlinks(root)
    destination = no_symlinks(destination)
    if destination.exists():
        raise BackupError("restore destination must not exist")
    if destination == root or root in destination.parents:
        raise BackupError("restore destination must be outside live Plane directory")
    verify_set(backup_set)  # No extraction, DB creation or scratch writes before checksums.
    validate_key(root)
    engine = Backup(root)
    config = engine.crypto((backup_set / "config.fernet").read_bytes(), decrypt=True)
    validate_archive(io.BytesIO(config))
    with exclusive_lock(root):
        verify_set(backup_set)
        # createdb refuses existing names; there is deliberately no DROP/--clean path.
        engine.command(
            [
                "exec",
                "-T",
                "plane-db",
                "sh",
                "-ec",
                'exec createdb --host=/var/run/postgresql --no-password --username="$POSTGRES_USER" '
                '--owner="$POSTGRES_USER" --template=template0 "$1"',
                "restore",
                database,
            ]
        )
        private_directory(destination)
        for storage in ("uploads", "minio-state"):
            safe_extract(backup_set / (storage + ".tar"), destination / storage)
        safe_extract(io.BytesIO(config), destination / "configuration")
        with open(backup_set / "database.dump", "rb") as source:
            # subprocess input is bounded by the dump size; use stdin streaming here.
            import subprocess

            environment = os.environ.copy()
            environment.update(PLANE_DEV2_ENV_FILE=str(root / "plane.env"), PLANE_DEV2_PROJECT_NAME="plane-dev2")
            try:
                subprocess.run(
                    [
                        str(root / "deploy/manage.sh"),
                        "exec",
                        "-T",
                        "plane-db",
                        "sh",
                        "-ec",
                        'exec pg_restore --host=/var/run/postgresql --no-password --username="$POSTGRES_USER" '
                        '--dbname="$1" --no-owner --no-acl --exit-on-error',
                        "restore",
                        database,
                    ],
                    stdin=source,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=environment,
                    timeout=900,
                    check=True,
                )
            except (OSError, subprocess.SubprocessError):
                raise BackupError("disposable database restore failed; live database was not modified") from None
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup_set", type=Path)
    parser.add_argument("--root", type=Path, default=Path("/home/plane"))
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--database")
    parser.add_argument("--files", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.verify_only:
            if args.database or args.files:
                raise BackupError("verify-only does not accept restore destinations")
            verify_set(args.backup_set)
            print("Backup checksums and storage archives verified")
        else:
            if not args.database or not args.files:
                raise BackupError("restore requires both --database plane_restore_* and --files NEW_DIRECTORY")
            result = restore_set(args.backup_set, args.root, args.database, args.files)
            print(f"Restored disposable database {args.database}; files: {result}")
    except (BackupError, OSError) as error:
        print(f"Restore failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
