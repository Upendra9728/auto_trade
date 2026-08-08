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

# ── 1. Build ────────────────────────────────────────────────────────────────
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

# ── 2. Bump mobile/app.json ──────────────────────────────────────────────────
Write-Host "Updating mobile/app.json version -> $Version" -ForegroundColor Cyan
$appJson = Get-Content $appJsonPath -Raw | ConvertFrom-Json
$appJson.expo.version = $Version
$appJson | ConvertTo-Json -Depth 20 | Set-Content -Path $appJsonPath -Encoding utf8

# ── 3. Bump backend/app/config.py ────────────────────────────────────────────
Write-Host "Updating backend/app/config.py app_latest_version -> $Version" -ForegroundColor Cyan
$configText = Get-Content $configPath -Raw
$configText = $configText -replace 'app_latest_version: str = "[^"]*"', "app_latest_version: str = `"$Version`""
Set-Content -Path $configPath -Value $configText -Encoding utf8 -NoNewline

# ── 4. Upload to S3 ───────────────────────────────────────────────────────────
Write-Host "Uploading APK to s3://$s3Bucket/$s3Key ..." -ForegroundColor Cyan
aws s3 cp $apkPath "s3://$s3Bucket/$s3Key" `
    --acl public-read `
    --content-type "application/vnd.android.package-archive"
if ($LASTEXITCODE -ne 0) { throw "aws s3 cp failed with exit code $LASTEXITCODE" }

Write-Host ""
Write-Host "Done. Version $Version built, bumped, and uploaded." -ForegroundColor Green
Write-Host "Remember to restart the backend so it picks up the new app_latest_version." -ForegroundColor Yellow
