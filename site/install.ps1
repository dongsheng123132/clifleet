# CliFleet one-line installer (Windows)
#
#   irm https://u-claw.org.cn/clifleet/install.ps1 | iex      <- 国内源（推荐）
#   irm https://clifleet.vercel.app/install.ps1 | iex         <- 海外/备用
#
# What it does: resolve the latest version -> download the portable zip ->
# verify SHA256 -> extract to %LOCALAPPDATA%\Programs\CliFleet -> add a
# Start Menu shortcut. Re-run it any time to upgrade (your data is kept).
# It does not touch system environment variables, install a service,
# or modify any CLI configuration.
# Uninstall: delete that folder and the shortcut.
#
# ASCII only on purpose: this script is piped into `iex` and must not
# depend on the console/serving charset.

param(
  [string]$Version = "",
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\CliFleet",
  [switch]$NoShortcut,
  [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$repo = 'dongsheng123132/clifleet'
# Domestic mirror first (u-claw.org.cn, already ICP-filed and fast in CN);
# GitHub + third-party mirrors as fallback.
$cnBase = 'https://u-claw.org.cn'
$downloadSources = @(
  "$cnBase/download/clifleet",
  "https://github.com/$repo/releases/download",
  "https://ghfast.top/https://github.com/$repo/releases/download",
  "https://gh-proxy.com/https://github.com/$repo/releases/download"
)

function Resolve-Version {
  if ($Version) { return $Version }
  # 1) domestic version.json (GitHub API is often blocked in CN)
  try {
    $v = Invoke-RestMethod -Uri "$cnBase/clifleet/version.json" -TimeoutSec 15 -Headers @{ 'User-Agent' = 'clifleet-installer' }
    if ($v.version) { return $v.version }
  } catch { }
  # 2) GitHub API (fallback)
  foreach ($u in @(
      "https://api.github.com/repos/$repo/releases/latest",
      "https://gh-proxy.com/https://api.github.com/repos/$repo/releases/latest"
    )) {
    try {
      $api = Invoke-RestMethod -Uri $u -TimeoutSec 20 -Headers @{ 'User-Agent' = 'clifleet-installer' }
      if ($api.tag_name) { return $api.tag_name }
    } catch { }
  }
  throw "Could not resolve the latest version. Pass it explicitly: -Version v0.6.1"
}

function Get-ReleaseFile($tail, $out) {
  foreach ($src in $downloadSources) {
    # domestic path has no version segment: /download/clifleet/<file>;
    # GitHub-style sources need <tag>/<file>
    $url = if ($src.StartsWith($cnBase)) { "$src/$tail" } else { "$src/$tag/$tail" }
    try {
      Write-Host "  downloading $tail ..." -NoNewline
      Invoke-WebRequest -Uri $url -OutFile $out -TimeoutSec 300 -UseBasicParsing
      Write-Host " ok"
      return $url
    } catch {
      Write-Host " failed, trying next source"
    }
  }
  throw "All download sources failed for $tail. Retry, or download manually from https://u-claw.org.cn/clifleet/"
}

$tag = Resolve-Version
Write-Host "CliFleet $tag" -ForegroundColor Cyan

$tmp = Join-Path $env:TEMP ("clifleet-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  $zip = Join-Path $tmp 'clifleet.zip'
  Get-ReleaseFile "CliFleet-$tag-windows-x64-portable.zip" $zip | Out-Null

  # SHA256 check (skipped with a warning if the manifest cannot be fetched)
  try {
    $sumsPath = Join-Path $tmp 'SHA256SUMS.txt'
    Get-ReleaseFile 'SHA256SUMS.txt' $sumsPath | Out-Null
    $line = Get-Content $sumsPath | Where-Object { $_ -match 'windows-x64-portable\.zip$' } | Select-Object -First 1
    if ($line) {
      $expected = ($line -split '\s+')[0].ToLower()
      $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
      if ($expected -ne $actual) { throw "SHA256 mismatch (expected $expected / got $actual) - aborted." }
      Write-Host "  SHA256 verified" -ForegroundColor Green
    }
  } catch {
    if ($_.Exception.Message -like 'SHA256*') { throw }
    Write-Host "  SHA256 check skipped (manifest unavailable)" -ForegroundColor Yellow
  }

  $hadOld = Test-Path $InstallDir
  if ($hadOld) { Remove-Item $InstallDir -Recurse -Force }
  New-Item -ItemType Directory -Force $InstallDir | Out-Null
  Expand-Archive -Path $zip -DestinationPath $InstallDir -Force
  $exe = Join-Path $InstallDir 'CliFleet.exe'
  if (-not (Test-Path $exe)) { throw "CliFleet.exe not found after extraction" }

  if (-not $NoShortcut) {
    $lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'CliFleet.lnk'
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = $exe
    $s.WorkingDirectory = $InstallDir
    $s.Description = 'CliFleet - run several AI coding CLIs side by side'
    $s.Save()
    Write-Host "  Start Menu shortcut created" -ForegroundColor Green
  }

  Write-Host ""
  if ($hadOld) {
    Write-Host "Upgraded to $tag  ->  $exe" -ForegroundColor Green
  } else {
    Write-Host "Installed $tag  ->  $exe" -ForegroundColor Green
  }
  Write-Host "Your project list and settings are kept (they live in %USERPROFILE%\.clifleet)."
  Write-Host "First run may show 'Windows protected your PC': click More info -> Run anyway (unsigned build)."
  if ($Launch) { Start-Process $exe }
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
