$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$env:ANDROID_HOME = Join-Path $projectRoot 'tools/android'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_AVD_HOME = Join-Path $env:ANDROID_HOME 'avd'
$nodePath = 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (!(Test-Path $nodePath)) { $nodePath = (Get-Command node).Source }
if (!(Test-Path 'dist/index.html')) { throw 'Please build the project first: pnpm build' }
try { $null = Invoke-WebRequest 'http://127.0.0.1:4173' -TimeoutSec 3 } catch {
    Start-Process -FilePath $nodePath -ArgumentList 'node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort' -WorkingDirectory $projectRoot -WindowStyle Hidden
}
$emulatorPath = Join-Path $env:ANDROID_HOME 'emulator/emulator.exe'
$adbPath = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
$acceleration = & $emulatorPath -accel-check 2>&1
$accelerated = $LASTEXITCODE -eq 0
$emulatorArgs = @('-avd','Jianlibao','-port','5556','-no-snapshot','-gpu','swiftshader')
if (!$accelerated) {
    Write-Host 'Hardware acceleration unavailable. Software boot may be very slow.'
    $emulatorArgs += @('-accel','off')
}
Start-Process -FilePath $emulatorPath -ArgumentList $emulatorArgs -WorkingDirectory $projectRoot
Write-Host 'Waiting for Android (up to 15 minutes)...'
$deadline = (Get-Date).AddMinutes(15)
do {
    Start-Sleep -Seconds 5
    $boot = & $adbPath -s emulator-5556 shell getprop sys.boot_completed 2>$null
} until ($boot -match '1' -or (Get-Date) -gt $deadline)
if ($boot -notmatch '1') { throw 'Android did not finish booting. Enable Windows Hypervisor Platform and restart Windows for acceleration.' }
& $adbPath -s emulator-5556 reverse tcp:4173 tcp:4173
& $adbPath -s emulator-5556 shell am start -a android.intent.action.VIEW -d 'http://localhost:4173'
Write-Host 'Jianlibao opened in Android browser.'
