# 备选：不想双击 cmd，直接在终端跑（推荐，最稳）
# 用法：PowerShell 里 cd 到本目录，然后执行 .\start.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '  多Agent 记忆助手 · 本地演示' -ForegroundColor Cyan
Write-Host '  ----------------------------------------'
Write-Host '  通览页: http://127.0.0.1:5180/overview.html'
Write-Host '  首页  : http://127.0.0.1:5180/index.html'
Write-Host '  账号  : user_001 / demo1234'
Write-Host '  ----------------------------------------'
Write-Host ''

# 后端（后台）
$be = Start-Process -FilePath 'node' -ArgumentList 'tools/dev-backend.mjs' -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 3

# 打开浏览器
Start-Process 'http://127.0.0.1:5180/overview.html'

# 前端（前台，Ctrl+C 停止）
try {
  npx vite --host 127.0.0.1 --port 5180 --strictPort
}
finally {
  Write-Host ''
  Write-Host '前端已停止，正在关闭后端...'
  Stop-Process -Id $be.Id -Force -ErrorAction SilentlyContinue
}
