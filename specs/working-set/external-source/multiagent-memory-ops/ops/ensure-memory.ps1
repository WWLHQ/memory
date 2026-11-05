<#
.SYNOPSIS
  多 Agent 记忆服务「静默拉起」前置探针。
  在任意 recall_memory / write_memory 调用之前运行本脚本：
    - 若服务在线，直接返回 online=true，不干扰；
    - 若服务掉线，静默启动 MultiAgent Memory.exe 并等待就绪后返回 online=true；
    - 仍失败则返回 online=false，由上层 Agent 走"如实说明、不伪造"分支。

  设计目标：避免「该写的没写、该读的没读」——把"服务是否在线"从
  Agent 的责任下沉为一个幂等、可重试、可观测的本地脚本。

.PARAMETER Url        MCP 端点（与 mcp.json 中一致）
.PARAMETER Token      Bearer Token（与 mcp.json 中一致）
.PARAMETER Exe        记忆服务可执行文件绝对路径
.PARAMETER TimeoutMs  单次探针超时（毫秒）
.PARAMETER MaxWaitMs  启动后最长等待就绪时间（毫秒）
.PARAMETER DryRun     只探测、只报告"会做什么"，绝不真正启动进程（安全自检用）
#>
param(
    [string]$Url        = 'http://127.0.0.1:8204/mcp',
    [string]$Token      = '17f0a538a2e58bf8ab02531e26b98eb979bcea2f34b41fc588afef11051ff151',
    [string]$Exe        = 'D:\Work Folder\Agnet\Deepseek Harness\2026-10-06-16-15-17\release\installer\win-unpacked\MultiAgent Memory.exe',
    [int]   $TimeoutMs  = 4000,
    [int]   $MaxWaitMs  = 10000,
    [switch]$DryRun
)

$ErrorActionPreference = 'SilentlyContinue'

function Test-Endpoint {
    param([string]$U, [string]$T, [int]$Ms)
    try {
        $r = Invoke-WebRequest -Uri $U -Method POST `
            -ContentType 'application/json' `
            -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"ensure-probe","version":"1.0"}}}' `
            -UseBasicParsing -TimeoutSec ([math]::Ceiling($Ms/1000)) `
            -Headers @{ 'Accept'='application/json, text/event-stream'; 'Authorization'="Bearer $T" }
        # 200=已就绪；401=服务在跑只是缺令牌——都算"可达/在线"
        return ($null -ne $r -and ($r.StatusCode -eq 200 -or $r.StatusCode -eq 401))
    } catch {
        return $false
    }
}

function Get-Proc {
    return (Get-Process -Name 'MultiAgent Memory' -ErrorAction SilentlyContinue | Select-Object -First 1)
}

$result = @{ online = $false; action = 'none'; pid = $null; reason = ''; ts = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') }

# 1) 已在线？直接返回
if (Test-Endpoint -U $Url -T $Token -Ms $TimeoutMs) {
    $p = Get-Proc
    $result.online = $true; $result.action = 'already_up'; $result.pid = if ($p) { $p.Id } else { $null }
    $result | ConvertTo-Json -Compress
    exit 0
}

# 2) 进程可能已在启动中（竞态）——若进程存在，先等它就绪，不重复拉起
$p = Get-Proc
if ($p) {
    $deadline = (Get-Date).AddMilliseconds($MaxWaitMs)
    while ((Get-Date) -lt $deadline) {
        if (Test-Endpoint -U $Url -T $Token -Ms $TimeoutMs) {
            $result.online = $true; $result.action = 'waited_startup'; $result.pid = $p.Id
            $result | ConvertTo-Json -Compress; exit 0
        }
        Start-Sleep -Milliseconds 500
    }
    $result.reason = 'process_running_but_not_responding'
} else {
    $result.reason = 'process_not_running'
}

# 3) 掉线 → 静默拉起
if ($DryRun) {
    $result.action = 'would_launch'; $result.reason = ($result.reason + ' [DryRun: not launched]')
    $result | ConvertTo-Json -Compress
    exit 0
}

try {
    Start-Process -FilePath $Exe -WindowStyle Hidden -ErrorAction Stop
} catch {
    $result.action = 'launch_failed'; $result.reason = $_.Exception.Message
    $result | ConvertTo-Json -Compress; exit 1
}

# 4) 拉起后轮询等待就绪
$deadline = (Get-Date).AddMilliseconds($MaxWaitMs)
while ((Get-Date) -lt $deadline) {
    if (Test-Endpoint -U $Url -T $Token -Ms $TimeoutMs) {
        $np = Get-Proc
        $result.online = $true; $result.action = 'launched'; $result.pid = if ($np) { $np.Id } else { $null }
        $result | ConvertTo-Json -Compress; exit 0
    }
    Start-Sleep -Milliseconds 500
}

$result.action = 'launch_timeout'; $result.reason = 'started_but_endpoint_not_ready_within_'+$MaxWaitMs+'ms'
$result | ConvertTo-Json -Compress
exit 1
