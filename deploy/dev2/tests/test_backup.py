"""Backup safety contracts; Docker is the only external boundary replaced here."""

import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
try:
    import backup
    import restore
except ModuleNotFoundError:
    backup = restore = None


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "plane"
        for name in ("deploy", "private", "data/uploads", "data/minio-state"):
            (self.root / name).mkdir(parents=True, exist_ok=True)
        (self.root / "plane.env").write_text("SECRET_KEY=never-log-this\n")
        (self.root / "plane.env").chmod(0o600)
        (self.root / "deploy/manage.sh").write_text("#!/bin/sh\n")
        (self.root / "deploy/compose.yaml").write_text("services: {}\n")
        (self.root / "private/backup.key").write_bytes(b"MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=\n")
        (self.root / "private/backup.key").chmod(0o600)
        (self.root / "data/uploads/.hidden").write_text("attachment")
        (self.root / "data/minio-state/.metadata").write_text("storage state")
        self.backups = self.base / "backups"

    def engine(
        self,
        fail_dump=False,
        active=False,
        no_control_reply=False,
        dirty_minio=False,
        broker_ready=None,
        broker_unack=0,
        broker_raw=None,
        beat_running=False,
    ):
        self.assertIsNotNone(backup, "backup module has not been implemented")
        engine = backup.Backup(self.root, self.backups, keep=3, drain_timeout=0)
        running = {"api", "worker", "live", "plane-minio", "plane-db", "plane-redis"}
        if beat_running:
            running.add("beat-worker")
        self.resumed = []
        self.events = []
        queue_counts = list(broker_ready or [0])

        def command(args, *, input=None, stdout=None, **kwargs):
            args = list(args)
            self.events.append(args)
            if "list_queues" in " ".join(args):
                if broker_raw is not None:
                    return broker_raw
                count = queue_counts.pop(0) if len(queue_counts) > 1 else queue_counts[0]
                return json.dumps(
                    [{"name": "celery", "messages_ready": count, "messages_unacknowledged": broker_unack}]
                ).encode()
            if args[:2] == ["docker", "inspect"]:
                return json.dumps(
                    {"Running": False, "ExitCode": 137 if dirty_minio else 0, "OOMKilled": dirty_minio}
                ).encode()
            if args[0] == "docker":
                return b"encrypted-config" if input else b""
            if args[:3] == ["ps", "-a", "-q"]:
                return b"b" * 64 + b"\n"
            if args[:3] == ["ps", "--status", "running"]:
                return ("\n".join(sorted(running)) + "\n").encode()
            if args[:2] == ["images", "-q"]:
                return b"sha256:" + b"a" * 64 + b"\n"
            if args[0] == "stop":
                running.difference_update(args[3:])
            elif args[0] == "start":
                self.resumed.extend(args[1:])
                running.update(args[1:])
            elif args[-1] in ("cancel_consumer", "add_consumer"):
                return json.dumps(
                    [] if no_control_reply and args[-1] == "cancel_consumer" else [{"celery@one": {"ok": "done"}}]
                ).encode()
            elif args[-1] in ("active", "reserved", "scheduled"):
                return json.dumps({"celery@one": ([{"id": "busy"}] if active else [])}).encode()
            elif "pg_dump" in " ".join(args):
                if fail_dump:
                    raise backup.BackupError("dump failed")
                stdout.write(b"PGDMP-test-fixture")
            return b""

        engine.command = command
        return engine

    def test_four_successes_keep_latest_three_and_hidden_files(self):
        engine = self.engine()
        sets = [engine.run() for _ in range(4)]
        completed = [p for p in self.backups.iterdir() if p.is_dir() and not p.name.startswith(".")]
        self.assertEqual(set(completed), set(sets[1:]))
        manifest = backup.verify_set(sets[-1])
        self.assertEqual(manifest["status"], "success")
        with tarfile.open(sets[-1] / "uploads.tar") as archive:
            self.assertIn(".hidden", archive.getnames())
        self.assertNotIn("beat-worker", self.resumed)
        self.assertEqual(set(self.resumed), {"api", "worker", "live", "plane-minio"})
        for path in sets[-1].iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_failed_dump_keeps_successes_and_resumes_only_running_services(self):
        engine = self.engine()
        sets = [engine.run() for _ in range(3)]
        engine = self.engine(fail_dump=True)
        with self.assertRaises(backup.BackupError):
            engine.run()
        self.assertTrue(all(p.exists() for p in sets))
        self.assertEqual(set(self.resumed), {"api", "worker", "live", "plane-minio"})
        self.assertNotIn("beat-worker", self.resumed)
        self.assertEqual(len(list(self.backups.glob("*/manifest.json"))), 3)

    def test_recovery_confirms_worker_before_restarting_other_writers(self):
        engine = self.engine(beat_running=True)
        engine.run()
        acknowledged_at = next(i for i, args in enumerate(self.events) if "add_consumer" in args)
        starts = {args[1]: i for i, args in enumerate(self.events) if args[0] == "start"}
        self.assertLess(starts["plane-minio"], acknowledged_at)
        self.assertLess(starts["worker"], acknowledged_at)
        for service in ("api", "live", "beat-worker"):
            self.assertGreater(starts[service], acknowledged_at)

    def test_consumer_recovery_allows_cold_start_longer_than_sixty_seconds(self):
        engine = self.engine()
        clock = [0]
        attempts = []

        def delayed_control(action):
            attempts.append(action)
            clock[0] += 31
            if clock[0] < 90:
                raise backup.BackupError("worker is still starting")
            return [{"celery@one": {"ok": "done"}}]

        with (
            mock.patch.object(engine, "worker_control", side_effect=delayed_control),
            mock.patch("time.monotonic", side_effect=lambda: clock[0]),
            mock.patch("time.sleep", side_effect=lambda seconds: clock.__setitem__(0, clock[0] + seconds)),
        ):
            try:
                engine.resume_consumer()
            except backup.BackupError:
                self.fail("consumer recovery aborted before the cold start finished")
        self.assertGreater(clock[0], 60)
        self.assertEqual(attempts, ["add_consumer", "add_consumer", "add_consumer"])

    def test_persistent_consumer_recovery_failure_restores_writers_without_publication(self):
        initial = self.engine()
        sets = [initial.run() for _ in range(3)]
        engine = self.engine(beat_running=True)

        def fail_consumer_recovery():
            self.events.append(["consumer_resume_failed"])
            raise backup.BackupError("worker never acknowledged")

        with mock.patch.object(engine, "resume_consumer", side_effect=fail_consumer_recovery):
            with self.assertRaisesRegex(backup.BackupError, "resume"):
                engine.run()
        self.assertEqual(set(self.resumed), {"api", "worker", "live", "plane-minio", "beat-worker"})
        failed_at = self.events.index(["consumer_resume_failed"])
        for service in ("api", "live", "beat-worker"):
            self.assertTrue(any(args == ["start", service] for args in self.events[failed_at + 1 :]))
        self.assertTrue(all(path.exists() for path in sets))
        self.assertEqual(len(list(self.backups.glob("*/manifest.json"))), 3)
        self.assertEqual(list(self.backups.glob(".partial-*")), [])

    def test_busy_worker_aborts_without_dump_or_pruning(self):
        engine = self.engine(active=True)
        with self.assertRaisesRegex(backup.BackupError, "drain"):
            engine.run()
        self.assertFalse(any("pg_dump" in " ".join(args) for args in self.events))
        self.assertEqual(set(self.resumed), {"api", "live"})
        self.assertFalse(any("cancel_consumer" in args for args in self.events))
        self.assertFalse(any("add_consumer" in args for args in self.events))
        self.assertFalse(any("purge" in args for args in self.events))

    def test_queued_tasks_drain_with_consumer_active_before_cancellation(self):
        engine = self.engine(broker_ready=[2, 0, 0])
        engine.drain_timeout = 1
        with mock.patch("time.sleep"):
            saved = engine.run()
        self.assertTrue(saved.exists())
        cancelled_at = next(i for i, args in enumerate(self.events) if "cancel_consumer" in args)
        self.assertEqual(sum("list_queues" in " ".join(args) for args in self.events[:cancelled_at]), 2)
        self.assertTrue(any("list_queues" in " ".join(args) for args in self.events[cancelled_at + 1 :]))

    def test_persistent_queued_tasks_abort_without_pruning_or_cancelling(self):
        initial = self.engine()
        sets = [initial.run() for _ in range(3)]
        engine = self.engine(broker_ready=[1])
        with self.assertRaisesRegex(backup.BackupError, "drain"):
            engine.run()
        self.assertTrue(all(path.exists() for path in sets))
        self.assertFalse(any("pg_dump" in " ".join(args) for args in self.events))
        self.assertFalse(any("cancel_consumer" in args for args in self.events))
        self.assertEqual(set(self.resumed), {"api", "live"})

    def test_message_arriving_after_cancellation_aborts_and_resumes(self):
        engine = self.engine(broker_ready=[0, 1])
        with self.assertRaisesRegex(backup.BackupError, "drain"):
            engine.run()
        self.assertFalse(any("pg_dump" in " ".join(args) for args in self.events))
        self.assertTrue(any("add_consumer" in args for args in self.events))
        self.assertEqual(set(self.resumed), {"api", "live"})

    def test_unacknowledged_broker_message_also_prevents_snapshot(self):
        engine = self.engine(broker_unack=1)
        with self.assertRaisesRegex(backup.BackupError, "drain"):
            engine.run()
        self.assertFalse(any("pg_dump" in " ".join(args) for args in self.events))

    def test_unreadable_or_invalid_broker_counts_fail_closed(self):
        for raw in (b"not json", b"{}", b'[{"name":"celery","messages_ready":false,"messages_unacknowledged":0}]'):
            with self.subTest(raw=raw):
                engine = self.engine(broker_raw=raw)
                with self.assertRaisesRegex(backup.BackupError, "broker"):
                    engine.run()
                self.assertFalse(any("pg_dump" in " ".join(args) for args in self.events))
                self.assertEqual(set(self.resumed), {"api", "live"})

    def test_missing_cancel_reply_aborts_and_restores_consumption(self):
        engine = self.engine(no_control_reply=True)
        with self.assertRaisesRegex(backup.BackupError, "worker"):
            engine.run()
        self.assertFalse(any("pg_dump" in " ".join(args) for args in self.events))
        self.assertTrue(any("add_consumer" in args for args in self.events))

    def test_foreign_deployment_manifest_is_never_pruned(self):
        engine = self.engine()
        old = engine.run()
        manifest = json.loads((old / "manifest.json").read_text())
        manifest["deployment"] = "another-project"
        (old / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(backup.BackupError, "manifest"):
            backup.verify_set(old)
        for _ in range(4):
            engine.run()
        self.assertTrue(old.exists())

    def test_successful_restore_only_writes_new_scratch_tree(self):
        engine = self.engine()
        saved = engine.run()
        config = engine.config_archive()
        destination = self.base / "scratch"
        live_env = (self.root / "plane.env").read_bytes()
        with (
            mock.patch.object(backup.Backup, "crypto", return_value=config),
            mock.patch.object(backup.Backup, "command", return_value=b""),
            mock.patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, b"", b"")),
        ):
            restore.restore_set(saved, self.root, "plane_restore_test", destination)
        self.assertEqual((destination / "uploads/.hidden").read_text(), "attachment")
        self.assertEqual((destination / "minio-state/.metadata").read_text(), "storage state")
        self.assertEqual((destination / "configuration/plane.env").read_bytes(), live_env)
        self.assertEqual((self.root / "plane.env").read_bytes(), live_env)
        self.assertFalse((destination / "configuration/private/backup.key").exists())
        self.assertEqual((destination / "configuration/plane.env").stat().st_mode & 0o777, 0o600)

    def test_unclean_minio_stop_aborts_before_any_dump(self):
        engine = self.engine(dirty_minio=True)
        with self.assertRaisesRegex(backup.BackupError, "clean"):
            engine.run()
        self.assertFalse(any("pg_dump" in " ".join(args) for args in self.events))
        self.assertEqual(set(self.resumed), {"api", "worker", "live", "plane-minio"})

    def test_symlink_upload_is_rejected_without_following_target(self):
        engine = self.engine()
        (self.root / "data/uploads/leak").symlink_to(self.root / "plane.env")
        with self.assertRaisesRegex(backup.BackupError, "symlink"):
            engine.run()
        self.assertEqual(list(self.backups.glob("*/manifest.json")), [])

    def test_existing_lock_prevents_service_changes(self):
        engine = self.engine()
        with backup.exclusive_lock(self.root):
            with self.assertRaisesRegex(backup.BackupError, "already"):
                engine.run()
        self.assertEqual(self.events, [])

    def test_insecure_key_or_symlink_is_rejected_before_stopping_services(self):
        engine = self.engine()
        key = self.root / "private/backup.key"
        key.chmod(0o644)
        with self.assertRaisesRegex(backup.BackupError, "key"):
            engine.run()
        self.assertEqual(self.events, [])
        key.unlink()
        key.symlink_to(self.root / "plane.env")
        with self.assertRaisesRegex(backup.BackupError, "symlink"):
            engine.run()

    def test_corrupt_set_is_not_pruned_or_restored(self):
        engine = self.engine()
        old = engine.run()
        (old / "database.dump").write_bytes(b"corrupt")
        for _ in range(4):
            engine.run()
        self.assertTrue(old.exists())
        destination = self.base / "restore"
        with self.assertRaisesRegex(backup.BackupError, "checksum"):
            restore.restore_set(old, self.root, "plane_restore_test", destination)
        self.assertFalse(destination.exists())

    def test_manifest_rejects_traversal_and_duplicate_names(self):
        engine = self.engine()
        saved = engine.run()
        manifest = json.loads((saved / "manifest.json").read_text())
        manifest["files"]["../plane.env"] = manifest["files"]["database.dump"]
        (saved / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(backup.BackupError, "manifest"):
            backup.verify_set(saved)
        (saved / "manifest.json").write_text('{"version":1,"version":1}')
        with self.assertRaisesRegex(backup.BackupError, "duplicate"):
            backup.verify_set(saved)

    def test_safe_extract_rejects_traversal_symlink_and_existing_target(self):
        self.assertIsNotNone(backup, "backup module has not been implemented")
        for name, link in (("../escape", None), ("/absolute", None), ("safe", "../../escape")):
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode="w") as archive:
                item = tarfile.TarInfo(name)
                if link:
                    item.type = tarfile.SYMTYPE
                    item.linkname = link
                archive.addfile(item)
            data.seek(0)
            with self.subTest(name=name), self.assertRaises(backup.BackupError):
                backup.validate_archive(data)
        existing = self.base / "existing"
        existing.mkdir()
        with self.assertRaisesRegex(backup.BackupError, "exist"):
            backup.safe_extract(io.BytesIO(b""), existing)

    def test_restore_requires_disposable_database_and_fresh_directory(self):
        engine = self.engine()
        saved = engine.run()
        for database in ("plane", "postgres", "plane_restore_", "plane_restore_x;DROP DATABASE plane"):
            with self.subTest(database=database), self.assertRaises(backup.BackupError):
                restore.restore_set(saved, self.root, database, self.base / "scratch")
        self.assertFalse((self.base / "scratch").exists())


if __name__ == "__main__":
    unittest.main()
