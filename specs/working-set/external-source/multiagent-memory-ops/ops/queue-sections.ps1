<#
.SYNOPSIS  把文档的若干章节排入「待写队列」（pending），用于写密钥被锁时的内容保全。
           每个章节生成一个 pending JSON，解锁后用 flush-pending.ps1 统一重放。
  用法：powershell -NoProfile -ExecutionPolicy Bypass -File queue-sections.ps1 -Doc "<md路径>" -Sections "11,12" -Marker "MCP Extension Contract v1.0"
#>
param(
    [Parameter(Mandatory=$true)][string]$Doc,
    [Parameter(Mandatory=$true)][string]$SectionList,   # 逗号分隔的章节号，如 "11,12"
    [string]$Marker    = '',
    [string]$ProjectId = 'P1',
    [string]$Category  = 'context',
    [string]$UserId    = 'u1',
    [string]$SourceAgent = 'workbuddy',
    [string]$PendingDir = ''
)

$ErrorActionPreference = 'Stop'
$opsDir = $PSScriptRoot
if (-not $PendingDir) { $PendingDir = Join-Path $opsDir 'pending' }
if (-not (Test-Path $PendingDir)) { New-Item -ItemType Directory -Path $PendingDir -Force | Out-Null }

$text = [System.IO.File]::ReadAllText($Doc, [System.Text.Encoding]::UTF8)
$lines = $text -split "`r?`n"

# collect level-2 sections (key = "10") and level-3 subsections (key = "10.2")
$secMap = @{}
$subMap = @{}
$curNum = $null
$curSub = $null
$buf = New-Object System.Collections.ArrayList
$bufSub = New-Object System.Collections.ArrayList
foreach ($ln in $lines) {
    if ($ln -match '^##\s+([0-9]+(?:\.[0-9]+)*)\.?\s') {
        if ($null -ne $curNum) { $secMap[$curNum] = ($buf -join "`n") }
        if ($null -ne $curSub) { $subMap[$curSub] = ($bufSub -join "`n") }
        $curNum = $matches[1]; $curSub = $null
        [void]$buf.Clear(); [void]$bufSub.Clear()
        [void]$buf.Add($ln)
        continue
    }
    if ($ln -match '^###\s+([0-9]+(?:\.[0-9]+)*)\.?\s') {
        if ($null -ne $curSub) { $subMap[$curSub] = ($bufSub -join "`n") }
        $curSub = $matches[1]
        [void]$bufSub.Clear()
        [void]$bufSub.Add($ln)
        [void]$buf.Add($ln)
        continue
    }
    [void]$buf.Add($ln)
    if ($null -ne $curSub) { [void]$bufSub.Add($ln) }
}
if ($null -ne $curNum) { $secMap[$curNum] = ($buf -join "`n") }
if ($null -ne $curSub) { $subMap[$curSub] = ($bufSub -join "`n") }
Write-Host "SECTIONS_FOUND=$(($secMap.Keys | Sort-Object) -join ',')"
Write-Host "SUBSECTIONS_FOUND=$(($subMap.Keys | Sort-Object) -join ',')"

if (-not $Marker) {
    if ($text -match 'doc-version:\s*(v[0-9\.]+)') { $ver = $matches[1] } else { $ver = 'v1.0' }
    $base = [System.IO.Path]::GetFileNameWithoutExtension($Doc)
    $Marker = "$base $ver"
}

$queued = 0
foreach ($s in ($SectionList -split ',')) {
    $s = $s.Trim()
    if (-not $s) { continue }
    $body = ''
    if ($secMap.ContainsKey($s)) {
        $body = $secMap[$s].Trim()
    } elseif ($subMap.ContainsKey($s)) {
        # a parent subsection also includes all its children (10.2 -> 10.2.1, 10.2.2, ...)
        $parts = @($subMap[$s])
        foreach ($k in ($subMap.Keys | Sort-Object)) { if ($k -like ($s + '.*')) { $parts += $subMap[$k] } }
        $body = ($parts -join "`n`n").Trim()
    } else {
        Write-Host "MISSING_SECTION=$s"; continue
    }
    if ($body.Length -lt 120) { Write-Host "SKIP_TOO_SHORT=$s"; continue }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $rand  = [System.Guid]::NewGuid().ToString('N').Substring(0,6)
    $file  = Join-Path $PendingDir "$stamp-s$s-$rand.json"
    $content = "[$Marker - Section $s]`n`n" + $body

    $obj = [ordered]@{
        status       = 'pending'
        content      = $content
        project_id   = $ProjectId
        category     = $Category
        user_id      = $UserId
        source_agent = $SourceAgent
        session_id   = ''
        created_at   = (Get-Date).ToString('o')
    }
    [System.IO.File]::WriteAllText($file, ($obj | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "QUEUED Section $s -> $file (chars=$($content.Length))"
    $queued++
}
Write-Host "QUEUED_TOTAL=$queued  DIR=$PendingDir"
Write-Host "Unlock the write key, then run: flush-pending.ps1"
