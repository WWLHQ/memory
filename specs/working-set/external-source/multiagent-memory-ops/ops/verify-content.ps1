$Url   = 'http://127.0.0.1:8204/mcp'
$Token = '17f0a538a2e58bf8ab02531e26b98eb979bcea2f34b41fc588afef11051ff151'
$log   = 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\ops\verify-content.log'
$qf    = 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\ops\queries.txt'
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

$init = Send-Mcp -Method 'initialize' -Params @{ protocolVersion='2025-06-18'; capabilities=@{}; clientInfo=@{name='verify-v14';version='1.0'} }
Add-Content $log "INIT_STATUS=$($init.status)"
Send-Mcp -Method 'notifications/initialized' -Notification $true | Out-Null

$queries = [System.IO.File]::ReadAllLines($qf, [System.Text.Encoding]::UTF8) | Where-Object { $_.Trim().Length -gt 0 }
foreach ($q in $queries) {
    $r = Send-Mcp -Method 'tools/call' -Params @{ name='recall_memory'; arguments=@{ project_id='P1'; query=$q; top_k=5; mode='auto'; detail=$true } }
    $txt = ''
    if ($r.body.result.content) { $txt = ($r.body.result.content | ForEach-Object { $_.text }) -join "`n" }
    Add-Content $log "==== QUERY: $q"
    $blocks = $txt -split '(?="mem_id")'
    foreach ($b in $blocks) {
        $idm = [regex]::Match($b, '"mem_id":\s*"(mem_[0-9A-Z]+)"')
        if (-not $idm.Success) { continue }
        $cm = [regex]::Match($b, '"content":\s*"((?:[^"\\]|\\.)*)"')
        $content = ''
        if ($cm.Success) { $content = $cm.Groups[1].Value } else { $content = $b }
        try { $content = $content | ConvertFrom-Json } catch { }
        $flat = ($content -replace "`r?`n", ' | ')
        if ($flat.Length -gt 260) { $flat = $flat.Substring(0,260) }
        $hasV = if ($content -match 'v1\.5' -or $content -match 'COLLECTOR_INTERVAL_MS' -or $content -match 'collector-cursor') { 'HIT' } else { '---' }
        Add-Content $log "[$hasV] $($idm.Groups[1].Value) :: $flat"
    }
}
Add-Content $log "DONE $(Get-Date)"
