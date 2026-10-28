"""Mac-only browser QA. Does not build/sync iOS or read personal app data."""
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import plistlib
import signal
import subprocess
import tempfile
import sys
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "artifacts/webkit-macos"
EXPECTED_CASES = 220


def require_macos(host):
    if host != "Darwin":
        raise RuntimeError("Actual macOS is required; a Safari user agent is not host evidence")


def child_environment(original, root):
    env = dict(original)
    for name in ("NO_PROXY", "no_proxy"):
        entries = [part.strip() for part in env.get(name, "").split(",") if part.strip()]
        env[name] = ",".join(dict.fromkeys(entries + ["127.0.0.1", "localhost"]))
    env.pop("JLB_E2E_RUN_DIR", None)
    env["PLAYWRIGHT_BROWSERS_PATH"] = str(root / "tools/playwright-webkit")
    env["JLB_QA_PYTHON"] = str(root / "tools/webkit-qa-python/bin/python")
    return env


def report_status(report):
    fields = ("expected", "unexpected", "skipped", "flaky")
    stats = report["stats"]
    if any(type(stats.get(name)) is not int or stats[name] < 0 for name in fields):
        raise ValueError("Invalid Playwright stats")
    if sum(stats[name] for name in fields) != EXPECTED_CASES:
        raise ValueError("A complete run must contain exactly 220 cases")
    statuses = []
    def visit(suite):
        for spec in suite.get("specs", []):
            statuses.extend(test["status"] for test in spec.get("tests", []))
        for child in suite.get("suites", []):
            visit(child)
    visit(report)
    if len(statuses) != EXPECTED_CASES:
        raise ValueError("The actual case list must contain exactly 220 cases")
    counted = Counter(statuses)
    if any(counted[name] != stats[name] for name in fields):
        raise ValueError("Playwright stats disagree with actual case statuses")
    result = {name: stats[name] for name in fields}
    result["topLevelErrors"] = len(report.get("errors", []))
    result["passed"] = (stats["expected"] == EXPECTED_CASES and
                        not any(result[name] for name in ("unexpected", "skipped", "flaky", "topLevelErrors")))
    return result


def capture_valid(capture, screenshot_count):
    if (not isinstance(capture, dict) or screenshot_count != 80 or
            capture.get("screenshots") != 80 or capture.get("pageErrors") != []):
        return False
    states = {"settings", "body-editor", "today", "plans", "exercises", "workout",
              "history", "statistics", "guide-brief", "guide-detailed"}
    expected = {(state, width, theme) for state in states for width in (320, 390, 768, 1440)
                for theme in ("dark", "light")}
    checks = capture.get("checks")
    if not isinstance(checks, list) or len(checks) != 80:
        return False
    found = set()
    for row in checks:
        if (not isinstance(row, dict) or not isinstance(row.get("state"), str) or
                not isinstance(row.get("theme"), str) or type(row.get("width")) is not int):
            return False
        found.add((row["state"], row["width"], row["theme"]))
        audit = row.get("audit")
        if not isinstance(audit, dict) or audit.get("smallTargets") != []:
            return False
        overflow = audit.get("horizontalOverflow")
        if not isinstance(overflow, dict) or overflow.get("present") is not False:
            return False
    return found == expected


def acceptance(exit_code, report, screenshots_complete):
    return exit_code == 0 and report.get("passed") is True and screenshots_complete is True


def text(value):
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value or ""


def process_table():
    raw = subprocess.check_output(["/bin/ps", "-axo", "pid=,ppid=,stat=,lstart="], text=True, timeout=5)
    table = {}
    for line in raw.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4:
            table[int(parts[0])] = (int(parts[1]), parts[2], parts[3])
    return table


def owned_family(table, parent):
    family = {parent: table[parent][2]} if parent in table else {}
    while True:
        children = {pid: birth for pid, (ppid, state, birth) in table.items()
                    if ppid in family and pid not in family}
        if not children:
            return family
        family.update(children)


def live_owned(owned, table):
    # Compare the original start time as well as PID; never kill a reused PID.
    return [pid for pid, birth in owned.items() if pid in table and
            table[pid][2] == birth and not table[pid][1].startswith("Z")]


