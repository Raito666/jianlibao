"""Real Simulator UI acceptance. Application data is written only through XCTest UI."""
import argparse
from contextlib import closing
import hashlib
import importlib.util
import json
from pathlib import Path
import platform
import shutil
import sqlite3
import subprocess
import time
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "artifacts/ios-ui"
BUNDLE = "com.jianlibao.app"


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/ci" / (name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def command(arguments, *, timeout=120, log=None):
    print("$ " + " ".join(str(a) for a in arguments), flush=True)
    def record(stdout, stderr):
        def decode(value):
            return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else (value or "")
        text = decode(stdout) + decode(stderr)
        if log:
            (OUTPUT / log).write_text(text, encoding="utf-8")
        print(text[-5000:], flush=True)
    try:
        result = subprocess.run(arguments, cwd=ROOT, text=True, encoding="utf-8", errors="replace",
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        record(error.stdout, error.stderr)
        raise
    record(result.stdout, result.stderr)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}); see {log or arguments[0]}")
    return result.stdout


def write_json(name, data):
    (OUTPUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def summary_valid(data, simulator=None):
    counts = ["totalTestCount", "passedTests", "failedTests", "skippedTests", "expectedFailures"]
    if not isinstance(data, dict) or any(type(data.get(key)) is not int for key in counts):
        return False
    if simulator is not None:
        devices = data.get("devicesAndConfigurations", [])
        if (len(devices) != 1 or devices[0].get("device", {}).get("deviceId") != simulator
                or any(devices[0].get(key) != value for key, value in
                       {"passedTests": 1, "failedTests": 0, "skippedTests": 0, "expectedFailures": 0}.items())):
            return False
    return (isinstance(data, dict) and data.get("result") == "Passed"
            and data.get("totalTestCount") == data.get("passedTests") == 1
            and data.get("failedTests") == data.get("skippedTests") == data.get("expectedFailures") == 0
            and data.get("testFailures") == [])


def required_evidence(phase):
    if phase == "probe":
        return ["00-before-ready", "01-home", "02-start-preview", "03-exercises", "04-progress",
                "05-settings", "06-body-form", "07-body-keyboard"]
    suffixes = ["history-sets", "history-detail", "statistics", "exercise-tracking", "body-record", "home"]
    if phase == "created":
        return (["guide-frame-1", "guide-frame-2", "guide-frame-3", "guide-detailed", "guide-performance", "body-create-form",
                 "body-edited-delete-cancelled", "training-copied", "training-entered", "training-action-navigation", "training-review"]
                + ["saved-" + name for name in suffixes])
    if phase in {"reopened", "rebooted"}:
        return [phase + "-" + name for name in suffixes]
    if phase == "supplement":
        return ["reference-image-1", "reference-image-2", "reference-video-before", "reference-video-playing",
                "body-trend-waist", "body-deleted-after-durability"]
    raise ValueError("Unknown UI evidence phase")


def verify_evidence(directory, phase):
    result = []
    for name in required_evidence(phase):
        image, tree = directory / (name + ".png"), directory / (name + ".txt")
        if not image.is_file() or not tree.is_file() or not tree.stat().st_size:
            raise ValueError("Missing native phase PNG/AX: " + name)
        if "com.jianlibao.app" not in tree.read_text(encoding="utf-8"):
            raise ValueError("Native AX does not identify the tested app")
        # A detail/settings/video page need not contain a large green CTA.
        # Retain the original homepage requirement in startup tests; here require
        # opaque contrasting body pixels, excluding the OS bars, plus AX and UI assertions.
        frame = module("ios_simulator").frame_evidence(image, require_home=False)
        if not frame["nonBlank"]:
            raise ValueError("Blank native phase capture: " + name)
        result.append({"name": name, "pngSha256": hashlib.sha256(image.read_bytes()).hexdigest(),
                       "axSha256": hashlib.sha256(tree.read_bytes()).hexdigest(), "frame": frame})
    return result


def assert_same_state(before, after):
    for key in ["container", "payloadSha256", "data"]:
        if before.get(key) != after.get(key):
            raise ValueError("Native persistence mismatch: " + key)


def assert_saved_records(data):
    sessions, bodies = data.get("sessions", []), data.get("bodyMetrics", [])
    if len(sessions) != 1 or len(bodies) != 1:
        raise ValueError("Exactly one UI-created completed training and body record required")
    session, body = sessions[0], bodies[0]
    if session.get("status") != "completed" or session.get("note") != "SIM-TRAIN-20261022":
        raise ValueError("Saved training state/note mismatch")
    exercises = session.get("exercises", [])
    if not exercises or exercises[0].get("exercise", {}).get("id") != "ex-squat":
        raise ValueError("Historical exercise snapshot mismatch")
    exercise = exercises[0]
    sets = exercise.get("sets", [])
    if exercise.get("note") != "SIM-EX-20261022" or len(sets) < 2:
        raise ValueError("Exercise note or sets missing")
    if any(sets[0].get(key) != value for key, value in {"type": "work", "status": "completed", "weightKg": 40, "reps": 8}.items()):
        raise ValueError("UI-entered first set differs")
    if any(sets[1].get(key) != value for key, value in {"status": "skipped", "weightKg": 40, "reps": 8}.items()):
        raise ValueError("Copy/skip interaction did not persist")
    completed = [s for e in exercises for s in e.get("sets", []) if s.get("status") == "completed"]
    if len(completed) != 1:
        raise ValueError("Unexpected completed sets affect statistics")
    if any(body.get(key) != value for key, value in {"weightKg": 72.6, "bodyFatPct": 18.5, "note": "SIM-BODY-20261022"}.items()):
        raise ValueError("UI body create/edit did not persist")
    if body.get("measurements") != {"chest": 98, "waist": 80, "hip": 96, "arm": 34, "thigh": 55}:
        raise ValueError("Body measurements differ")


def read_state(container):
    paths = list((container / "Library/CapacitorDatabase").glob("jianlibao*.db"))
    if len(paths) != 1:
        raise ValueError("Exactly one native database is required")
    summary = module("ios_simulator").read_workspace(paths[0])
    with closing(sqlite3.connect(paths[0].resolve().as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
        payload = db.execute("SELECT payload FROM workspace WHERE id='main'").fetchone()[0]
    digest = hashlib.sha256(payload.encode()).hexdigest()
    if digest != summary["payloadSha256"]:
        raise ValueError("Workspace changed during the read-only snapshot")
    return {"container": str(container), "database": paths[0].name, "payloadSha256": digest,
            "summary": summary, "data": json.loads(payload)}


def run_ui_test(simulator, project, derived, phase, method):
    result_path = OUTPUT / (phase + ".xcresult")
    test_error = None
    try:
        command(["xcodebuild", "-project", project["project"], "-scheme", project["name"],
             "-configuration", "Debug", "-destination", "id=" + simulator, "-derivedDataPath", str(derived),
             "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY=",
             "-parallel-testing-enabled", "NO", "-maximum-concurrent-test-simulator-destinations", "1",
             "-only-testing:" + project["name"] + "/NativeAcceptanceTests/" + method,
                 "-resultBundlePath", str(result_path), "test-without-building"], timeout=900, log=phase + ".log")
    except Exception as error:
        test_error = error
    finally:
        try:
            collect_runner_evidence(simulator, phase)
        except Exception as error:
            write_json(phase + "-evidence-error.json", {"error": str(error)})
            if test_error is None:
                raise
    if test_error is not None:
        raise test_error
    summary = json.loads(command(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(result_path)]))
    write_json(phase + "-summary.json", summary)
    if not summary_valid(summary, simulator):
        raise RuntimeError("Native UI case count/result is not accepted")

    return summary


def stable_saved_state(container):
    deadline, last, last_error = time.monotonic() + 20, None, None
    while time.monotonic() < deadline:
        try:
            current = read_state(container)
            assert_saved_records(current["data"])
        except ValueError as error:
            last_error, last = str(error), None
            time.sleep(0.25)
            continue
        if last and current["payloadSha256"] == last["payloadSha256"]:
            return current
        last = current
        time.sleep(0.25)
    raise RuntimeError("Saved native workspace did not stabilize: " + str(last_error))


def finish_run(result, simulator):
    cleanup_error = None
    try:
        if simulator:
            completed = subprocess.run(["xcrun", "simctl", "shutdown", simulator], cwd=ROOT,
                                       capture_output=True, timeout=60)
            if completed.returncode:
                raise RuntimeError("Simulator shutdown returned " + str(completed.returncode))
    except Exception as error:
        cleanup_error = str(error)
        result.update(status="failed", nativeInteractionsAccepted=False, cleanupError=cleanup_error)
    finally:
        write_json("ui-result.json", result)
        # Preserve both immediate screenshots/results and complete raw XCTest evidence.
        archive_evidence(OUTPUT)
    if cleanup_error:
        raise RuntimeError("Native UI cleanup failed; evidence retained: " + cleanup_error)


def archive_evidence(output):
    for filename, thin in [("captures.zip", True), ("evidence.zip", False)]:
        with zipfile.ZipFile(output / filename, "w", zipfile.ZIP_DEFLATED) as archive:
            for source in sorted(output.rglob("*")):
                relative = source.relative_to(output)
                if not source.is_file() or source.name in {"captures.zip", "evidence.zip"}:
                    continue
                if any(part in {"UITestDerivedData", "UITestHarness"} for part in relative.parts):
                    continue
                if thin and (source.suffix not in {".png", ".txt", ".json", ".log"}
                             or any(part.endswith(".xcresult") for part in relative.parts)):
                    continue
                archive.write(source, relative.as_posix())


def collect_runner_evidence(simulator, phase):
    runner = "com.jianlibao.acceptance.xctrunner"
    container = Path(command(["xcrun", "simctl", "get_app_container", simulator, runner, "data"]).strip())
    evidence = container / "Documents/jlb-ui"
    if not evidence.is_dir():
        raise RuntimeError("Missing UI-runner screenshots and AX evidence")
    destination = OUTPUT / phase
    destination.mkdir(exist_ok=False)
    for source in evidence.iterdir():
        if source.is_file() and source.suffix in {".json", ".png", ".txt"}:
            shutil.copy2(source, destination / source.name)
    write_json(phase + "-evidence.json", verify_evidence(destination, phase))


def run(mode):
    if platform.system() != "Darwin":
        raise RuntimeError("Native UI acceptance requires macOS; no Apple commands executed")
    if mode not in {"probe", "full"}:
        raise ValueError("Unknown native UI mode")
    OUTPUT.mkdir(parents=True, exist_ok=False)
    result = {"mode": mode, "nativeInteractionsAccepted": False, "physicalDeviceAccepted": False,
              "appStoreConnectUsed": False, "signed": False,
              "sourceCommit": __import__("os").environ.get("CM_COMMIT")}
    simulator = None
    try:
        bootstrap = module("ios_simulator")
        bootstrap.run()
        original = json.loads((bootstrap.OUTPUT / "simulator-result.json").read_text())
        simulator = original["simulatorId"]
        uuid.UUID(simulator)
        result["simulatorId"] = simulator
        result["uiSystemBoot"] = bootstrap.wait_boot(simulator, phase="ui-start", execute=command, output=OUTPUT)
        command(["defaults", "write", "com.apple.iphonesimulator", "ConnectHardwareKeyboard", "-bool", "NO"])
        app_container = Path(command(["xcrun", "simctl", "get_app_container", simulator, BUNDLE, "data"]).strip())
        initial = read_state(app_container)
        if initial["data"]["sessions"] or initial["data"]["bodyMetrics"]:
            raise RuntimeError("UI acceptance requires this job's fresh isolated simulator")
        write_json("initial-state.json", initial)
        project = module("ios_ui_project").generate_project(OUTPUT / "UITestHarness", ROOT / "scripts/ci/native-ui/AcceptanceTests.swift")
        derived = OUTPUT / "UITestDerivedData"
        command(["xcodebuild", "-project", project["project"], "-scheme", project["name"], "-configuration", "Debug",
                 "-destination", "id=" + simulator, "-derivedDataPath", str(derived), "CODE_SIGNING_ALLOWED=NO",
                 "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY=", "build-for-testing"], timeout=600, log="ui-build.log")
        result["appPid"] = bootstrap.launch_pid(command(["xcrun", "simctl", "launch", simulator, BUNDLE]))
        if mode == "probe":
            result["probeSummary"] = run_ui_test(simulator, project, derived, "probe", "testProbe")
            write_json("after-probe-state.json", read_state(app_container))
            result["diagnosticOnly"] = True
            result["status"] = "probe-collected-not-full-acceptance"
        else:
            result["createSummary"] = run_ui_test(simulator, project, derived, "created", "testCreateRecords")
            saved = stable_saved_state(app_container)
            write_json("saved-state.json", saved)
            # Ensure a running process, explicitly terminate it, then launch a new PID.
            before_pid = bootstrap.launch_pid(command(["xcrun", "simctl", "launch", simulator, BUNDLE]))
            command(["xcrun", "simctl", "terminate", simulator, BUNDLE])
            assert_same_state(saved, read_state(app_container))
            reopened_pid = bootstrap.launch_pid(command(["xcrun", "simctl", "launch", simulator, BUNDLE]))
            if reopened_pid == before_pid:
                raise RuntimeError("Relaunch did not create a new application process")
            reopened_container = Path(command(["xcrun", "simctl", "get_app_container", simulator, BUNDLE, "data"]).strip())
            reopened = stable_saved_state(reopened_container)
            assert_same_state(saved, reopened)
            write_json("reopened-before-ui-state.json", reopened)
            result["reopenSummary"] = run_ui_test(simulator, project, derived, "reopened", "testAfterAppRelaunch")
            assert_same_state(saved, stable_saved_state(reopened_container))
            command(["xcrun", "simctl", "shutdown", simulator])
            result["uiSystemReboot"] = bootstrap.wait_boot(simulator, phase="ui-reboot", execute=command, output=OUTPUT)
            rebooted_pid = bootstrap.launch_pid(command(["xcrun", "simctl", "launch", simulator, BUNDLE]))
            rebooted_container = Path(command(["xcrun", "simctl", "get_app_container", simulator, BUNDLE, "data"]).strip())
            rebooted = stable_saved_state(rebooted_container)
            assert_same_state(saved, rebooted)
            write_json("rebooted-before-ui-state.json", rebooted)
            result["rebootSummary"] = run_ui_test(simulator, project, derived, "rebooted", "testAfterSimulatorRestart")
            final = stable_saved_state(rebooted_container)
            assert_same_state(saved, final)
            write_json("final-state.json", final)
            result.update(corePersistenceAccepted=True, sameSimulatorRestarted=True,
                          unchangedContainer=True, completePayloadUnchanged=True,
                          appProcesses={"beforeTermination": before_pid, "afterRelaunch": reopened_pid, "afterSimulatorRestart": rebooted_pid},
                          savedPayloadSha256=saved["payloadSha256"])
            result["supplementSummary"] = run_ui_test(simulator, project, derived, "supplement", "testSupplementalInteractions")
            deleted = read_state(rebooted_container)
            expected = {**final["data"], "bodyMetrics": [], "revision": final["data"]["revision"] + 1}
            if deleted["data"] != expected or deleted["container"] != final["container"]:
                raise ValueError("Only the UI-selected synthetic body record may be deleted")
            write_json("after-ui-deletion-state.json", deleted)
            result.update(status="passed", nativeInteractionsAccepted=True, referencePlaybackAccepted=True,
                          bodyTrendAccepted=True, bodyDeletionAccepted=True)
    except Exception as error:
        result.update(status="failed", nativeInteractionsAccepted=False, error=str(error))
        raise
    finally:
        finish_run(result, simulator)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["probe", "full"])
    run(parser.parse_args().mode)
