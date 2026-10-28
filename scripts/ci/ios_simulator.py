"""Unsigned CI build and isolated Simulator evidence; never reads a user's device."""
import argparse
from contextlib import closing
import hashlib
import json
import platform
import plistlib
from pathlib import Path
import re
import sqlite3
import struct
import subprocess
import time
import uuid
import zlib

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "artifacts/ios-simulator"
BUNDLE = "com.jianlibao.app"
PROJECT = "ios/App/App.xcodeproj"


def select_destination(inventory):
    runtimes = [item for item in inventory.get("runtimes", [])
                if item.get("isAvailable") is True
                and ".SimRuntime.iOS-" in item.get("identifier", "")]
    if not runtimes:
        raise ValueError("No available iOS simulator runtime")
    runtime = max(runtimes, key=lambda item: tuple(int(p) for p in item["version"].split(".")))
    identifiers = {item["identifier"] for item in inventory.get("devicetypes", [])}
    # Known compatible with the pinned Xcode 26 / iOS 18.5+ images.
    for suffix in ["iPhone-16", "iPhone-16-Pro"]:
        identifier = "com.apple.CoreSimulator.SimDeviceType." + suffix
        if identifier in identifiers:
            return runtime["identifier"], identifier
    raise ValueError("No supported iPhone 16 device type in this image")


def launch_pid(output):
    match = re.search(r"^com\.jianlibao\.app:\s*([1-9][0-9]*)\s*$", output, re.MULTILINE)
    if not match:
        raise ValueError("App launch did not return our bundle ID and a positive PID")
    return int(match.group(1))


def read_workspace(path):
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
        schema = db.execute("PRAGMA user_version").fetchone()[0]
        rows = db.execute("SELECT revision,payload FROM workspace WHERE id='main'").fetchall()
        markers = db.execute("SELECT value FROM storage_meta WHERE key='legacy-indexeddb-v1'").fetchall()
    if schema != 1 or len(rows) != 1 or len(markers) != 1:
        raise ValueError("SQLite schema or initial workspace is not ready")
    revision, payload = rows[0]
    data, marker = json.loads(payload), json.loads(markers[0][0])
    if data.get("schemaVersion") != 2 or data.get("revision") != revision:
        raise ValueError("Workspace schemaVersion/revision mismatch")
    if marker.get("version") != 1 or marker.get("complete") is not True or marker.get("source") != "new":
        raise ValueError("Expected a completed fresh simulator initialization")
    if not isinstance(data.get("exercises"), list) or not data["exercises"]:
        raise ValueError("Exercise catalog is not ready")
    if not isinstance(data.get("sessions"), list) or not isinstance(data.get("templates"), list):
        raise ValueError("Workspace collections are not ready")
    if not isinstance(data.get("bodyMetrics"), list) or not isinstance(data.get("settings", {}).get("showRpe"), bool):
        raise ValueError("Stage 6 body metrics and RPE preference are not ready")
    return {"schemaVersion": schema, "payloadSchemaVersion": data["schemaVersion"], "revision": revision,
            "exerciseCount": len(data["exercises"]), "sessionCount": len(data["sessions"]),
            "templateCount": len(data["templates"]), "migrationSource": marker["source"],
            "payloadSha256": hashlib.sha256(payload.encode()).hexdigest()}


