import importlib.util
import json
import tempfile
import subprocess
import zipfile
from copy import deepcopy
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


class NativeUIContracts(unittest.TestCase):
    def test_manual_native_ui_workflow_is_private_free_tier_safe_and_retains_evidence(self):
        workflows = json.loads((ROOT / "codemagic.yaml").read_text(encoding="utf-8"))["workflows"]
        workflow = workflows["ios-ui-free"]
        self.assertEqual(workflow["instance_type"], "mac_mini_m2")
        self.assertLessEqual(workflow["max_build_duration"], 45)
        self.assertEqual(workflow["environment"], {"xcode": "26.0", "node": "24.19.0"})
        for forbidden in ["publishing", "triggering", "integrations", "environment_groups"]:
            self.assertNotIn(forbidden, workflow)
        scripts = "\n".join(step["script"] for step in workflow["scripts"])
        self.assertIn("ios_ui_acceptance.py full", scripts)
        self.assertIn("--frozen-lockfile", scripts)
        self.assertIn("unittest discover", scripts)
        self.assertIn("ios:sync", scripts)
        self.assertIn("artifacts/ios-ui/*.zip", workflow["artifacts"])

    def setUp(self):
        spec = importlib.util.spec_from_file_location("ui_acceptance", ROOT / "scripts/ci/ios_ui_acceptance.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_zero_skipped_failed_or_incomplete_native_results_are_not_accepted(self):
        valid = {"result": "Passed", "totalTestCount": 1, "passedTests": 1, "failedTests": 0, "skippedTests": 0,
                 "expectedFailures": 0, "testFailures": []}
        self.assertTrue(self.module.summary_valid(valid))
        for field, value in [("result", "Failed"), ("totalTestCount", 0), ("passedTests", 0), ("failedTests", 1),
                             ("skippedTests", 1), ("expectedFailures", 1), ("testFailures", [{"message": "hidden failure"}]),
                             ("passedTests", True)]:
            bad = {**valid, field: value}
            with self.subTest(field=field):
                self.assertFalse(self.module.summary_valid(bad))
        self.assertFalse(self.module.summary_valid({}))
        valid["devicesAndConfigurations"] = [{"device": {"deviceId": "owned"}, "passedTests": 1,
                                              "failedTests": 0, "skippedTests": 0, "expectedFailures": 0}]
        self.assertTrue(self.module.summary_valid(valid, "owned"))
        self.assertFalse(self.module.summary_valid(valid, "foreign"))

    def test_phase_evidence_requires_every_named_png_and_accessibility_tree(self):
        spec = importlib.util.spec_from_file_location("png_fixture", ROOT / "tests/ci/test_simulator_frames.py")
        fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
        with tempfile.TemporaryDirectory(prefix="jlb-ui-evidence-") as directory:
            root = Path(directory)
            for name in self.module.required_evidence("reopened"):
                (root / (name + ".png")).write_bytes(fixture.png(home=True))
                (root / (name + ".txt")).write_text("Application 'com.jianlibao.app' label '健力宝'", encoding="utf-8")
            self.assertEqual(len(self.module.verify_evidence(root, "reopened")), 6)
            last = root / "reopened-home.png"
            last.write_bytes(fixture.png())
            with self.assertRaises(ValueError): self.module.verify_evidence(root, "reopened")
            last.write_bytes(fixture.png(home=True))
            (root / "reopened-home.txt").unlink()
            with self.assertRaises(ValueError): self.module.verify_evidence(root, "reopened")

    def test_persistence_requires_same_container_complete_data_and_hash(self):
        before = {"container": "/owned/simulator/data/app", "payloadSha256": "a" * 64,
                  "data": {"sessions": [{"id": "s", "note": "actual UI input"}], "bodyMetrics": [{"id": "b", "weightKg": 72.6}]}}
        self.module.assert_same_state(before, deepcopy(before))
        for field, value in [("container", "/different/container"), ("payloadSha256", "b" * 64),
                             ("data", {"sessions": [{"id": "s", "note": "lost input"}], "bodyMetrics": [{"id": "b", "weightKg": 72.6}]})]:
            after = {**deepcopy(before), field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.module.assert_same_state(before, after)

    def test_windows_execution_stops_without_running_apple_commands(self):
        with patch.object(self.module.platform, "system", return_value="Windows"), patch.object(self.module, "command") as command:
            with self.assertRaisesRegex(RuntimeError, "macOS"):
                self.module.run("probe")
            command.assert_not_called()

    def test_saved_ui_records_require_actual_set_values_notes_and_body_measurements(self):
        data = {"sessions": [{"status": "completed", "note": "SIM-TRAIN-20261022", "exercises": [
            {"exercise": {"id": "ex-squat", "name": "杠铃深蹲"}, "note": "SIM-EX-20261022", "sets": [
                {"type": "work", "status": "completed", "weightKg": 40, "reps": 8},
                {"type": "work", "status": "skipped", "weightKg": 40, "reps": 8}]}]}],
            "bodyMetrics": [{"weightKg": 72.6, "bodyFatPct": 18.5, "note": "SIM-BODY-20261022",
                             "measurements": {"chest": 98, "waist": 80, "hip": 96, "arm": 34, "thigh": 55}}]}
        self.module.assert_saved_records(data)
        mutations = []
        for key, value in [("status", "active"), ("note", "")]:
            bad = deepcopy(data); bad["sessions"][0][key] = value; mutations.append(bad)
        bad = deepcopy(data); bad["sessions"][0]["exercises"][0]["sets"][0]["weightKg"] = 0; mutations.append(bad)
        bad = deepcopy(data); bad["bodyMetrics"][0]["measurements"]["waist"] = 0; mutations.append(bad)
        bad = deepcopy(data); bad["bodyMetrics"][0]["weightKg"] = 72.4; mutations.append(bad)
        bad = deepcopy(data); bad["sessions"].append(deepcopy(bad["sessions"][0])); mutations.append(bad)
        for index, bad in enumerate(mutations):
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.module.assert_saved_records(bad)

    def test_command_timeout_keeps_partial_native_log(self):
        with tempfile.TemporaryDirectory(prefix="jlb-ui-timeout-") as directory:
            with patch.object(self.module, "OUTPUT", Path(directory)), patch.object(self.module.subprocess, "run",
                    side_effect=subprocess.TimeoutExpired(["xcodebuild"], 1, output=b"Partial native UI output", stderr=b"Timeout diagnostic")):
                with self.assertRaises(subprocess.TimeoutExpired):
                    self.module.command(["xcodebuild"], timeout=1, log="partial.log")
            self.assertIn("Partial native UI output", (Path(directory) / "partial.log").read_text())
            self.assertIn("Timeout diagnostic", (Path(directory) / "partial.log").read_text())

    def test_cleanup_timeout_still_archives_native_failure_evidence(self):
        with tempfile.TemporaryDirectory(prefix="jlb-ui-cleanup-") as directory:
            output = Path(directory); (output / "ui.txt").write_text("retained AX")
            result = {"status": "passed", "nativeInteractionsAccepted": True}
            with patch.object(self.module, "OUTPUT", output), patch.object(self.module.subprocess, "run",
                    side_effect=subprocess.TimeoutExpired(["xcrun"], 60)):
                with self.assertRaisesRegex(RuntimeError, "cleanup"):
                    self.module.finish_run(result, "owned-simulator")
            with zipfile.ZipFile(output / "evidence.zip") as archive:
                self.assertEqual(archive.read("ui.txt"), b"retained AX")
                recorded = json.loads(archive.read("ui-result.json"))
                self.assertFalse(recorded["nativeInteractionsAccepted"])
                self.assertEqual(recorded["status"], "failed")

    def test_thin_capture_archive_preserves_results_without_xcresult_video_or_harness(self):
        with tempfile.TemporaryDirectory(prefix="jlb-four-captures-") as directory:
            root = Path(directory)
            entries = {
                "ui-result.json": '{"nativeInteractionsAccepted":false}',
                "created/home.png": "native PNG fixture",
                "created/home.txt": "actual native AX",
                "created.log": "strict assertion failure",
                "created.xcresult/Data/video.txt": "raw video data",
                "UITestDerivedData/private.json": "build data",
                "UITestHarness/source.txt": "harness source",
            }
            for name, text in entries.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            self.module.archive_evidence(root)
            with zipfile.ZipFile(root / "captures.zip") as archive:
                self.assertEqual(set(archive.namelist()), {"ui-result.json", "created/home.png", "created/home.txt", "created.log"})
                self.assertFalse(json.loads(archive.read("ui-result.json"))["nativeInteractionsAccepted"])
            with zipfile.ZipFile(root / "evidence.zip") as archive:
                self.assertIn("created.xcresult/Data/video.txt", archive.namelist())
                self.assertNotIn("captures.zip", archive.namelist())
                self.assertNotIn("UITestDerivedData/private.json", archive.namelist())
                self.assertNotIn("UITestHarness/source.txt", archive.namelist())

    def test_async_save_waits_for_expected_fields_before_stabilizing(self):
        calls = [{"data": {"sessions": []}, "payloadSha256": "a"},
                 {"data": {"saved": True}, "payloadSha256": "b"},
                 {"data": {"saved": True}, "payloadSha256": "b"}]
        def check(data):
            if not data.get("saved"): raise ValueError("Not saved yet")
        with patch.object(self.module, "read_state", side_effect=calls), patch.object(self.module, "assert_saved_records", side_effect=check), patch.object(self.module.time, "sleep"):
            self.assertEqual(self.module.stable_saved_state(Path("/owned"))["payloadSha256"], "b")


if __name__ == "__main__":
    unittest.main()
