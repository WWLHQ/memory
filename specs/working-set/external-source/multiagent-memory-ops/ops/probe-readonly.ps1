$Url = 'http://127.0.0.1:8204/mcp'
$Tok = '17f0a538a2e58bf8ab02531e26b98eb979bcea2f34b41fc588afef11051ff151'
$sid = $null

function Send-Mcp($m, $p, $n = $false) {
    $msg = @{ jsonrpc = '2.0'; id = 1; method = $m; params = $p }
    if ($n) { $msg.Remove('id') }
    $body = [System.Text.Encoding]::UTF8.GetBytes(($msg | ConvertTo-Json -Depth 12 -Compress))
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Method = 'POST'; $req.ContentType = 'application/json'; $req.Accept = 'application/json, text/event-stream'
    $req.Headers.Add('Authorization', "Bearer $Tok")
    if ($sid) { $req.Headers.Add('Mcp-Session-Id', $sid) }
    $rs = $req.GetRequestStream(); $rs.Write($body, 0, $body.Length); $rs.Close()
    $r = $null
    try { $r = $req.GetResponse() } catch [System.Net.WebException] { $r = $_.Exception.Response }
    $s = $r.Headers['Mcp-Session-Id']; if ($s) { $sid = $s }
    $sr = New-Object System.IO.StreamReader($r.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $buf = New-Object System.Text.StringBuilder
    $dl = [datetime]::Now.AddMilliseconds(60000)
    while ([datetime]::Now -lt $dl) {
        if ($sr.Peek() -eq -1) { Start-Sleep -Milliseconds 100; continue }
        $l = $sr.ReadLine(); [void]$buf.Append($l + "`n")
        if ($l -match '"result"' -or $l -match '"error"') { break }
    }
    $sr.Close(); $r.Close()
    return ($buf.ToString() | ConvertFrom-Json)
}

$init = Send-Mcp 'initialize' @{ protocolVersion = '2025-06-18'; capabilities = @{}; clientInfo = @{ name = 'probe'; version = '1.0' } }
"INIT=$($init.status)"
Send-Mcp 'notifications/initialized' $null $true | Out-Null

$u = Send-Mcp 'tools/call' @{ name = 'get_user_preferences'; arguments = @{ user_id = 'u1' } }
"PREFS=$($u.result.content.text)"

$rec = Send-Mcp 'tools/call' @{ name = 'recall_memory'; arguments = @{ project_id = 'P1'; query = 'L0 写密钥锁状态 静默启动'; top_k = 3; mode = 'auto'; detail = $true } }
"RECALL=$($rec.result.content.text)"
