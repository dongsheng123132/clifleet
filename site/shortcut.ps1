# CliFleet desktop shortcut (Windows)
#
#   irm https://u-claw.org.cn/clifleet/shortcut.ps1 | iex
#
# Works for both the installed build and the portable (green) build.
# Auto-detects the exe, or pass -Exe for a portable copy in a custom folder:
#
#   irm https://u-claw.org.cn/clifleet/shortcut.ps1 -OutFile "$env:TEMP\s.ps1"
#   powershell -ExecutionPolicy Bypass -File "$env:TEMP\s.ps1" -Exe "D:\CliFleet\CliFleet.exe"
#
# Creates: Desktop\CliFleet.lnk (+ optional Start Menu). No install, no registry,
# no admin rights. Delete the .lnk files to undo.
# ASCII only: this is piped into `iex`.

param(
  [string]$Exe = "",
  [switch]$NoDesktop,
  [switch]$NoStartMenu,
  [switch]$Launch
)

$ErrorActionPreference = 'Stop'

function Find-CliFleet {
  if ($Exe) {
    if (Test-Path $Exe) { return (Resolve-Path $Exe).Path }
    throw "CliFleet.exe not found at: $Exe"
  }
  $candidates = @()
  $candidates += Join-Path $env:LOCALAPPDATA 'Programs\CliFleet\CliFleet.exe'
  $candidates += Join-Path (Get-Location) 'CliFleet.exe'
  # common places a portable copy ends up
  $desktop = [Environment]::GetFolderPath('Desktop')
  foreach ($base in @($desktop, (Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Desktop'))) {
    if (-not $base) { continue }
    $candidates += Get-ChildItem -Path $base -Filter 'CliFleet.exe' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
      Select-Object -First 3 -ExpandProperty FullName
  }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return (Resolve-Path $c).Path }
  }
  throw "Could not find CliFleet.exe. Pass it explicitly: -Exe 'D:\path\to\CliFleet\CliFleet.exe'"
}

$target = Find-CliFleet
$workdir = Split-Path -Parent $target
Write-Host "CliFleet: $target" -ForegroundColor Cyan

$shell = New-Object -ComObject WScript.Shell
$made = @()

function New-Lnk($path) {
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $target
  $lnk.WorkingDirectory = $workdir
  $lnk.IconLocation = "$target,0"
  $lnk.Description = 'CliFleet - run several AI coding CLIs side by side'
  $lnk.Save()
  return $path
}

if (-not $NoDesktop) {
  $desktopDir = [Environment]::GetFolderPath('Desktop')
  $made += New-Lnk (Join-Path $desktopDir 'CliFleet.lnk')
}
if (-not $NoStartMenu) {
  $programs = [Environment]::GetFolderPath('Programs')
  $made += New-Lnk (Join-Path $programs 'CliFleet.lnk')
}

foreach ($p in $made) { Write-Host "  created: $p" -ForegroundColor Green }
if ($made.Count -eq 0) { Write-Host "  nothing created (both switches set?)" -ForegroundColor Yellow }
Write-Host "Done. Double-click the CliFleet icon to start it."
if ($Launch) { Start-Process $target }
