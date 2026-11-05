$Url    = 'http://127.0.0.1:8204/mcp'
$Token  = '17f0a538a2e58bf8ab02531e26b98eb979bcea2f34b41fc588afef11051ff151'
$SopFile= 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\agent-memory-sop.md'
$log    = 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\ops\write-sec14.log'
"START $(Get-Date)" | Set-Content -Path $log -Encoding utf8
$script:SessionId = $null

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

# read SOP as UTF-8 and extract section 14 (ASCII markers only)
$sop = [System.IO.File]::ReadAllText($SopFile, [System.Text.Encoding]::UTF8)
$idx = $sop.IndexOf('## 14.')
if ($idx -lt 0) { Add-Content $log "FATAL: section 14 not found"; exit 1 }
$sec = $sop.Substring($idx)
Add-Content $log "SEC14_CHARS=$($sec.Length)"

$init = Send-Mcp -Method 'initialize' -Params @{ protocolVersion='2025-06-18'; capabilities=@{}; clientInfo=@{name='sec-writer';version='1.0'} }
Add-Content $log "INIT_STATUS=$($init.status)"
Send-Mcp -Method 'notifications/initialized' -Notification $true | Out-Null

$content = "[SOP v1.5 Section 14 - collector auto-ingest]`n`n" + $sec
$w = Send-Mcp -Method 'tools/call' -Params @{ name='write_memory'; arguments=@{ content=$content; project_id='P1'; category='context'; user_id='u1'; source_agent='workbuddy'; session_id=(New-Guid).ToString() } }
Add-Content $log "WRITE_STATUS=$($w.status)"
if ($w.body.result) {
    $t = ($w.body.result.content | ForEach-Object { $_.text }) -join ' '
    Add-Content $log "WRITE_RESULT: $($t.Substring(0,[Math]::Min(500,$t.Length)))"
} else { Add-Content $log "WRITE_BODY: $($w.body | ConvertTo-Json -Depth 5 -Compress)" }

Start-Sleep -Seconds 1
$v = Send-Mcp -Method 'tools/call' -Params @{ name='recall_memory'; arguments=@{ project_id='P1'; query='collector auto-ingest cursor dedup session log 5 min ingest'; top_k=5; mode='auto'; detail=$true } }
$vt = ''
if ($v.body.result.content) { $vt = ($v.body.result.content | ForEach-Object { $_.text }) -join "`n" }
$hit = if ($vt -match 'collector-cursor' -or $vt -match 'COLLECTOR_INTERVAL_MS' -or $vt -match 'Section 14') { 'YES' } else { 'NO' }
Add-Content $log "RECALL_HIT=$hit"
$ids = ([regex]::Matches($vt, 'mem_[0-9A-Z]{20,}')) | ForEach-Object { $_.Value } | Select-Object -Unique
Add-Content $log "MEMIDS: $($ids -join ',')"
Add-Content $log "DONE $(Get-Date)"
