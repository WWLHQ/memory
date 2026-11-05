$Url    = 'http://127.0.0.1:8204/mcp'
$Token  = '17f0a538a2e58bf8ab02531e26b98eb979bcea2f34b41fc588afef11051ff151'
$DocFile= 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\mcp-extension-contract.md'
$Ledger = 'C:\Users\LHQ\AppData\Roaming\MultiAgent Memory\memories.db.json'
$log    = 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\ops\write-contract-sections.log'
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
    try { $resp=$req.GetResponse() } catch [System.Net.WebException] { if ($_.Exception.Response) { $resp=$_.Exception.Response } else { Add-Content $log "NET_ERR: $($_.Exception.Message)"; return $null } }
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

# ---- read + split by level-2 headings (ASCII markers only) ----
$doc = [System.IO.File]::ReadAllText($DocFile, [System.Text.Encoding]::UTF8)
$ver = 'v1.0'
if ($doc -match 'doc-version:\s*(v[0-9\.]+)') { $ver = $matches[1] }
Add-Content $log "DOC_VERSION=$ver CHARS=$($doc.Length)"

$lines = $doc -split "`r?`n"
$segments = @()
$cur = New-Object System.Collections.ArrayList
$curLabel = 'Preamble'
$curNum = ''
foreach ($ln in $lines) {
    if ($ln -match '^##\s+([0-9]+)\.') {
        if ($cur.Count -gt 0) { $segments += ,@($curLabel, $curNum, ($cur -join "`n")) }
        [void]$cur.Clear()
        $curLabel = 'Section ' + $matches[1]
        $curNum = $matches[1]
    }
    [void]$cur.Add($ln)
}
if ($cur.Count -gt 0) { $segments += ,@($curLabel, $curNum, ($cur -join "`n")) }
Add-Content $log "SEGMENTS=$($segments.Count) LABELS=$(($segments | ForEach-Object { $_[0] }) -join ',')"

$init = Send-Mcp -Method 'initialize' -Params @{ protocolVersion='2025-06-18'; capabilities=@{}; clientInfo=@{name='contract-writer';version='1.0'} }
Add-Content $log "INIT_STATUS=$($init.status)"
if ($init.status -ne 200) { Add-Content $log "FATAL init"; exit 1 }
Send-Mcp -Method 'notifications/initialized' -Notification $true | Out-Null

$ok = 0; $skip = 0; $fail = 0
foreach ($seg in $segments) {
    $label = $seg[0]; $num = $seg[1]; $body = $seg[2]
    if ($body.Trim().Length -lt 120) { continue }
    $marker = "[MCP Extension Contract $ver - $label]"
    $content = $marker + "`n`n" + $body.Trim()

    # deterministic dedup: exact marker lookup in the real ledger (semantic recall pre-check is unreliable)
    $already = $false
    try {
        $ledgerText = [System.IO.File]::ReadAllText($Ledger)
        $already = $ledgerText.Contains($marker)
    } catch { $already = $false }
    if ($already) { Add-Content $log "$label SKIP (marker already in ledger)"; $skip++; continue }

    $t0 = Get-Date
    $w = Send-Mcp -Method 'tools/call' -Params @{ name='write_memory'; arguments=@{ content=$content; project_id='P1'; category='context'; user_id='u1'; source_agent='workbuddy'; session_id=(New-Guid).ToString() } }
    $dt = ((Get-Date)-$t0).TotalSeconds
    if (-not $w.body.result) { Add-Content $log "$label FAIL $($w.body | ConvertTo-Json -Depth 4 -Compress)"; $fail++; continue }
    $t = ($w.body.result.content | ForEach-Object { $_.text }) -join ' '
    $mid = ([regex]::Match($t, '"mem_id":\s*"(mem_[0-9A-Z]+)"')).Groups[1].Value
    $act = ([regex]::Match($t, '"action":\s*"([a-z]+)"')).Groups[1].Value
    $sim = ([regex]::Match($t, '"sim":\s*([0-9\.]+)')).Groups[1].Value
    $lay = ([regex]::Match($t, '"graft_layer":\s*"([L0-9]+)"')).Groups[1].Value
    if ($t -match 'E_L0_LOCKED') {
        Add-Content $log "$label BLOCKED_L0 - unlock the write key in the Security page, then re-run this script."
        Add-Content $log "DONE_BLOCKED"; exit 2
    }
    Add-Content $log "$label OK mem=$mid dedup=$act sim=$sim layer=$lay elapsed=$([math]::Round($dt,2))s chars=$($content.Length)"
    $ok++
}
Add-Content $log "SUMMARY written=$ok skipped=$skip failed=$fail total=$($segments.Count)"

# ---- verify ----
Start-Sleep -Seconds 1
$v = Send-Mcp -Method 'tools/call' -Params @{ name='recall_memory'; arguments=@{ project_id='P1'; query='MCP Extension Contract manage_memory feedback importance write_memory'; top_k=5; mode='auto'; detail=$true } }
$vt = ''
if ($v.body.result.content) { $vt = ($v.body.result.content | ForEach-Object { $_.text }) -join "`n" }
$ids = ([regex]::Matches($vt, 'mem_[0-9A-Z]{20,}')) | ForEach-Object { $_.Value } | Select-Object -Unique
Add-Content $log "VERIFY_MEMIDS: $($ids -join ',')"
Add-Content $log "DONE $(Get-Date)"
