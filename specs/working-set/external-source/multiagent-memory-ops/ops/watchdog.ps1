<#
.SYNOPSIS
  多 Agent 记忆服务看门狗（常驻保活）。
  - 周期探测 MCP 端点；掉线则静默拉起 MultiAgent Memory.exe；
  - 单实例运行，避免重复拉起；
  - 支持 -Install 注册"登录即启动"的计划任务，实现开机无人值守。

.PARAMETER IntervalSec  探测周期（秒），默认 30
.PARAMETER Once         仅执行一次探测+拉起后退出（用于手动/调试）
.PARAMETER Install      注册 Windows 计划任务（登录触发，开机自启守护）
.PARAMETER Uninstall    注销计划任务
.PARAMETER LogFile      日志文件，默认脚本同目录 watchdog.log
#>
param(
    [int]   $IntervalSec = 30,
    [switch]$Once,
    [switch]$Install,
    [switch]$Uninstall,
    [string]$LogFile     = ''
)

$Exe   = 'D:\Work Folder\Agnet\Deepseek Harness\2026-10-06-16-15-17\release\installer\win-unpacked\MultiAgent Memory.exe'
$Url   = 'http://127.0.0.1:8204/mcp'
$Token = '17f0a538a2e58bf8ab02531e26b98eb979bcea2f34b41fc588afef11051ff151'

if (-not $LogFile) { $LogFile = Join-Path $PSScriptRoot 'watchdog.log' }

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Test-Endpoint {
    try {
        $r = Invoke-WebRequest -Uri $Url -Method POST -ContentType 'application/json' `
            -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"watchdog","version":"1.0"}}}' `
            -UseBasicParsing -TimeoutSec 5 `
            -Headers @{ 'Accept'='application/json, text/event-stream'; 'Authorization'="Bearer $Token" }
        return ($null -ne $r -and ($r.StatusCode -eq 200 -or $r.StatusCode -eq 401))
    } catch { return $false }
}

function Ensure-Running {
    $up = Test-Endpoint
    if ($up) { return $true }
    $proc = Get-Process -Name 'MultiAgent Memory' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc) {
        try {
            Start-Process -FilePath $Exe -WindowStyle Hidden -ErrorAction Stop
            Log "LAUNCH 进程不存在，已静默拉起 exe"
        } catch {
            Log "ERROR 拉起失败: $($_.Exception.Message)"
            return $false
        }
    } else {
        Log "WARN 进程在跑但端点未就绪，等待启动…"
    }
    # 等待就绪
    $ok = $false
    for ($i=0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Endpoint) { $ok = $true; break }
    }
    if ($ok) { Log "OK 端点已就绪" } else { Log "ERROR 拉起后端点仍不可达" }
    return $ok
}

# ---- 安装 / 卸载计划任务 ----
if ($Uninstall) {
    Unregister-ScheduledTask -TaskName 'MultiAgentMemoryWatchdog' -Confirm:$false -ErrorAction SilentlyContinue
    Log "UNINSTALL 已注销计划任务"
    Write-Host "已注销计划任务 MultiAgentMemoryWatchdog"
    exit 0
}

if ($Install) {
    $taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>保活 MultiAgent Memory 记忆服务（静默拉起）</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
    <BootTrigger><Enabled>true</Enabled></BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions>
    <Exec><Command>powershell.exe</Command>
      <Arguments>-NoProfile -WindowStyle Hidden -File "$PSCommandPath"</Arguments></Exec>
  </Actions>
</Task>
"@
    $taskXml | Out-File -FilePath (Join-Path $env:TEMP 'mam_watchdog_task.xml') -Encoding unicode
    Register-ScheduledTask -TaskName 'MultiAgentMemoryWatchdog' -Xml (Get-Content (Join-Path $env:TEMP 'mam_watchdog_task.xml') -Raw) -Force -ErrorAction Stop
    Log "INSTALL 已注册计划任务（登录/开机自启）"
    Write-Host "已注册计划任务 MultiAgentMemoryWatchdog（登录即启动看护）"
    exit 0
}

# ---- 单次模式 ----
if ($Once) {
    $r = Ensure-Running
    Log "ONCE online=$r"
    Write-Host "{ `"online`": $r }"
    exit 0
}

# ---- 常驻循环 ----
Log "WATCHDOG 启动（间隔 ${IntervalSec}s）"
while ($true) {
    try { Ensure-Running | Out-Null } catch { Log "ERROR loop: $_" }
    Start-Sleep -Seconds $IntervalSec
}
