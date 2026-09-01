<#
.SYNOPSIS
    Builds a release APK, bumps the app version in mobile/app.json and
    backend/app/config.py, and uploads the APK to S3.

.PARAMETER Version
    New version string, e.g. "1.0.3". Required.

.PARAMETER ReleaseNotes
    Release notes for this version. Separate multiple lines with "|".
    Example: "Bug fixes|Performance improvements|UI polish"
    If omitted, defaults to "Bug fixes and improvements."

.PARAMETER SkipBuild
    Skip the gradlew assembleRelease step (use the existing APK on disk).

.PARAMETER ApiBaseUrl
    Backend base URL baked into the release build via EXPO_PUBLIC_API_URL.
    Defaults to the production EC2 host on port 80 (through Nginx).

.EXAMPLE
    .\release-apk.ps1 -Version 1.0.3
    .\release-apk.ps1 -Version 1.0.3 -ReleaseNotes "Bug fixes|New features|Performance improvements"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [string]$ReleaseNotes = "Bug fixes and improvements.",

    [switch]$SkipBuild,

    [string]$ApiBaseUrl = "http://13.126.206.167"
)

$ErrorActionPreference = "Stop"

$repoRoot    = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$mobileDir   = Join-Path $repoRoot "mobile"
$androidDir  = Join-Path $mobileDir "android"
$apkPath     = Join-Path $androidDir "app\build\outputs\apk\release\app-release.apk"
$appJsonPath = Join-Path $mobileDir "app.json"
$configPath  = Join-Path $repoRoot "backend\app\config.py"

$s3Bucket    = "apk-buket"
$s3Key       = "app-release.apk"

# Windows PowerShell 5.1's Get-Content/Set-Content -Encoding utf8 either
# misreads BOM-less files as the system ANSI codepage or writes a BOM back
# in. Read and write with an explicit BOM-less UTF-8 codec via .NET instead.
function Get-FileContentUtf8([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Set-FileContentUtf8NoBom([string]$Path, [string]$Content) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

# ── 1. Bump mobile/app.json ──────────────────────────────────────────────────
# Done before the build so the version baked into the JS bundle matches $Version.
Write-Host "Updating mobile/app.json version -> $Version" -ForegroundColor Cyan
$appJsonText = Get-FileContentUtf8 -Path $appJsonPath
$appJsonText = $appJsonText -replace '("version":\s*)"[^"]*"', "`${1}`"$Version`""
Set-FileContentUtf8NoBom -Path $appJsonPath -Content $appJsonText

# ── 2. Bump backend/app/config.py ────────────────────────────────────────────
Write-Host "Updating backend/app/config.py app_latest_version -> $Version" -ForegroundColor Cyan
$configText = Get-FileContentUtf8 -Path $configPath
$configText = $configText -replace 'app_latest_version: str = "[^"]*"', "app_latest_version: str = `"$Version`""

# Convert release notes from "|"-separated to "\n"-separated
$releaseNotesEscaped = $ReleaseNotes -replace '\|', '\n'
$configText = $configText -replace 'app_release_notes: str = "[^"]*"', "app_release_notes: str = `"$releaseNotesEscaped`""
Set-FileContentUtf8NoBom -Path $configPath -Content $configText

# ── 3. Build ────────────────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Host "Building release APK ($Version) for $ApiBaseUrl..." -ForegroundColor Cyan
    Push-Location $androidDir
    try {
        $env:EXPO_PUBLIC_API_URL = $ApiBaseUrl
        .\gradlew.bat assembleRelease
        if ($LASTEXITCODE -ne 0) { throw "gradlew assembleRelease failed with exit code $LASTEXITCODE" }
    } finally {
        Remove-Item Env:\EXPO_PUBLIC_API_URL -ErrorAction SilentlyContinue
        Pop-Location
    }
}

if (-not (Test-Path $apkPath)) {
    throw "APK not found at $apkPath"
}

# ── 4. Upload to S3 ───────────────────────────────────────────────────────────
Write-Host "Uploading APK to s3://$s3Bucket/$s3Key ..." -ForegroundColor Cyan
aws s3 cp $apkPath "s3://$s3Bucket/$s3Key" `
    --acl public-read `
    --content-type "application/vnd.android.package-archive"
if ($LASTEXITCODE -ne 0) { throw "aws s3 cp failed with exit code $LASTEXITCODE" }

Write-Host ""
Write-Host "Done. Version $Version built, bumped, and uploaded." -ForegroundColor Green
Write-Host "Remember to restart the backend so it picks up the new app_latest_version." -ForegroundColor Yellow
