<#
.SYNOPSIS  直接通过 HTTP JSON-RPC 与 MultiAgent Memory (memagent-mcp) 握手，
           列出全部工具及其输入 schema，便于确认 write_memory 精确入参。
#>
$Url   = 'http://127.0.0.1:8204/mcp'
$Token = '17f0a538a2e58bf8ab02531e26b98eb979bcea2f34b41fc588afef11051ff151'

function Send-Mcp {
    param([string]$Method, [object]$Params, [bool]$Notification=$false)
    $msg = @{ jsonrpc='2.0'; method=$Method }
    if (-not $Notification) { $msg.id = 1 }
    if ($null -ne $Params) { $msg.params = $Params }
    $body = $msg | ConvertTo-Json -Depth 12 -Compress
    $headers = @{
        'Accept'='application/json, text/event-stream'
        'Content-Type'='application/json'
        'Authorization'="Bearer $Token"
    }
    if ($script:SessionId) { $headers['Mcp-Session-Id'] = $script:SessionId }
    try {
        $r = Invoke-WebRequest -Uri $Url -Method POST -Body $body -ContentType 'application/json' `
            -Headers $headers -UseBasicParsing -TimeoutSec 30
    } catch [System.Net.WebException] {
        $r = $_.Exception.Response
        if ($null -eq $r) { Write-Host "NET_ERR: $($_.Exception.Message)"; return $null }
    }
    # 捕获 session id
    $sidHeader = $r.Headers['Mcp-Session-Id']
    if ($sidHeader) { $script:SessionId = $sidHeader }
    $status = [int]$r.StatusCode
    if ($Notification) { return @{ status=$status } }
    $raw = ''
    if ($r.Content) { $raw = $r.Content }
    # 解析 SSE 或 JSON
    if ($raw -match 'data:') {
        $dataLines = ($raw -split "`n" | Where-Object { $_ -match '^\s*data:' } | ForEach-Object { $_.Substring($_.IndexOf('data:')+5).Trim() }) -join ''
        try { $parsed = $dataLines | ConvertFrom-Json } catch { $parsed = $dataLines }
    } else {
        try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $raw }
    }
    return @{ status=$status; body=$parsed }
}

# 1) initialize
$init = Send-Mcp -Method 'initialize' -Params @{
    protocolVersion='2025-06-18'
    capabilities=@{}
    clientInfo=@{ name='sop-writer'; version='1.0' }
}
Write-Host "INIT_STATUS=$($init.status)  SESSION=$script:SessionId"
if ($init.body -and $init.body.result) { Write-Host "SERVER: $($init.body.result.serverInfo | ConvertTo-Json -Compress)" }

# 2) initialized 通知
Send-Mcp -Method 'notifications/initialized' -Notification $true | Out-Null

# 3) tools/list
$list = Send-Mcp -Method 'tools/list' -Params @{}
if ($list.body.result -and $list.body.result.tools) {
    $tools = $list.body.result.tools
    Write-Host "`n=== TOOLS ($($tools.Count)) ==="
    foreach ($t in $tools) {
        Write-Host "`n--- $($t.name) ---"
        Write-Host ($t.description | Out-String).Trim()
        Write-Host "INPUT_SCHEMA:"
        Write-Host ($t.inputSchema | ConvertTo-Json -Depth 8)
    }
} else {
    Write-Host "LIST_RESULT: $($list.body | ConvertTo-Json -Depth 6 -Compress)"
}
