"""Portable Simulator capture regressions: an old SQLite row is not a rendered UI."""
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[2]


def png(*, home=False, transparent=False, status_only=False, filter_kind=0, background=(8, 12, 9)):
    width, height = 100, 200
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            color = background
            if home and 28 <= y < 48 and 8 <= x < 90:
                color = (240, 240, 240)
            if home and 65 <= y < 95 and 10 <= x < 85:
                color = (160, 230, 30)
            if status_only and y < 12:
                color = (240, 240, 240) if x < 70 else (160, 230, 30)
            row.extend((*color, 0 if transparent else 255))
        rows.append(bytes(row))

    def paeth(a, b, c):
        p = a + b - c
        distances = [abs(p - value) for value in (a, b, c)]
        return (a, b, c)[distances.index(min(distances))]

    raw = bytearray()
    previous = bytes(width * 4)
    for row in rows:
        raw.append(filter_kind)
        for index, value in enumerate(row):
            left = row[index - 4] if index >= 4 else 0
            up = previous[index]
            diagonal = previous[index - 4] if index >= 4 else 0
            predictor = [0, left, up, (left + up) // 2, paeth(left, up, diagonal)][filter_kind]
            raw.append((value - predictor) % 256)
        previous = row

    def chunk(kind, value):
        return struct.pack(">I", len(value)) + kind + value + struct.pack(">I", zlib.crc32(kind + value))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class SimulatorFrameContracts(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("ios_frame_contract", ROOT / "scripts/ci/ios_simulator.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        directory = tempfile.TemporaryDirectory(prefix="jianlibao-frame-test-")
        self.addCleanup(directory.cleanup)
        self.output = Path(directory.name)

    def frame(self, data):
        path = self.output / "frame.png"
        path.write_bytes(data)
        return self.module.frame_evidence(path)

    def test_all_png_filters_preserve_the_rendered_signal(self):
        for filter_kind in range(5):
            with self.subTest(filter=filter_kind):
                evidence = self.frame(png(home=True, filter_kind=filter_kind))
                self.assertTrue(evidence["nonBlank"])
                self.assertGreaterEqual(evidence["brightSamples"], 20)
                self.assertGreaterEqual(evidence["accentSamples"], 20)
                self.assertEqual(evidence["pixels"], [100, 200])

    def test_blank_transparent_and_status_bar_only_do_not_pass(self):
        for data in [png(), png(home=True, transparent=True), png(status_only=True)]:
            with self.subTest(kind=data[-20:]):
                self.assertFalse(self.frame(data)["nonBlank"])

    def test_general_ui_accepts_real_settings_without_reducing_home_or_blank_guards(self):
        actual = ROOT / "tests/fixtures/ios-settings-native.png"
        self.assertFalse(self.module.frame_evidence(actual)["nonBlank"])
        self.assertTrue(self.module.frame_evidence(actual, require_home=False)["nonBlank"])
        for data in [png(), png(background=(0, 0, 0)), png(background=(255, 255, 255)),
                     png(home=True, transparent=True), png(status_only=True)]:
            path = self.output / "blank.png"; path.write_bytes(data)
            self.assertFalse(self.module.frame_evidence(path, require_home=False)["nonBlank"])

    def test_corrupt_or_truncated_png_fails_closed(self):
        data = bytearray(png(home=True))
        data[-5] ^= 1
        for invalid in [b"not a PNG", bytes(data), png(home=True)[:-8]]:
            with self.subTest(bytes=len(invalid)), self.assertRaises(ValueError):
                self.frame(invalid)

    def test_png_file_read_is_bounded_before_allocation(self):
        class BoundedStream(io.BytesIO):
            def read(stream, size=-1):
                self.assertEqual(size, 32 * 1024 * 1024 + 1)
                return super().read(size)

        with patch.object(self.module.Path, "open", return_value=BoundedStream(png(home=True))):
            self.assertTrue(self.module.frame_evidence(self.output / "bounded.png")["nonBlank"])

    def run_with_frames(self, *, forever_blank=False):
        module = self.module
        app = self.output / "DerivedData/Build/Products/Debug-iphonesimulator/App.app"
        app.mkdir(parents=True)
        (app / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": module.BUNDLE}))
        state = {"phase": 0, "shots": 0, "time": 0.0}
        home = png(home=True)
        blank = png()

        def command(arguments, **_options):
            if arguments[:2] == ["xcodebuild", "-list"]:
                return json.dumps({"project": {"schemes": ["App"]}})
            if arguments[:3] == ["xcrun", "simctl", "create"]:
                return "11111111-2222-4333-8444-555555555555"
            if arguments[:4] == ["xcrun", "simctl", "list", "devices"]:
                return json.dumps({"devices": {"fixture-ios": [{"udid": "11111111-2222-4333-8444-555555555555", "state": "Booted"}]}})
            if arguments[:3] == ["xcrun", "simctl", "launch"]:
                state["phase"] += 1
                state["shots"] = 0
                return f"{module.BUNDLE}: {100 + state['phase']}\n"
            if arguments[:3] == ["xcrun", "simctl", "get_app_container"]:
                return str(self.output / "fresh-simulator-container")
            if "screenshot" in arguments:
                state["shots"] += 1
                # Actual observed case: first launch has UI, first relaunch frame is blank.
                pending = state["phase"] == 2 and (forever_blank or state["shots"] == 1)
                Path(arguments[-1]).write_bytes(blank if pending else home)
            return ""

        def sleep(seconds):
            state["time"] += seconds

        workspace = {"payloadSha256": "a" * 64, "exerciseCount": 302, "sessionCount": 0}
        with patch.object(module, "OUTPUT", self.output), patch.object(module, "preflight", return_value={"deviceType": "test", "runtime": "test"}), patch.object(module, "command", side_effect=command), patch.object(module, "wait_workspace", return_value=workspace), patch.object(module.time, "sleep", side_effect=sleep), patch.object(module.time, "monotonic", side_effect=lambda: state["time"]):
            module.run()
        return home

    def test_relaunch_waits_for_rendered_frames_despite_an_existing_database(self):
        expected = self.run_with_frames()
        self.assertEqual((self.output / "relaunch.png").read_bytes(), expected)
        evidence = json.loads((self.output / "relaunch-frames.json").read_text())
        self.assertGreaterEqual(len(evidence["attempts"]), 3)
        self.assertFalse(evidence["attempts"][0]["nonBlank"])
        self.assertTrue(evidence["nonBlankFramePassed"])
        self.assertTrue(all(item["nonBlank"] for item in evidence["attempts"][-2:]))
        self.assertTrue(json.loads((self.output / "simulator-result.json").read_text())["startupEvidenceCollected"])

    def test_persistent_blank_fails_even_when_pid_and_sqlite_are_ready(self):
        with self.assertRaisesRegex(RuntimeError, "[Ff]rame|[Vv]isible|blank"):
            self.run_with_frames(forever_blank=True)
        report = json.loads((self.output / "simulator-result.json").read_text())
        self.assertEqual(report["status"], "failed")
        self.assertFalse(report["startupEvidenceCollected"])
        self.assertFalse(report["visualReviewPassed"])
        self.assertFalse((self.output / "relaunch.png").exists())
        evidence = json.loads((self.output / "relaunch-frames.json").read_text())
        self.assertFalse(evidence["nonBlankFramePassed"])
        self.assertTrue(evidence["attempts"])

    def test_capture_completing_after_the_deadline_cannot_pass(self):
        state = {"time": 0.0, "shots": 0}

        def capture(arguments, **_options):
            state["shots"] += 1
            if state["shots"] == 2:
                state["time"] += 4.0004
            Path(arguments[-1]).write_bytes(png(home=True))
            return ""

        def sleep(seconds):
            state["time"] += seconds

        with patch.object(self.module, "OUTPUT", self.output), patch.object(self.module, "command", side_effect=capture), patch.object(self.module.time, "sleep", side_effect=sleep), patch.object(self.module.time, "monotonic", side_effect=lambda: state["time"]):
            with self.assertRaisesRegex(RuntimeError, "[Ff]rame|[Vv]isible"):
                self.module.wait_visible_frame("owned-test-device", "relaunch", timeout=5)
        self.assertFalse((self.output / "relaunch.png").exists())
        self.assertFalse(json.loads((self.output / "relaunch-frames.json").read_text())["nonBlankFramePassed"])


if __name__ == "__main__":
    unittest.main()
