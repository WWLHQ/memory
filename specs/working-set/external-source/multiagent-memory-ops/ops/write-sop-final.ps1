$Url    = 'http://127.0.0.1:8204/mcp'
$Token  = '17f0a538a2e58bf8ab02531e26b98eb979bcea2f34b41fc588afef11051ff151'
$SopFile= 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\agent-memory-sop.md'
$log    = 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\ops\write-sop-final.log'
"START $(Get-Date)" | Set-Content -Path $log -Encoding utf8
$script:SessionId = $null

# ---- read SOP as UTF-8 (data, not code) : try UTF8-correct strategies first ----
$sopText = ''
$try = @{}
try { $try['ReadAllText_utf8'] = [System.IO.File]::ReadAllText($SopFile, [System.Text.Encoding]::UTF8) } catch { $try['ReadAllText_utf8'] = '' }
try { $try['GetContent_Raw_utf8'] = (Get-Content -Path $SopFile -Raw -Encoding UTF8) } catch { $try['GetContent_Raw_utf8'] = '' }
try { $b = [System.IO.File]::ReadAllBytes($SopFile); $try['ReadAllBytes_utf8'] = [System.Text.Encoding]::UTF8.GetString($b) } catch { $try['ReadAllBytes_utf8'] = '' }
try { $try['ReadAllText_noenc'] = [System.IO.File]::ReadAllText($SopFile) } catch { $try['ReadAllText_noenc'] = '' }
foreach ($k in $try.Keys) { Add-Content $log "TRY $k LEN=$($try[$k].Length)" }
foreach ($k in @('ReadAllText_utf8','GetContent_Raw_utf8','ReadAllBytes_utf8','ReadAllText_noenc')) {
  if ($try[$k].Length -gt 1000) { $sopText = $try[$k]; Add-Content $log "PICKED=$k LEN=$($sopText.Length)"; break }
}
if ($sopText.Length -lt 1000) { Add-Content $log "FATAL: cannot read SOP file"; exit 1 }

# auto-detect version from ASCII marker line "<!-- sop-version: vX.Y -->"
$ver = 'v0'
if ($sopText -match 'sop-version:\s*(v[0-9\.]+)') { $ver = $matches[1] }
Add-Content $log "SOP_VERSION=$ver"

# ---- MCP client ----
function Send-Mcp {
    param([string]$Method, [object]$Params, [bool]$Notification=$false, [int]$ReadTimeoutMs=60000)
    $msg = @{ jsonrpc='2.0'; method=$Method }
    if (-not $Notification) { $msg.id = 1 }
    if ($null -ne $Params) { $msg.params = $Params }
    $body = [System.Text.Encoding]::UTF8.GetBytes(($msg | ConvertTo-Json -Depth 12 -Compress))
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Method = 'POST'; $req.ContentType = 'application/json'; $req.Accept = 'application/json, text/event-stream'
    $req.Headers.Add('Authorization', "Bearer $Token")
    if ($script:SessionId) { $req.Headers.Add('Mcp-Session-Id', $script:SessionId) }
    $req.Timeout = 90000; $req.ReadWriteTimeout = $ReadTimeoutMs
    $rs = $req.GetRequestStream(); $rs.Write($body, 0, $body.Length); $rs.Close()
    try { $resp = $req.GetResponse() } catch [System.Net.WebException] { if ($_.Exception.Response) { $resp = $_.Exception.Response } else { Add-Content $log "NET_ERR: $($_.Exception.Message)"; return $null } }
    $sid = $resp.Headers['Mcp-Session-Id']; if ($sid) { $script:SessionId = $sid }
    if ($Notification) { $st = [int]$resp.StatusCode; $resp.Close(); return @{ status=$st } }
    $sr2 = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $buf = New-Object System.Text.StringBuilder; $rawOut = New-Object System.Text.StringBuilder
    $deadline = [datetime]::Now.AddMilliseconds($ReadTimeoutMs)
    while ([datetime]::Now -lt $deadline) {
        if ($sr2.Peek() -eq -1) { Start-Sleep -Milliseconds 100; continue }
        $line = $sr2.ReadLine(); [void]$rawOut.Append($line); [void]$rawOut.Append("`n")
        if ($line -match '^\s*data:(.*)$') { $d=$matches[1].Trim(); if($d){[void]$buf.Append($d)}; if($d -match '"result"' -or $d -match '"error"'){ break } }
        else { if ($line -match '"result"' -or $line -match '"error"') { [void]$buf.Append($line); break } }
    }
    $sr2.Close(); $resp.Close()
    $src = if ($buf.Length -gt 0) { $buf.ToString() } else { $rawOut.ToString() }
    try { $p = $src | ConvertFrom-Json } catch { $p = $src }
    return @{ status=[int]$resp.StatusCode; body=$p }
}

