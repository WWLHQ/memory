<#
.SYNOPSIS  写入前落盘（pending）：把待写记忆先存到本地，再发起 MCP 写入。
           目的：写入被拒（E_L0_LOCKED / 进程挂掉 / 会话中断）时内容不丢，可原样重放。
  用法：powershell -NoProfile -ExecutionPolicy Bypass -File pending-write.ps1 -Content "<正文>" -Category fact
#>
param(
    [Parameter(Mandatory=$true)][string]$Content,
    [string]$ProjectId   = 'P1',
    [string]$Category    = 'context',
    [string]$UserId      = 'u1',
    [string]$SourceAgent = 'workbuddy',
    [string]$SessionId   = '',
    [string]$Dir         = ''
)

$ErrorActionPreference = 'Stop'
if (-not $Dir) { $Dir = Join-Path $PSScriptRoot 'pending' }
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$rand  = [System.Guid]::NewGuid().ToString('N').Substring(0,6)
$file  = Join-Path $Dir "$stamp-$rand.json"

$obj = [ordered]@{
    status       = 'pending'
    content      = $Content
    project_id   = $ProjectId
    category     = $Category
    user_id      = $UserId
    source_agent = $SourceAgent
    session_id   = $SessionId
    created_at   = (Get-Date).ToString('o')
}
$json = $obj | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($file, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "PENDING_SAVED=$file"
Write-Host "PENDING_CHARS=$($Content.Length)"
Write-Host "Next: call write_memory with the same content; on success delete this file; on E_L0_LOCKED keep it and run flush-pending.ps1 after unlock."
