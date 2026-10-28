"""Isolated native iOS input, localization, relaunch/reboot and bundle acceptance."""
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'artifacts/ios-input'


def run():
    if platform.system() != 'Darwin':
        raise RuntimeError('Native acceptance requires the authorized Mac environment')
    import importlib.util
    spec = importlib.util.spec_from_file_location('ui', ROOT / 'scripts/ci/ios_ui_acceptance.py')
    ui = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ui)
    OUTPUT.mkdir(parents=True, exist_ok=False)
    ui.OUTPUT = OUTPUT
    command, save = ui.command, ui.write_json
    bootstrap = ui.module('ios_simulator')
    result = {'accepted': False, 'signed': False, 'physicalDeviceAccepted': False,
              'dataScope': 'new isolated simulator only', 'appStoreConnectUsed': False}
    simulator = None
    app_console = None
    app_console_file = None
    try:
        bootstrap.run()
        original = json.loads((bootstrap.OUTPUT / 'simulator-result.json').read_text())
        simulator = original['simulatorId']
        result['simulatorId'] = simulator
        app = bootstrap.OUTPUT / 'DerivedData/Build/Products/Debug-iphonesimulator/App.app'
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        strings = json.loads(command(['plutil', '-convert', 'json', '-o', '-', str(app / 'zh-Hans.lproj/InfoPlist.strings')]))
        if info.get('CFBundleDevelopmentRegion') != 'zh-Hans' or 'zh-Hans' not in info.get('CFBundleLocalizations', []):
            raise ValueError('Built localization metadata is missing')
        if strings.get('CFBundleDisplayName') != '健力宝' or strings.get('CFBundleName') != '健力宝':
            raise ValueError('Built Simplified Chinese display/short name differs')
        launch_storyboards = [p for p in [app / 'LaunchScreen.storyboardc', app / 'Base.lproj/LaunchScreen.storyboardc'] if p.is_dir()]
        if len(launch_storyboards) != 1:
            raise ValueError('Compiled launch storyboard missing')
        result['localization'] = {'developmentRegion': info['CFBundleDevelopmentRegion'], 'strings': strings,
                                  'compiledLaunchStoryboard': launch_storyboards[0].relative_to(app).as_posix()}
        result['inputSystemBoot'] = bootstrap.wait_boot(simulator, phase='input-start', execute=command, output=OUTPUT)
        # Ensure the actual software keyboard is available; never control an existing user's device.
        command(['defaults', 'write', 'com.apple.iphonesimulator', 'ConnectHardwareKeyboard', '-bool', 'NO'])
        command(['xcrun', 'simctl', 'ui', simulator, 'appearance', 'dark'])
        container = Path(command(['xcrun', 'simctl', 'get_app_container', simulator, ui.BUNDLE, 'data']).strip())
        initial = ui.read_state(container)
        if initial['data']['sessions'] or initial['data']['bodyMetrics']:
            raise ValueError('Fresh empty simulator required')
        combined = OUTPUT / 'CombinedInputTests.swift'
        combined.write_text((ROOT / 'scripts/ci/native-ui/AcceptanceTests.swift').read_text() + '\n' +
                            (ROOT / 'scripts/ci/native-ui/InputExperienceTests.swift').read_text())
        project = ui.module('ios_ui_project').generate_project(OUTPUT / 'UITestHarness', combined)
        derived = OUTPUT / 'UITestDerivedData'
        command(['xcodebuild', '-project', project['project'], '-scheme', project['name'], '-configuration', 'Debug',
                 '-destination', 'id=' + simulator, '-derivedDataPath', str(derived), 'CODE_SIGNING_ALLOWED=NO',
                 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'build-for-testing'], timeout=600, log='ui-build.log')
        # Capacitor's Console plugin uses Swift.print (stdout), not unified logging.
        # Attach only to this job's fresh simulator and keep geometry diagnostics
        # with its evidence; no user device or existing application data is read.
        app_console_file = (OUTPUT / 'app-console.log').open('w')
        app_console = subprocess.Popen(
            ['xcrun', 'simctl', 'launch', '--console-pty', '--terminate-running-process', simulator, ui.BUNDLE],
            stdout=app_console_file, stderr=subprocess.STDOUT,
            env={**os.environ, 'SIMCTL_CHILD_NSUnbufferedIO': 'YES'},
        )

        def phase(name, method, required):
            error = None
            result_path = OUTPUT / (name + '.xcresult')
            try:
                command(['xcodebuild', '-project', project['project'], '-scheme', project['name'], '-configuration', 'Debug',
                         '-destination', 'id=' + simulator, '-derivedDataPath', str(derived), 'CODE_SIGNING_ALLOWED=NO',
                         'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', '-parallel-testing-enabled', 'NO',
                         '-only-testing:' + project['name'] + '/NativeAcceptanceTests/' + method,
                         '-resultBundlePath', str(result_path), 'test-without-building'], timeout=900, log=name + '.log')
            except Exception as problem:
                error = problem
            finally:
                runner = Path(command(['xcrun', 'simctl', 'get_app_container', simulator, 'com.jianlibao.acceptance.xctrunner', 'data']).strip())
                captures = runner / 'Documents/jlb-ui'
                if captures.is_dir():
                    shutil.copytree(captures, OUTPUT / name)
            if error:
                raise error
            summary = json.loads(command(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(result_path)]))
            save(name + '-summary.json', summary)
            if not ui.summary_valid(summary, simulator):
                raise ValueError('Exact native test count/result/device failed')
            for capture in required:
                image, tree = OUTPUT / name / (capture + '.png'), OUTPUT / name / (capture + '.txt')
                if not image.is_file() or not tree.is_file() or ui.BUNDLE not in tree.read_text():
                    raise ValueError('Missing native screenshot/AX: ' + capture)
                if not bootstrap.frame_evidence(image, require_home=False)['nonBlank']:
                    raise ValueError('Blank native capture: ' + capture)
            result[name] = summary

        required = ['input-home-dark', 'input-body-decimal-dark', 'input-body-waist-dark', 'input-body-note-dark',
                    'input-body-saved', 'input-body-decimal-light', 'input-training-weight-dark',
                    'input-training-reps-dark', 'input-training-note-dark', 'input-training-saved']
        phase('created', 'testIosInputCreate', required)
        saved = ui.read_state(container)
        sessions, bodies = saved['data']['sessions'], saved['data']['bodyMetrics']
        if len(sessions) != 1 or len(bodies) != 1:
            raise ValueError('Exactly one explicit UI-saved session and body record required')
        session, body = sessions[0], bodies[0]
        first_set = session['exercises'][0]['sets'][0]
        if session['status'] != 'completed' or session['note'] != 'SIM-INPUT-TRAIN-20261023':
            raise ValueError('Explicit training save differs')
        if any(first_set.get(k) != v for k, v in {'weightKg': 40, 'reps': 8, 'status': 'completed'}.items()):
            raise ValueError('Numeric input/quick adjustment differs in SQLite')
        if any(body.get(k) != v for k, v in {'weightKg': 72.4, 'bodyFatPct': 18.5, 'note': 'SIM-INPUT-20261023\n第二行'}.items()) or body.get('measurements') != {'waist': 80}:
            raise ValueError('Body data or textarea newline differs in SQLite')
        save('saved-state.json', saved)
        persist_captures = ['input-persist-body', 'input-persist-training', 'input-persist-home']
        for name, reboot in [('reopened', False), ('rebooted', True)]:
            if reboot:
                command(['xcrun', 'simctl', 'shutdown', simulator])
                result['inputSystemReboot'] = bootstrap.wait_boot(simulator, phase='input-reboot', execute=command, output=OUTPUT)
            else:
                before_pid = bootstrap.launch_pid(command(['xcrun', 'simctl', 'launch', simulator, ui.BUNDLE]))
                command(['xcrun', 'simctl', 'terminate', simulator, ui.BUNDLE])
            next_pid = bootstrap.launch_pid(command(['xcrun', 'simctl', 'launch', simulator, ui.BUNDLE]))
            if not reboot and next_pid == before_pid:
                raise ValueError('Application relaunch must create a new PID')
            current_container = Path(command(['xcrun', 'simctl', 'get_app_container', simulator, ui.BUNDLE, 'data']).strip())
            current = ui.read_state(current_container)
            ui.assert_same_state(saved, current)
            save(name + '-before-ui-state.json', current)
            phase(name, 'testIosInputPersist', persist_captures)
            ui.assert_same_state(saved, ui.read_state(current_container))
        result.update(accepted=True, sameSimulatorRestarted=True, completePayloadUnchanged=True,
                      sourceCommit=__import__('os').environ.get('CM_COMMIT'))
    except Exception as error:
        result['error'] = str(error)
        raise
    finally:
        if simulator:
            try:
                command(['xcrun', 'simctl', 'spawn', simulator, 'log', 'show', '--style', 'compact',
                         '--last', '15m', '--info', '--debug', '--predicate',
                         'process == "App" AND eventMessage CONTAINS "JLB_IOS_INPUT"'], timeout=60, log='webview-layout.log')
            except Exception as error:
                result['layoutLogCollectionError'] = str(error)
            # Bootstrap may already have shut it down before a bundle assertion failed.
            cleanup = subprocess.run(['xcrun', 'simctl', 'shutdown', simulator], capture_output=True, text=True, timeout=60)
            if cleanup.returncode and 'current state: Shutdown' not in cleanup.stderr:
                result.update(accepted=False, cleanupError=cleanup.stderr[-2000:])
        if app_console:
            try:
                app_console.wait(timeout=10)
            except subprocess.TimeoutExpired:
                app_console.terminate()
                try:
                    app_console.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    app_console.kill()
                    app_console.wait(timeout=5)
        if app_console_file:
            app_console_file.close()
        save('input-result.json', result)
        # Keep screenshots/AX/results immediately retrievable without the large
        # xcresult video store. Both archives retain the actual native evidence.
        with zipfile.ZipFile(OUTPUT / 'input-captures.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for source in sorted(OUTPUT.rglob('*')):
                relative = source.relative_to(OUTPUT)
                if (source.is_file() and source.suffix in {'.png', '.txt', '.json', '.log'}
                        and not any(p in {'UITestDerivedData', 'UITestHarness'} or p.endswith('.xcresult') for p in relative.parts)):
                    archive.write(source, relative.as_posix())
        with zipfile.ZipFile(OUTPUT / 'input-evidence.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for source in sorted(OUTPUT.rglob('*')):
                relative = source.relative_to(OUTPUT)
                if source.is_file() and source.name not in {'input-evidence.zip', 'input-captures.zip'} and not any(p in relative.parts for p in ['UITestDerivedData', 'UITestHarness']):
                    archive.write(source, relative.as_posix())


if __name__ == '__main__':
    run()