def run_logged(arguments, root, env, log, timeout):
    process = subprocess.Popen(arguments, cwd=root, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        # Playwright detaches browsers/webServer. Record their identities before
        # signalling the CLI so they remain attributable even after reparenting.
        owned = owned_family(process_table(), process.pid)
        try:
            os.killpg(process.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            stdout, stderr = b"", b""
        for pid in live_owned(owned, process_table()):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        stdout, stderr = process.communicate(timeout=15)
        until = time.monotonic() + 5
        while live_owned(owned, process_table()):
            if time.monotonic() >= until:
                log.write_text(text(stdout) + "\n" + text(stderr) + "\nOwned QA descendants did not stop", encoding="utf-8")
                raise RuntimeError("Owned QA processes remain; refusing concurrent capture")
            time.sleep(0.1)
    log.write_text(text(stdout) + "\n--- stderr ---\n" + text(stderr) +
                   ("\nQA owned process tree stopped after timeout\n" if timed_out else ""), encoding="utf-8")
    return 124 if timed_out else process.returncode


def execute_e2e(root, output, env):
    run_root = root / "artifacts/e2e-runs"
    run_root.mkdir(parents=True, exist_ok=True)
    owned = Path(tempfile.mkdtemp(prefix="run-macos-", dir=run_root)).resolve()
    child = {**env, "JLB_E2E_RUN_DIR": str(owned)}
    code = run_logged(["node", "scripts/run-webkit.mjs", "--global-timeout=1500000"],
                      root, child, output / "webkit-full.log", 26 * 60)
    report = {"passed": False}
    try:
        data = json.loads((owned / "report.json").read_text(encoding="utf-8"))
        if data["config"]["metadata"]["hostPlatform"] != "darwin":
            raise ValueError("Report host is not actual macOS")
        report = report_status(data)
    except (OSError, KeyError, ValueError) as error:
        report["validationError"] = str(error)
    return code, report, owned


def archive_files(root, files, target):
    root = root.resolve()
    selected = []
    for path in files:
        resolved = path.resolve()
        if not resolved.is_relative_to(root):
            raise ValueError("Archive path is outside the project")
        if path.is_file() and resolved != target.resolve():
            selected.append(resolved)
    if target.exists():
        raise FileExistsError("Refusing to replace an existing evidence archive")
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for path in sorted(set(selected)):
            archive.write(path, path.relative_to(root).as_posix())


def preflight():
    require_macos(platform.system())
    OUTPUT.mkdir(parents=True, exist_ok=True)
    def read_command(args):
        result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=20)
        if result.returncode:
            raise RuntimeError("Environment probe failed: " + args[0])
        return result.stdout.strip()
    safari = Path("/Applications/Safari.app/Contents/Info.plist")
    safari_version = None
    if safari.is_file():
        with safari.open("rb") as stream:
            safari_version = plistlib.load(stream).get("CFBundleShortVersionString")
    result = {"recordedAt": datetime.now(timezone.utc).isoformat(), "host": platform.system(),
              "arch": platform.machine(), "macOS": platform.mac_ver()[0],
              "node": read_command(["node", "--version"]), "python": platform.python_version(),
              "xcodeVersionOnly": read_command(["xcodebuild", "-version"]),
              "installedSafariVersion": safari_version, "officialSafariTested": False,
              "actualIOS": False, "iosBuildExecuted": False,
              "gitCommit": read_command(["git", "rev-parse", "HEAD"])}
    (OUTPUT / "host-environment.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


def run():
    require_macos(platform.system())
    OUTPUT.mkdir(parents=True, exist_ok=True)
    env = child_environment(os.environ, ROOT)
    code, report, run_directory = execute_e2e(ROOT, OUTPUT, env)
    report_path = run_directory / "report.json"
    capture_code = 1
    preview_log = OUTPUT / "preview.log"
    with preview_log.open("w", encoding="utf-8") as log:
        preview = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "preview", "--host",
                                    "127.0.0.1", "--port", "5440", "--strictPort"],
                                   cwd=ROOT, env=env, stdout=log, stderr=log)
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            started = time.monotonic()
            while True:
                if preview.poll() is not None:
                    raise RuntimeError("Owned preview server exited before readiness")
                try:
                    with opener.open("http://127.0.0.1:5440/", timeout=1) as response:
                        if response.status == 200:
                            break
                except OSError:
                    pass
                if time.monotonic() - started > 25:
                    raise RuntimeError("Owned preview server did not become ready")
                time.sleep(0.1)
            capture_code = run_logged(["node", "scripts/ci/webkit_capture.mjs"], ROOT, env,
                                      OUTPUT / "capture.log", 8 * 60)
        except (OSError, RuntimeError) as error:
            (OUTPUT / "capture-error.log").write_text(str(error), encoding="utf-8")
        finally:
            preview.terminate()
            try:
                preview.wait(timeout=10)
            except subprocess.TimeoutExpired:
                preview.kill()
                preview.wait()
    capture_path = OUTPUT / "capture-result.json"
    capture = json.loads(capture_path.read_text(encoding="utf-8")) if capture_path.is_file() else {}
    complete = (capture_code == 0 and
                capture_valid(capture, len(list((OUTPUT / "screenshots").glob("*.png")))))
    accepted = acceptance(code, report, complete)
    summary = {"recordedAt": datetime.now(timezone.utc).isoformat(), "engine": "Playwright WebKit",
               "actualHost": "Darwin", "actualIOS": False, "officialSafariTested": False,
               "e2eExitCode": code, "report": report,
               "reportPath": report_path.relative_to(ROOT).as_posix() if report_path.is_file() else None,
               "runDirectory": run_directory.relative_to(ROOT).as_posix(),
               "captureExitCode": capture_code, "screenshotsComplete": complete,
               "accepted": accepted, "localLoopbackProxyBypassOnly": True, "iosBuildExecuted": False}
    (OUTPUT / "qa-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    files = [path for path in OUTPUT.rglob("*") if path.is_file()]
    # Always retain this run, including traces written before the JSON reporter.
    files.extend(path for path in run_directory.rglob("*") if path.is_file())
    archive_files(ROOT, files, OUTPUT / "webkit-evidence.zip")
    print(json.dumps(summary))
    return 0 if accepted else 1


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"preflight", "run"}:
        raise SystemExit("Usage: webkit_macos.py preflight|run")
    if sys.argv[1] == "preflight":
        preflight()
    else:
        raise SystemExit(run())
