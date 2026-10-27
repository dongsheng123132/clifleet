# 把 CliFleet 站点 + 安装脚本 + 安装包同步到国内镜像：https://u-claw.org.cn/clifleet/
#
#   pwsh -File scripts\sync-domestic.ps1                 # 用 package.json 的版本
#   pwsh -File scripts\sync-domestic.ps1 -SkipBinaries   # 只更新页面/脚本，不搬安装包
#
# 前置：本机已配好 ssh 别名 gz（见 ~/.ssh/config），远端可用 sudo -n。
# 目标机：/var/www/clifleet（站点，nginx location ^~ /clifleet/）
#         /var/www/dl-root/download/clifleet（安装包，走现有 /download/ 规则）
#
# 设计要点：
#  - 站点目录独立于 web-releases，换版不会丢；
#  - .ps1/.sh 由 nginx 按 text/plain; charset=utf-8 供给（否则 irm|iex 乱码）；
#  - 页面里的 /assets/ 会重写成 /clifleet/assets/（子路径部署）。

param(
  [string]$SshHost = "gz",
  [string]$Version = "",
  [string]$Repo = "dongsheng123132/clifleet",
  [switch]$SkipBinaries
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Version) { $Version = "v" + (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version }

Write-Host "== CliFleet $Version -> u-claw.org.cn/clifleet/ ==" -ForegroundColor Cyan

# 1) 本地构建 bundle
$stage = Join-Path $root '.deploy\clifleet'
Remove-Item (Join-Path $root '.deploy') -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $stage 'assets\shots') | Out-Null
Copy-Item (Join-Path $root 'site\index.html') $stage
Copy-Item (Join-Path $root 'site\install.ps1') $stage
Copy-Item (Join-Path $root 'site\install.sh') $stage
Copy-Item (Join-Path $root 'site\assets\*') (Join-Path $stage 'assets') -Recurse -Force

$enc = New-Object System.Text.UTF8Encoding($false)
$idx = Join-Path $stage 'index.html'
[IO.File]::WriteAllText($idx, ([IO.File]::ReadAllText($idx)).Replace('"/assets/', '"/clifleet/assets/'), $enc)

$vj = @{
  version = $Version
  tag     = $Version
  updated = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
  repo    = "https://github.com/$Repo"
} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $stage 'version.json'), $vj, $enc)

# SHA256SUMS（装脚本要用它校验）
try {
  Invoke-WebRequest "https://github.com/$Repo/releases/download/$Version/SHA256SUMS.txt" `
    -OutFile (Join-Path $stage 'SHA256SUMS.txt') -TimeoutSec 60 -UseBasicParsing
} catch { Write-Warning "SHA256SUMS 下载失败，安装脚本会跳过校验" }

$tar = Join-Path $root '.deploy\clifleet.tar.gz'
Remove-Item $tar -Force -ErrorAction SilentlyContinue
tar -czf $tar -C (Join-Path $root '.deploy') clifleet

# 2) 上传
Write-Host "uploading..." -ForegroundColor Yellow
scp -o BatchMode=yes $tar "${SshHost}:/tmp/clifleet.tar.gz"
ssh -o BatchMode=yes $SshHost @"
set -e
sudo -n mkdir -p /var/www/clifleet
sudo -n rm -rf /var/www/clifleet.new
sudo -n mkdir -p /var/www/clifleet.new
sudo -n tar -xzf /tmp/clifleet.tar.gz -C /var/www
sudo -n chown -R root:root /var/www/clifleet
sudo -n find /var/www/clifleet -type d -exec chmod 755 {} \;
sudo -n find /var/www/clifleet -type f -exec chmod 644 {} \;
echo 'files:'; ls /var/www/clifleet
"@

# 3) 安装包（可按需跳过）
if (-not $SkipBinaries) {
  Write-Host "syncing binaries..." -ForegroundColor Yellow
  $assets = @(
    "CliFleet-$Version-windows-x64-setup.exe",
    "CliFleet-$Version-windows-x64-portable.zip",
    "CliFleet-$Version-macos-arm64.dmg",
    "CliFleet-$Version-macos-x86_64.dmg",
    "CliFleet-$Version-linux-x86_64.deb",
    "SHA256SUMS.txt"
  ) -join ' '
  ssh -o BatchMode=yes $SshHost @"
set -e
V=$Version
D=/var/www/dl-root/download/clifleet
sudo -n mkdir -p \$D
for f in $assets ; do
  if sudo -n test -f "\$D/\$f"; then echo "skip \$f"; continue; fi
  curl -fsSL --max-time 600 -o /tmp/\$f "https://github.com/$Repo/releases/download/\$V/\$f" \
    && sudo -n mv /tmp/\$f \$D/ && echo "ok \$f" || echo "FAIL \$f"
done
sudo -n chown -R root:root \$D
sudo -n find \$D -type f -exec chmod 644 {} \;
"@
}

# 4) 验收
Write-Host "verifying..." -ForegroundColor Yellow
$urls = @(
  "https://u-claw.org.cn/clifleet/",
  "https://u-claw.org.cn/clifleet/version.json",
  "https://u-claw.org.cn/clifleet/install.ps1",
  "https://u-claw.org.cn/clifleet/install.sh",
  "https://u-claw.org.cn/clifleet/assets/app.css"
)
foreach ($u in $urls) {
  $code = curl.exe -s -o NUL -w "%{http_code}" --max-time 25 --noproxy '*' -I $u
  Write-Host ("  {0,-58} {1}" -f $u.Replace('https://u-claw.org.cn', ''), $code)
}
Write-Host "done. 国内安装命令：" -ForegroundColor Green
Write-Host "  Windows: irm https://u-claw.org.cn/clifleet/install.ps1 | iex"
Write-Host "  macOS/Linux: curl -fsSL https://u-claw.org.cn/clifleet/install.sh | sh"