def command(arguments, *, timeout=120, log=None, check=True):
    print("$ " + " ".join(str(part) for part in arguments), flush=True)

    def record(stdout, stderr):
        # TimeoutExpired may contain bytes even when subprocess.run uses text=True.
        def decoded(value):
            return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else (value or "")
        output = decoded(stdout) + decoded(stderr)
        if log:
            (OUTPUT / log).write_text(output, encoding="utf-8")
        print(output[-6000:] if log else output, flush=True)

    try:
        result = subprocess.run(arguments, cwd=ROOT, text=True, encoding="utf-8", errors="replace",
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        record(error.stdout, error.stderr)
        raise
    record(result.stdout, result.stderr)
    if check and result.returncode:
        raise RuntimeError(f"{arguments[0]} failed with exit code {result.returncode}; see {log or 'output'}")
    return result.stdout  # Machine-readable output must exclude diagnostic stderr.


def write_json(name, value):
    (OUTPUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def wait_boot(simulator, *, phase="boot", timeout=240, execute=None, output=None):
    """System readiness is distinct from app installation, launch and SQLite readiness."""
    uuid.UUID(simulator)
    if type(timeout) is not int or not 120 <= timeout <= 600 or not re.fullmatch(r"[a-z][a-z0-9-]{0,47}", phase):
        raise ValueError("Explicit cold-boot budget (120..600 seconds) and safe phase required")
    execute, output = execute or command, Path(output or OUTPUT)
    output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    result = {"simulatorId": simulator, "phase": phase, "timeoutSeconds": timeout,
              "systemReady": False, "appLaunched": False}
    try:
        execute(["xcrun", "simctl", "boot", simulator], timeout=30, log=phase + "-boot.log")
        execute(["xcrun", "simctl", "bootstatus", simulator, "-b"], timeout=timeout, log=phase + "-bootstatus.log")
        inventory = json.loads(execute(["xcrun", "simctl", "list", "devices", "--json"], timeout=15))
        matches = [item for devices in inventory["devices"].values() for item in devices if item.get("udid") == simulator]
        if len(matches) != 1 or matches[0].get("state") != "Booted":
            raise ValueError("Successful bootstatus must identify this booted simulator")
        result["systemReady"] = True
        return result
    except Exception as error:
        log = output / (phase + "-bootstatus.log")
        text = log.read_text(encoding="utf-8", errors="replace") if log.is_file() else ""
        result.update(failureStage="system-data-migration" if "Waiting on Data Migration" in text else "system-boot",
                      errorType=type(error).__name__)
        raise
    finally:
        result["elapsedSeconds"] = round(time.monotonic() - started, 3)
        (output / (phase + "-readiness.json")).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def preflight():
    if platform.system() != "Darwin":
        raise RuntimeError("iOS execution requires macOS; no build was attempted")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    xcode = command(["xcodebuild", "-version"])
    match = re.search(r"Xcode\s+(\d+)\.(\d+)", xcode)
    if not match or tuple(map(int, match.groups())) != (26, 0):
        raise RuntimeError("Expected the pinned Xcode 26.0.x image")
    inventory = json.loads(command(["xcrun", "simctl", "list", "--json"]))
    runtime, device = select_destination(inventory)
    result = {"host": platform.system(), "architecture": platform.machine(), "xcode": xcode.strip(),
              "macOS": command(["sw_vers", "-productVersion"]).strip(),
              "developerPath": command(["xcode-select", "-p"]).strip(),
              "sdks": command(["xcodebuild", "-showsdks"]).strip(),
              "node": command(["node", "--version"]).strip(),
              "runtime": runtime, "deviceType": device, "signed": False}
    write_json("environment.json", result)
    return result


def wait_workspace(container, timeout=90):
    deadline = time.monotonic() + timeout
    last_error = "No native SQLite file"
    while time.monotonic() < deadline:
        paths = list((container / "Library/CapacitorDatabase").glob("jianlibao*.db"))
        if len(paths) == 1:
            try:
                return read_workspace(paths[0])
            except (sqlite3.Error, ValueError, KeyError, TypeError) as error:
                last_error = str(error)
        time.sleep(1)
    raise RuntimeError("Native SQLite initialization timed out: " + last_error)


def frame_evidence(path, *, require_home=True):
    """Bounded, dependency-free RGB(A) PNG check; nonblank is not semantic UI acceptance."""
    with Path(path).open("rb") as stream:
        data = stream.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Invalid screenshot PNG")
    position, header, compressed, ended = 8, None, bytearray(), False
    while position + 12 <= len(data):
        size = struct.unpack_from(">I", data, position)[0]
        kind = data[position + 4:position + 8]
        end = position + 12 + size
        if end > len(data):
            raise ValueError("Truncated PNG chunk")
        value = data[position + 8:end - 4]
        if zlib.crc32(kind + value) != struct.unpack_from(">I", data, end - 4)[0]:
            raise ValueError("PNG checksum mismatch")
        if kind == b"IHDR":
            if header is not None or position != 8 or size != 13:
                raise ValueError("Invalid PNG header")
            header = struct.unpack(">IIBBBBB", value)
        elif kind == b"IDAT":
            if header is None:
                raise ValueError("PNG data precedes header")
            compressed.extend(value)
        elif kind == b"IEND":
            if size or end != len(data):
                raise ValueError("Invalid PNG end")
            ended = True
            break
        position = end
    if not ended or header is None or not compressed:
        raise ValueError("Incomplete screenshot PNG")
    width, height, depth, color, compression, filtering, interlace = header
    if not (64 <= width <= 5000 and 128 <= height <= 10000 and width * height <= 16000000
            and depth == 8 and color in (2, 6) and compression == filtering == interlace == 0):
        raise ValueError("Unsupported screenshot PNG format or dimensions")
    channels = 4 if color == 6 else 3
    stride = width * channels
    expected = (stride + 1) * height
    decoder = zlib.decompressobj()
    try:
        raw = decoder.decompress(compressed, expected + 1)
    except zlib.error as error:
        raise ValueError("Invalid PNG compression") from error
    if len(raw) != expected or not decoder.eof or decoder.unused_data:
        raise ValueError("PNG pixel data length mismatch")
    previous = bytearray(stride)
    bright = accent = samples = 0
    luminance = [0] * 16
    step_x, step_y = max(1, width // 120), max(1, height // 240)
    for y in range(height):
        offset = y * (stride + 1)
        mode = raw[offset]
        row = bytearray(raw[offset + 1:offset + 1 + stride])
        if mode not in range(5):
            raise ValueError("Unsupported PNG row filter")
        if mode:
            for index in range(stride):
                left = row[index - channels] if index >= channels else 0
                up = previous[index]
                diagonal = previous[index - channels] if index >= channels else 0
                if mode == 1:
                    predictor = left
                elif mode == 2:
                    predictor = up
                elif mode == 3:
                    predictor = (left + up) // 2
                else:
                    p = left + up - diagonal
                    a, b, c = abs(p - left), abs(p - up), abs(p - diagonal)
                    predictor = left if a <= b and a <= c else up if b <= c else diagonal
                row[index] = (row[index] + predictor) & 255
        # Exclude OS status bar and bottom navigation: they can be present on an empty WebView.
        if height * 0.12 <= y < height * 0.80 and y % step_y == 0:
            for x in range(int(width * 0.06), int(width * 0.94), step_x):
                index = x * channels
                r, g, b = row[index:index + 3]
                alpha = row[index + 3] if channels == 4 else 255
                samples += 1
                bright += int(alpha >= 240 and min(r, g, b) >= 180)
                accent += int(alpha >= 240 and r >= 50 and g >= 140 and b <= 120 and g - r >= 25)
                if alpha >= 240:
                    luminance[((54 * r + 183 * g + 19 * b) // 256) // 16] += 1
        previous = row
    significant = [index for index, count in enumerate(luminance) if count >= 20]
    body_contrast = len(significant) >= 2 and significant[-1] - significant[0] >= 3
    return {"pixels": [width, height], "sha256": hashlib.sha256(data).hexdigest(),
            "samples": samples, "brightSamples": bright, "accentSamples": accent,
            "bodyLuminanceBins": luminance, "bodyContrast": body_contrast,
            "nonBlank": (bright >= 20 and accent >= 20) if require_home else body_contrast}


def wait_visible_frame(simulator, label, timeout=45):
    """Keep every capture and require two nonblank frames; never accept a persistent blank."""
    started = time.monotonic()
    deadline = started + timeout
    evidence = {"nonBlankFramePassed": False, "semanticUIReviewed": False, "attempts": []}
    consecutive = 0
    while time.monotonic() < deadline:
        image = OUTPUT / f"{label}-probe-{len(evidence['attempts']) + 1:02}.png"
        command(["xcrun", "simctl", "io", simulator, "screenshot", str(image)],
                timeout=min(10, max(1, deadline - time.monotonic())))
        result = frame_evidence(image)
        finished = time.monotonic()
        result.update(file=image.name, elapsedSeconds=round(finished - started, 3))
        evidence["attempts"].append(result)
        consecutive = consecutive + 1 if result["nonBlank"] else 0
        evidence["nonBlankFramePassed"] = consecutive >= 2 and finished <= deadline
        write_json(label + "-frames.json", evidence)
        if evidence["nonBlankFramePassed"]:
            with (OUTPUT / (label + ".png")).open("xb") as target:
                target.write(image.read_bytes())
            return evidence
        time.sleep(1)
    raise RuntimeError(f"Visible frame timed out for {label}; all screenshots retained")


def run():
    environment = preflight()
    report = {"bundleId": BUNDLE, "iosBuildSucceeded": False, "startupEvidenceCollected": False,
              "visualReviewPassed": False, "physicalDeviceVerified": False,
              "appStoreConnectUsed": False, "signed": False}
    simulator = None
    try:
        listing = json.loads(command(["xcodebuild", "-list", "-json", "-project", PROJECT], timeout=900, log="project-list.log"))
        if "App" not in listing.get("project", {}).get("schemes", []):
            raise RuntimeError("App scheme is not available; project was not modified")
        created = command(["xcrun", "simctl", "create", "Jianlibao-CI-" + uuid.uuid4().hex[:8],
                           environment["deviceType"], environment["runtime"]]).strip()
        uuid.UUID(created)  # Only this newly created device may be controlled or cleaned up.
        simulator = created
        report["simulatorId"] = simulator
        report["systemBoot"] = wait_boot(simulator, phase="cold")
        derived = OUTPUT / "DerivedData"
        command(["xcodebuild", "-project", PROJECT, "-scheme", "App", "-configuration", "Debug",
                 "-sdk", "iphonesimulator", "-destination", "id=" + simulator,
                 "-derivedDataPath", str(derived), "CODE_SIGN_IDENTITY=", "CODE_SIGNING_REQUIRED=NO",
                 "CODE_SIGNING_ALLOWED=NO", "build"], timeout=1800, log="xcodebuild.log")
        app = derived / "Build/Products/Debug-iphonesimulator/App.app"
        with (app / "Info.plist").open("rb") as stream:
            info = plistlib.load(stream)
        if info.get("CFBundleIdentifier") != BUNDLE:
            raise RuntimeError("Built app bundle ID mismatch")
        report["iosBuildSucceeded"] = True
        command(["xcrun", "simctl", "status_bar", simulator, "override", "--time", "9:41",
                 "--batteryState", "charged", "--batteryLevel", "100"])
        command(["xcrun", "simctl", "install", simulator, str(app)])
        report["firstPid"] = launch_pid(command(["xcrun", "simctl", "launch", simulator, BUNDLE]))
        container = Path(command(["xcrun", "simctl", "get_app_container", simulator, BUNDLE, "data"]).strip())
        first = wait_workspace(container)
        report["firstWorkspace"] = first
        report["firstFrames"] = wait_visible_frame(simulator, "first-launch")
        command(["xcrun", "simctl", "terminate", simulator, BUNDLE])
        report["relaunchPid"] = launch_pid(command(["xcrun", "simctl", "launch", simulator, BUNDLE]))
        second = wait_workspace(container)
        if first != second:
            raise RuntimeError("Simulator workspace changed unexpectedly after relaunch")
        report["relaunchWorkspace"] = second
        report["simulatorDataRetainedAfterRelaunch"] = True
        report["relaunchFrames"] = wait_visible_frame(simulator, "relaunch")
        command(["xcrun", "simctl", "terminate", simulator, BUNDLE])
        report["startupEvidenceCollected"] = True
        report["status"] = "awaiting-screenshot-review"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        if simulator and report.get("firstPid"):
            try:
                command(["xcrun", "simctl", "spawn", simulator, "log", "show", "--style", "compact",
                         "--last", "2m", "--predicate", 'process == "App" OR process CONTAINS "WebKit"'],
                        timeout=30, log="simulator-console.log", check=False)
            except Exception as error:
                report["consoleCollectionError"] = type(error).__name__
        write_json("simulator-result.json", report)
        if simulator:
            # The VM is ephemeral; do not delete or reset any device or data.
            command(["xcrun", "simctl", "shutdown", simulator], check=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["preflight", "run"])
    action = parser.parse_args().action
    preflight() if action == "preflight" else run()