$init = Send-Mcp -Method 'initialize' -Params @{ protocolVersion='2025-06-18'; capabilities=@{}; clientInfo=@{ name='sop-writer'; version='1.0' } }
Add-Content $log "INIT_STATUS=$($init.status)"
if ($init.status -ne 200) { Add-Content $log "FATAL: init failed"; exit 1 }
Send-Mcp -Method 'notifications/initialized' -Notification $true | Out-Null

# ---- split into 3 parts ----
$lines = $sopText -split "`r?`n"
$n = $lines.Count
$partSize = [math]::Ceiling($n / 3)
$parts = @()
for ($i=0; $i -lt 3; $i++) {
    $start = $i * $partSize
    if ($start -ge $n) { break }
    $end = [math]::Min($start + $partSize, $n) - 1
    $parts += ($lines[$start..$end] -join "`n")
}
Add-Content $log "PARTS=$($parts.Count) LINES=$n SIZES=$(($parts | ForEach-Object { $_.Length }) -join ',')"

# ---- write each part (idempotent; stop on L0 lock) ----
$okParts = 0
for ($i=0; $i -lt $parts.Count; $i++) {
    $idx = $i + 1
    $marker = "[Multi-Agent Memory SOP $ver - Part $idx/$($parts.Count)]"
    $content = $marker + "`n`n" + $parts[$i]

    $pre = Send-Mcp -Method 'tools/call' -Params @{ name='recall_memory'; arguments=@{ project_id='P1'; query="Multi-Agent Memory SOP $ver Part $idx source_agent"; top_k=3; mode='auto'; detail=$false } }
    $preTxt = ''
    if ($pre.body.result.content) { $preTxt = ($pre.body.result.content | ForEach-Object { $_.text }) -join "`n" }
    if ($preTxt -match ("SOP " + [regex]::Escape($ver) + " - Part " + $idx + "/" + $parts.Count)) { Add-Content $log "PART$idx ALREADY_EXISTS skip"; $okParts++; continue }

    $t0 = Get-Date
    $w = Send-Mcp -Method 'tools/call' -Params @{ name='write_memory'; arguments=@{ content=$content; project_id='P1'; category='context'; user_id='u1'; source_agent='workbuddy'; session_id=(New-Guid).ToString() } }
    $dt = ((Get-Date)-$t0).TotalSeconds
    Add-Content $log "PART$idx STATUS=$($w.status) ELAPSED=${dt}s CHARS=$($content.Length)"
    if ($w.body.result) {
        $resTxt = ($w.body.result.content | ForEach-Object { $_.text }) -join ' '
        if ($resTxt.Length -gt 400) { $resTxt = $resTxt.Substring(0,400) }
        Add-Content $log "PART$idx RESULT: $resTxt"
        if ($resTxt -match 'E_L0_LOCKED') {
            Add-Content $log "BLOCKED L0 write key locked. Unlock it in MultiAgent Memory > Security page, then re-run this script. Content is preserved in: $SopFile"
            Add-Content $log "DONE_BLOCKED"
            exit 2
        }
        if ($w.body.result.isError) { Add-Content $log "PART$idx IS_ERROR true"; continue }
        $okParts++
    } else { Add-Content $log "PART$idx BODY: $($w.body | ConvertTo-Json -Depth 5 -Compress)" }
}
Add-Content $log "OK_PARTS=$okParts/$($parts.Count)"

# ---- verify ----
Start-Sleep -Seconds 1
$v = Send-Mcp -Method 'tools/call' -Params @{ name='recall_memory'; arguments=@{ project_id='P1'; query="Multi-Agent Memory SOP $ver source_agent watchdog silent-start"; top_k=5; mode='auto'; detail=$false } }
$vTxt = ''
if ($v.body.result.content) { $vTxt = ($v.body.result.content | ForEach-Object { $_.text }) -join "`n" }
$hits = 0
if ($vTxt -match [regex]::Escape($ver)) { $hits++ }
if ($vTxt -match 'source_agent') { $hits++ }
if ($vTxt -match 'watchdog' -or $vTxt -match 'ensure-memory') { $hits++ }
Add-Content $log "VERIFY_HITS=$hits"
Add-Content $log "DONE_OK $(Get-Date)"
