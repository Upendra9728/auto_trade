<#
.SYNOPSIS
    Builds a release APK, bumps the app version in mobile/app.json and
    backend/app/config.py, and uploads the APK to S3.

.PARAMETER Version
    New version string, e.g. "1.0.3". Required.

.PARAMETER SkipBuild
    Skip the gradlew assembleRelease step (use the existing APK on disk).

.EXAMPLE
    .\release-apk.ps1 -Version 1.0.3
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$SkipBuild
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

# Windows PowerShell 5.1's "-Encoding utf8" always prepends a BOM and
# ConvertTo-Json reformats/reflows the whole file. Write raw text back
# with plain UTF-8 (no BOM) via regex so the rest of the file is untouched.
function Set-FileContentUtf8NoBom([string]$Path, [string]$Content) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

# ── 1. Bump mobile/app.json ──────────────────────────────────────────────────
# Done before the build so the version baked into the JS bundle matches $Version.
Write-Host "Updating mobile/app.json version -> $Version" -ForegroundColor Cyan
$appJsonText = Get-Content $appJsonPath -Raw
$appJsonText = $appJsonText -replace '("version":\s*)"[^"]*"', "`${1}`"$Version`""
Set-FileContentUtf8NoBom -Path $appJsonPath -Content $appJsonText

# ── 2. Bump backend/app/config.py ────────────────────────────────────────────
Write-Host "Updating backend/app/config.py app_latest_version -> $Version" -ForegroundColor Cyan
$configText = Get-Content $configPath -Raw
$configText = $configText -replace 'app_latest_version: str = "[^"]*"', "app_latest_version: str = `"$Version`""
Set-FileContentUtf8NoBom -Path $configPath -Content $configText

# ── 3. Build ────────────────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Host "Building release APK ($Version)..." -ForegroundColor Cyan
    Push-Location $androidDir
    try {
        .\gradlew.bat assembleRelease
        if ($LASTEXITCODE -ne 0) { throw "gradlew assembleRelease failed with exit code $LASTEXITCODE" }
    } finally {
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
