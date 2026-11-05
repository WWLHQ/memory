<#
.SYNOPSIS  重放待写记忆：把 ops/pending/ 下所有 pending 条目重新写入记忆库。
           幂等：已成功的条目会被移到 done/；仍被 L0 锁拦住的保持 pending 并退出码 2。
  用法：powershell -NoProfile -ExecutionPolicy Bypass -File flush-pending.ps1
#>
param(
    [string]$Dir = '',
    [switch]$DryRun
)

$Url    = 'http://127.0.0.1:8204/mcp'
$Token  = '17f0a538a2e58bf8ab02531e26b98eb979bcea2f34b41fc588afef11051ff151'
$log    = Join-Path $PSScriptRoot 'flush-pending.log'
if (-not $Dir) { $Dir = Join-Path $PSScriptRoot 'pending' }
$script:SessionId = $null

"FLUSH START $(Get-Date)" | Set-Content -Path $log -Encoding utf8

function Send-Mcp {
    param([string]$Method, [object]$Params, [bool]$Notification=$false, [int]$ReadTimeoutMs=60000)
    $msg = @{ jsonrpc='2.0'; method=$Method }
    if (-not $Notification) { $msg.id = 1 }
    if ($null -ne $Params) { $msg.params = $Params }
    $body = [System.Text.Encoding]::UTF8.GetBytes(($msg | ConvertTo-Json -Depth 12 -Compress))
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Method='POST'; $req.ContentType='application/json'; $req.Accept='application/json, text/event-stream'
    $req.Headers.Add('Authorization',"Bearer $Token")
    if ($script:SessionId) { $req.Headers.Add('Mcp-Session-Id',$script:SessionId) }
    $req.Timeout=90000; $req.ReadWriteTimeout=$ReadTimeoutMs
    $rs=$req.GetRequestStream(); $rs.Write($body,0,$body.Length); $rs.Close()
    try { $resp=$req.GetResponse() } catch [System.Net.WebException] { if ($_.Exception.Response) { $resp=$_.Exception.Response } else { Add-Content $log "NET_ERR"; return $null } }
    $sid=$resp.Headers['Mcp-Session-Id']; if($sid){$script:SessionId=$sid}
    if($Notification){ $st=[int]$resp.StatusCode; $resp.Close(); return @{status=$st} }
    $sr=New-Object System.IO.StreamReader($resp.GetResponseStream(),[System.Text.Encoding]::UTF8)
    $buf=New-Object System.Text.StringBuilder; $raw=New-Object System.Text.StringBuilder
    $dl=[datetime]::Now.AddMilliseconds($ReadTimeoutMs)
    while([datetime]::Now -lt $dl){
        if($sr.Peek() -eq -1){ Start-Sleep -Milliseconds 100; continue }
        $line=$sr.ReadLine(); [void]$raw.Append($line); [void]$raw.Append("`n")
        if($line -match '^\s*data:(.*)$'){ $d=$matches[1].Trim(); if($d){[void]$buf.Append($d)}; if($d -match '"result"' -or $d -match '"error"'){break} }
        else { if($line -match '"result"' -or $line -match '"error"'){ [void]$buf.Append($line); break } }
    }
    $sr.Close(); $resp.Close()
    $src = if($buf.Length -gt 0){$buf.ToString()}else{$raw.ToString()}
    try { $p=$src|ConvertFrom-Json } catch { $p=$src }
    return @{status=[int]$resp.StatusCode; body=$p}
}

if (-not (Test-Path $Dir)) { Add-Content $log "NO_PENDING_DIR"; Write-Host "NO_PENDING_DIR (nothing to flush)"; exit 0 }
$files = Get-ChildItem -Path $Dir -Filter '*.json' -File -ErrorAction SilentlyContinue
Add-Content $log "PENDING_FILES=$($files.Count)"
if ($files.Count -eq 0) { Write-Host "NOTHING_TO_FLUSH"; Add-Content $log "NOTHING_TO_FLUSH"; exit 0 }

if ($DryRun) {
    foreach ($f in $files) { Add-Content $log "DRYRUN would flush: $($f.Name)"; Write-Host "DRYRUN $($f.Name)" }
    exit 0
}

$init = Send-Mcp -Method 'initialize' -Params @{ protocolVersion='2025-06-18'; capabilities=@{}; clientInfo=@{name='pending-flush';version='1.0'} }
Add-Content $log "INIT_STATUS=$($init.status)"
if ($init.status -ne 200) { Add-Content $log "FATAL init"; exit 1 }
Send-Mcp -Method 'notifications/initialized' -Notification $true | Out-Null

$doneDir = Join-Path $Dir 'done'
if (-not (Test-Path $doneDir)) { New-Item -ItemType Directory -Path $doneDir -Force | Out-Null }

$ok = 0; $blocked = 0; $fail = 0
foreach ($f in $files) {
    $obj = $null
    try { $obj = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8) | ConvertFrom-Json } catch { }
    if (-not $obj -or -not $obj.content) { Add-Content $log "SKIP unreadable $($f.Name)"; $fail++; continue }

    $args = @{
        content      = $obj.content
        project_id   = $obj.project_id
        category     = $obj.category
        user_id      = $obj.user_id
        source_agent = $obj.source_agent
        session_id   = $obj.session_id
    }
    $w = Send-Mcp -Method 'tools/call' -Params @{ name='write_memory'; arguments=$args }
    $t = ''
    if ($w.body.result) { $t = ($w.body.result.content | ForEach-Object { $_.text }) -join ' ' }
    if ($t -match 'E_L0_LOCKED') {
        Add-Content $log "BLOCKED $($f.Name) - L0 write key locked; unlock in Security page then re-run"
        $blocked++; continue
    }
    $mid = ([regex]::Match($t, '"mem_id":\s*"(mem_[0-9A-Z]+)"')).Groups[1].Value
    if ($mid) {
        Move-Item -Path $f.FullName -Destination (Join-Path $doneDir $f.Name) -Force
        Add-Content $log "OK $($f.Name) -> mem=$mid"
        $ok++
    } else {
        Add-Content $log "FAIL $($f.Name) :: $($t.Substring(0,[Math]::Min(200,$t.Length)))"
        $fail++
    }
}
Add-Content $log "SUMMARY ok=$ok blocked=$blocked fail=$fail"
Write-Host "ok=$ok blocked=$blocked fail=$fail"
if ($blocked -gt 0) {
    Add-Content $log "DONE_BLOCKED"
    Write-Host "Locked items kept in $Dir - unlock the write key and re-run."
    exit 2
}
Add-Content $log "DONE_OK $(Get-Date)"
exit 0
