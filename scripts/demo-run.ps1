# 启动 CliFleet 的「演示实例」——用于拍主图 / 录 GIF
#
# 特点：独立数据目录（<仓库>/.demo-data），不碰你真实的 ~/.clifleet，
# 也不会触发从 ~/.opencodex 的历史数据迁移。演示项目是英文路径的干净仓库。
#
# 用法：右键 → 使用 PowerShell 运行；或  pwsh -File scripts\demo-run.ps1
# 起来之后：
#   1) 点右上角 + 开第二个终端标签
#   2) 两个标签分别敲 claude / codex（或点快捷词）
#   3) 另开一个窗口运行  scripts\shot.ps1  拍图

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$demoHome = Join-Path $root '.demo-data'
$demoRoot = 'C:\dev'

# 1) 干净的演示仓库（已存在则不动）
foreach ($name in @('web-app', 'api-service')) {
  $dir = Join-Path $demoRoot $name
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force $dir | Out-Null
    Set-Content -Path (Join-Path $dir 'README.md') -Value "# $name`n`nDemo repository used for screenshots." -Encoding UTF8
  }
  if (-not (Test-Path (Join-Path $dir '.git'))) {
    Push-Location $dir
    git init -q
    git -c user.name=dev -c user.email=dev@local add -A
    git -c user.name=dev -c user.email=dev@local commit -qm 'init'
    Pop-Location
  }
}

# 2) 独立任务列表（两个演示项目）
New-Item -ItemType Directory -Force $demoHome | Out-Null
$tasksFile = Join-Path $demoHome 'tasks.json'
if (-not (Test-Path $tasksFile)) {
  @{
    version = 1
    tasks = @(
      @{ id = 't-web'; name = 'web-app';     dir = (Join-Path $demoRoot 'web-app');     order = 1; last_opened_at = 1750000000000; created_at = 1740000000000 },
      @{ id = 't-api'; name = 'api-service'; dir = (Join-Path $demoRoot 'api-service'); order = 2; last_opened_at = 1749000000000; created_at = 1740000000000 }
    )
  } | ConvertTo-Json -Depth 5 | Set-Content -Path $tasksFile -Encoding UTF8
}

# 3) 启动（vite + tauri dev）
$env:CLIFLEET_HOME = $demoHome
Write-Host "CLIFLEET_HOME = $demoHome" -ForegroundColor Cyan
Write-Host "演示项目      = $demoRoot\web-app, $demoRoot\api-service" -ForegroundColor Cyan
Write-Host "开第二个标签、分别跑 claude / codex，然后运行 scripts\shot.ps1 拍图" -ForegroundColor Yellow
Set-Location $root
pnpm tauri dev
