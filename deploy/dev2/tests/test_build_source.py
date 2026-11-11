"""Exercise deployment source checks in disposable Git repositories, without Docker."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


BUILD_SCRIPT = Path(__file__).resolve().parents[1] / "build.sh"


class BuildSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.script = self.repo / "deploy/dev2/build.sh"
        self.script.parent.mkdir(parents=True)
        shutil.copyfile(BUILD_SCRIPT, self.script)
        (self.repo / ".gitignore").write_text(".local/\n")
        (self.repo / "source.txt").write_text("initial\n")
        self.git("init", "--initial-branch=master")
        self.git("config", "user.name", "Deployment source test")
        self.git("config", "user.email", "deployment-test@example.invalid")
        self.git("add", ".")
        self.git("commit", "-m", "Initial source")
        self.git("update-ref", "refs/remotes/origin/master", "HEAD")
        binaries = self.base / "bin"
        binaries.mkdir()
        docker = binaries / "docker"
        docker.write_text('#!/bin/sh\nprintf called > "$DOCKER_CALLED"\nexit 99\n')
        docker.chmod(0o755)
        self.docker_called = self.base / "docker-called"
        self.environment = os.environ.copy()
        self.environment.update(
            PATH=str(binaries) + os.pathsep + os.environ["PATH"], DOCKER_CALLED=str(self.docker_called)
        )
        self.environment.pop("PLANE_DEV2_WEB_SOURCE_REVISION", None)
        self.environment.pop("PLANE_DEV2_ADMIN_SOURCE_REVISION", None)

    def git(self, *arguments):
        return subprocess.check_output(["git", *arguments], cwd=self.repo, stderr=subprocess.DEVNULL, text=True).strip()

    def build(self):
        result = subprocess.run(
            ["bash", str(self.script)], cwd=self.repo, env=self.environment, capture_output=True, text=True
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.docker_called.exists(), "source validation must finish before invoking Docker")
        return result.stderr

    def test_clean_pushed_master_reaches_existing_spa_validation(self):
        self.assertIn("Set PLANE_DEV2_WEB_SOURCE_REVISION", self.build())

    def test_feature_branch_is_rejected(self):
        self.git("switch", "-c", "codex/test")
        self.assertIn("dev2 builds must run from the master branch", self.build())

    def test_preview_branch_is_rejected(self):
        self.git("switch", "-c", "preview")
        self.assertIn("dev2 builds must run from the master branch", self.build())

    def test_detached_head_is_rejected(self):
        self.git("switch", "--detach")
        self.assertIn("dev2 builds must run from the master branch", self.build())

    def test_missing_origin_master_is_rejected(self):
        self.git("update-ref", "-d", "refs/remotes/origin/master")
        self.assertIn("Missing origin/master", self.build())

    def test_unpushed_master_commit_is_rejected(self):
        self.git("commit", "--allow-empty", "-m", "Unpushed commit")
        self.assertIn("HEAD must match origin/master", self.build())

    def test_master_behind_remote_is_rejected(self):
        previous = self.git("rev-parse", "HEAD")
        self.git("commit", "--allow-empty", "-m", "New remote commit")
        self.git("update-ref", "refs/remotes/origin/master", "HEAD")
        self.git("reset", "--hard", previous)
        self.assertIn("HEAD must match origin/master", self.build())

    def test_unstaged_source_change_is_rejected(self):
        (self.repo / "source.txt").write_text("modified\n")
        self.assertIn("Working tree must be clean", self.build())

    def test_staged_source_change_is_rejected(self):
        (self.repo / "source.txt").write_text("modified\n")
        self.git("add", "source.txt")
        self.assertIn("Working tree must be clean", self.build())

    def test_untracked_source_is_rejected(self):
        (self.repo / "untracked.txt").write_text("new source\n")
        self.assertIn("Working tree must be clean", self.build())

    def test_ignored_runtime_files_are_allowed(self):
        private = self.repo / ".local"
        private.mkdir()
        (private / "runtime.env").write_text("EXAMPLE_RUNTIME_SETTING=test\n")
        self.assertIn("Set PLANE_DEV2_WEB_SOURCE_REVISION", self.build())


if __name__ == "__main__":
    unittest.main()
