# Builds an installable APK on this machine, without the EAS queue.
#
# EAS remains the right way to produce an APK you hand to somebody: it holds
# the project's real release keystore, so every build it makes installs over
# the last one. This script is for iterating - a local build takes minutes
# instead of waiting behind other people's jobs.
#
#   .\build-apk.ps1                      # points at the deployed backend
#   .\build-apk.ps1 -ApiUrl http://192.168.1.17:4000
#   .\build-apk.ps1 -Clean               # after changing native config
#
# The APK lands in ..\..\dist\.

param(
    [string]$ApiUrl = 'https://ambulance-booking-api.onrender.com',
    [switch]$Clean,
    [string]$Sdk = "$env:USERPROFILE\Android\Sdk"
)

$ErrorActionPreference = 'Stop'
$app = $PSScriptRoot
$android = Join-Path $app 'android'
$distDir = Join-Path $app '..\..\dist'

if (-not (Test-Path $Sdk)) {
    throw "No Android SDK at $Sdk. Install it, or pass -Sdk with the right path."
}
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk

# EXPO_PUBLIC_* is read at bundle time, so the address is baked into the
# JavaScript. It is still changeable afterwards from the sign-in screen - this
# only decides what the app tries first.
$env:EXPO_PUBLIC_API_URL = $ApiUrl

# `android/` is build output: prebuild regenerates it from app.json, and it is
# gitignored for that reason. Regenerating each time means a change to app.json
# - a permission, a plugin - cannot be silently missed.
Write-Host "Regenerating the native project..." -ForegroundColor Cyan
Push-Location $app
try {
    npx expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw "expo prebuild failed" }
} finally { Pop-Location }

# prebuild rewrites the directory, so this has to be written after it.
#
# Forward slashes rather than escaped backslashes. A .properties file reads a
# backslash as an escape character, so a Windows path loses every segment that
# begins with a letter Java recognises - C:\Users\Adith\Android\Sdk arrives as
# C:UsersAdithAndroidSdk. Gradle then fails with "the filename, directory name,
# or volume label syntax is incorrect", which says nothing about the cause.
# Java accepts forward slashes on Windows, so there is nothing to escape.
$sdkForward = $Sdk.Replace('\', '/')
Set-Content -Path (Join-Path $android 'local.properties') -Value "sdk.dir=$sdkForward" -Encoding utf8

Write-Host "Building (API: $ApiUrl)..." -ForegroundColor Cyan
Push-Location $android
try {
    $tasks = if ($Clean) { @('clean', 'assembleRelease') } else { @('assembleRelease') }
    & .\gradlew.bat @tasks
    if ($LASTEXITCODE -ne 0) { throw "gradle build failed" }
} finally { Pop-Location }

$built = Join-Path $android 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $built)) { throw "Build reported success but produced no APK at $built" }

if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
$out = Join-Path $distDir 'AmbulanceBooking-local.apk'
Copy-Item $built $out -Force

$size = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ""
Write-Host "APK: $out  ($size MB)" -ForegroundColor Green
Write-Host "Backend: $ApiUrl"
Write-Host ""
Write-Host "Signed with the debug keystore, which is the React Native default." -ForegroundColor Yellow
Write-Host "It installs and runs, but its signature differs from the EAS build -" -ForegroundColor Yellow
Write-Host "so uninstall the other one first rather than installing over it." -ForegroundColor Yellow
