# 把正在运行的 CliFleet 窗口截成 docs/screenshot-main.png
#
# 用法：先 scripts\demo-run.ps1 把应用跑起来、摆好两个终端标签，再运行本脚本。
#   pwsh -File scripts\shot.ps1                 # 存到 docs/screenshot-main.png
#   pwsh -File scripts\shot.ps1 -Out shot.png   # 存到别处
#
# 抓不到内容时会提示改用 Win+Shift+S（WebView2 是 GPU 合成，个别环境 PrintWindow 是黑的）。

param(
  [string]$Out = (Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\screenshot-main.png'),
  [int]$WaitSeconds = 30
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Shot {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@

# 1) 等窗口
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$p = $null
while ((Get-Date) -lt $deadline) {
  $p = Get-Process -Name clifleet -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 1
  if ($p) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $p) { throw "没找到 CliFleet 窗口——先把应用跑起来（scripts\demo-run.ps1）" }

$h = [IntPtr]$p.MainWindowHandle
[void][Shot]::ShowWindow($h, 9)                                   # SW_RESTORE
[void][Shot]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0043)  # TOPMOST | NOMOVE | NOSIZE | SHOWWINDOW
[void][Shot]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 1200

$r = New-Object Shot+RECT
[void][Shot]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L; $ht = $r.B - $r.T
if ($w -lt 400 -or $ht -lt 300) { throw "窗口太小或不可见（${w}x${ht}），先手动把窗口调大" }

# 2) 先试屏幕抓取（窗口已置顶）；黑了再退回 PrintWindow
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$g.Dispose()

function Get-DarkRatio($b) {
  $dark = 0; $total = 0
  for ($x = 0; $x -lt $b.Width; $x += 40) {
    for ($y = 0; $y -lt $b.Height; $y += 40) {
      $c = $b.GetPixel($x, $y); $total++
      if ($c.R -lt 8 -and $c.G -lt 8 -and $c.B -lt 8) { $dark++ }
    }
  }
  if ($total -eq 0) { return 1 }
  return $dark / $total
}

if ((Get-DarkRatio $bmp) -gt 0.97) {
  $bmp.Dispose()
  $bmp = New-Object System.Drawing.Bitmap $w, $ht
  $g2 = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g2.GetHdc()
  [void][Shot]::PrintWindow($h, $hdc, 2)   # PW_RENDERFULLCONTENT
  $g2.ReleaseHdc($hdc); $g2.Dispose()
  if ((Get-DarkRatio $bmp) -gt 0.97) {
    Write-Host "两种抓法都拿到黑图（GPU 合成 / 窗口被遮挡）。" -ForegroundColor Yellow
    Write-Host "改用 Win+Shift+S 截 CliFleet 窗口，直接覆盖 $Out" -ForegroundColor Yellow
    Write-Host "（窗口已置顶，现在应该就在最前面）" -ForegroundColor Yellow
  }
}

# 3) 保存
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "已保存：$Out（${w}x${ht}）" -ForegroundColor Green
