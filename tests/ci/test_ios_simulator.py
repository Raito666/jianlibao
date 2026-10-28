"""Portable contract tests; these do not execute Xcode or access user data."""
import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ci/ios_simulator.py"


class SimulatorContracts(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), "Missing native simulator verifier")
        spec = importlib.util.spec_from_file_location("ios_simulator", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def fixture(self, *, schema=1, revision=0, payload_revision=0, complete=True):
        directory = tempfile.TemporaryDirectory(prefix="jianlibao-ci-test-")
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "jianlibaoSQLite.db"
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript("CREATE TABLE workspace(id TEXT,revision INTEGER,payload TEXT);"
                             "CREATE TABLE storage_meta(key TEXT,value TEXT);")
            db.execute(f"PRAGMA user_version={schema}")
            data = {"schemaVersion": 2, "revision": payload_revision,
                    "exercises": [{"id": "test"}], "templates": [], "sessions": [], "bodyMetrics": [], "settings": {"showRpe": False}}
            db.execute("INSERT INTO workspace VALUES('main',?,?)", (revision, json.dumps(data)))
            db.execute("INSERT INTO storage_meta VALUES(?,?)", (
                "legacy-indexeddb-v1", json.dumps({"version": 1, "complete": complete, "source": "new"})))
        return path

    def test_selects_available_ios_and_iphone_instead_of_unavailable_or_tvos(self):
        inventory = {"runtimes": [
            {"identifier": "tvOS", "version": "27.0", "isAvailable": True},
            {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-27-0", "version": "27.0", "isAvailable": False},
            {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-0", "version": "26.0", "isAvailable": True}],
            "devicetypes": [{"identifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-16"}]}
        runtime, device = self.module.select_destination(inventory)
        self.assertTrue(runtime.endswith("iOS-26-0"))
        self.assertTrue(device.endswith("iPhone-16"))

    def test_no_available_ios_fails_without_selecting_another_platform(self):
        with self.assertRaisesRegex(ValueError, "iOS"):
            self.module.select_destination({"runtimes": [], "devicetypes": []})

    def test_missing_known_iphone_type_fails(self):
        with self.assertRaisesRegex(ValueError, "iPhone"):
            self.module.select_destination({"runtimes": [{"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-0", "version": "26.0", "isAvailable": True}], "devicetypes": []})

    def test_launch_requires_our_bundle_and_positive_pid(self):
        self.assertEqual(self.module.launch_pid("com.jianlibao.app: 4281\n"), 4281)
        for output in ["other.app: 4281", "com.jianlibao.app: 0", "error 4281", ""]:
            with self.subTest(output=output), self.assertRaises(ValueError):
                self.module.launch_pid(output)

    def test_missing_database_is_not_created(self):
        with tempfile.TemporaryDirectory(prefix="jianlibao-ci-test-") as directory:
            path = Path(directory) / "missing.db"
            with self.assertRaises(FileNotFoundError):
                self.module.read_workspace(path)
            self.assertFalse(path.exists())

    def test_reads_initialized_sqlite_without_exposing_payload(self):
        path = self.fixture()
        first = self.module.read_workspace(path)
        second = self.module.read_workspace(path)
        self.assertEqual(first, second)
        self.assertEqual(first["exerciseCount"], 1)
        self.assertEqual(first["schemaVersion"], 1)
        self.assertEqual(first["payloadSchemaVersion"], 2)
        self.assertEqual(first["sessionCount"], 0)
        self.assertEqual(len(first["payloadSha256"]), 64)
        self.assertNotIn("payload", first)

    def test_revision_mismatch_fails(self):
        with self.assertRaisesRegex(ValueError, "revision"):
            self.module.read_workspace(self.fixture(revision=1))

    def test_unmigrated_payload_and_missing_body_collection_are_not_ready(self):
        for field, value in [("schemaVersion", 1), ("bodyMetrics", None), ("settings", {"showRpe": "false"})]:
            path = self.fixture()
            with closing(sqlite3.connect(path)) as db, db:
                data = json.loads(db.execute("SELECT payload FROM workspace").fetchone()[0])
                data[field] = value
                db.execute("UPDATE workspace SET payload=?", (json.dumps(data),))
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.module.read_workspace(path)

    def test_wrong_schema_or_incomplete_migration_fails(self):
        for options in [{"schema": 2}, {"complete": False}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.module.read_workspace(self.fixture(**options))

    def test_empty_catalog_is_not_ready(self):
        path = self.fixture()
        with closing(sqlite3.connect(path)) as db, db:
            data = json.loads(db.execute("SELECT payload FROM workspace").fetchone()[0])
            data["exercises"] = []
            db.execute("UPDATE workspace SET payload=?", (json.dumps(data),))
        with self.assertRaisesRegex(ValueError, "catalog"):
            self.module.read_workspace(path)

    def test_windows_preflight_stops_before_apple_commands(self):
        with patch.object(self.module.platform, "system", return_value="Windows"), patch.object(self.module, "command") as command:
            with self.assertRaisesRegex(RuntimeError, "macOS"):
                self.module.preflight()
            command.assert_not_called()

    def test_command_parses_stdout_json_when_stderr_contains_warnings(self):
        with tempfile.TemporaryDirectory(prefix="jianlibao-ci-test-") as directory:
            output = Path(directory)
            result = subprocess.CompletedProcess(["xcodebuild"], 0,
                                                 stdout='{"project":{"schemes":["App"]}}\n',
                                                 stderr="SPM diagnostic warning\n")
            with patch.object(self.module, "OUTPUT", output), patch.object(self.module.subprocess, "run", return_value=result) as run:
                listing = json.loads(self.module.command(["xcodebuild"], log="project-list.log"))
            self.assertEqual(listing["project"]["schemes"], ["App"])
            self.assertEqual(run.call_args.kwargs["stderr"], subprocess.PIPE)
            log = (output / "project-list.log").read_text(encoding="utf-8")
            self.assertIn("SPM diagnostic warning", log)
            self.assertIn('"schemes"', log)

    def test_command_preserves_partial_output_when_build_times_out(self):
        with tempfile.TemporaryDirectory(prefix="jianlibao-ci-test-") as directory:
            output = Path(directory)
            error = subprocess.TimeoutExpired(["xcodebuild"], 1,
                                               output=b"Partial build progress\n",
                                               stderr=b"Package diagnostic before timeout\n")
            with patch.object(self.module, "OUTPUT", output), patch.object(self.module.subprocess, "run", side_effect=error):
                with self.assertRaises(subprocess.TimeoutExpired):
                    self.module.command(["xcodebuild"], timeout=1, log="xcodebuild.log")
            log = (output / "xcodebuild.log").read_text(encoding="utf-8")
            self.assertIn("Partial build progress", log)
            self.assertIn("Package diagnostic before timeout", log)


class WorkflowSafety(unittest.TestCase):
    def test_pnpm_is_pinned_per_step_without_overwriting_system_tooling(self):
        data = json.loads((ROOT / "codemagic.yaml").read_text(encoding="utf-8"))
        steps = data["workflows"]["ios-simulator-free"]["scripts"]
        commands = [line for step in steps for line in step["script"].splitlines() if "pnpm" in line]
        self.assertEqual(len(commands), 3)
        for command in commands:
            with self.subTest(command=command):
                self.assertTrue(command.startswith("npx --yes pnpm@11.25.0 "))
                self.assertNotIn("--global", command)
                self.assertNotIn("--force", command)

    def test_shell_steps_stop_on_the_first_failure(self):
        data = json.loads((ROOT / "codemagic.yaml").read_text(encoding="utf-8"))
        steps = data["workflows"]["ios-simulator-free"]["scripts"]
        for step in steps:
            with self.subTest(step=step["name"]):
                self.assertTrue(step["script"].startswith("set -euo pipefail\n"), "A failed command must not be hidden by a later success")

    def test_workflow_is_manual_m2_only_bounded_and_has_no_publishing(self):
        path = ROOT / "codemagic.yaml"
        self.assertTrue(path.is_file(), "Missing manual free-tier workflow")
        # JSON syntax is valid YAML and can be parsed without a new dependency.
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(set(data), {"workflows"})
        self.assertEqual(set(data["workflows"]), {"ios-simulator-free", "webkit-macos-free", "webkit-probe-free", "ios-ui-free"})
        workflow = data["workflows"]["ios-simulator-free"]
        self.assertEqual(workflow["instance_type"], "mac_mini_m2")
        self.assertLessEqual(workflow["max_build_duration"], 45)
        for forbidden in ["triggering", "publishing", "integrations", "environment_groups"]:
            self.assertNotIn(forbidden, workflow)
        self.assertEqual(workflow["environment"], {"xcode": "26.0", "node": "24.19.0"})
        scripts = "\n".join(step["script"] for step in workflow["scripts"])
        self.assertIn("--frozen-lockfile", scripts)
        self.assertIn("ios_simulator.py run", scripts)
        self.assertNotIn("fastlane", scripts)
        self.assertNotIn("app_store_connect", scripts.lower())
        self.assertEqual(workflow["artifacts"], ["artifacts/ios-simulator/*.json", "artifacts/ios-simulator/*.log", "artifacts/ios-simulator/*.png", "artifacts/ios-simulator/*.zip"])


if __name__ == "__main__":
    unittest.main()
