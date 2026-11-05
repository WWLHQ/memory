$Ledger = 'C:\Users\LHQ\AppData\Roaming\MultiAgent Memory\memories.db.json'
$Doc    = 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\mcp-extension-contract.md'
$log    = 'D:\Work Folder\Agnet\WorkBuddy\WorkSpace\2026-11-02-21-32-38\multiagent-memory-ops\ops\contract-coverage.log'
"CHECK $(Get-Date)" | Set-Content -Path $log -Encoding utf8

if (-not (Test-Path $Ledger)) { Add-Content $log "FATAL ledger not found: $Ledger"; Write-Host "ledger missing"; exit 1 }
$t = [System.IO.File]::ReadAllText($Ledger)

$ver = 'v1.0'
if ([System.IO.File]::ReadAllText($Doc, [System.Text.Encoding]::UTF8) -match 'doc-version:\s*(v[0-9\.]+)') { $ver = $matches[1] }

# section headings actually present in the doc
$docText = [System.IO.File]::ReadAllText($Doc, [System.Text.Encoding]::UTF8)
$labels = @('Preamble')
foreach ($ln in ($docText -split "`r?`n")) { if ($ln -match '^##\s+([0-9]+)\.') { $labels += ('Section ' + $matches[1]) } }

$withMark = 0; $withoutMark = 0
foreach ($l in $labels) {
    $m = "[MCP Extension Contract $ver - $l]"
    $marked = ([regex]::Matches($t, [regex]::Escape($m))).Count
    # a collector-ingested copy has the heading text but no marker
    $heading = ''
    $plain = 0
    foreach ($ln in ($docText -split "`r?`n")) {
        if ($ln -match '^##\s+([0-9]+)\.' -and ('Section ' + $matches[1]) -eq $l) { $heading = $ln.Substring(3).Trim(); break }
    }
    if ($heading) { $plain = ([regex]::Matches($t, [regex]::Escape($heading))).Count }
    if ($marked -gt 0) { $st = 'MARKED'; $withMark++ }
    elseif ($plain -gt 0) { $st = 'COLLECTOR_ONLY'; $withoutMark++ }
    else { $st = 'MISSING' }
    Add-Content $log ("{0,-10} {1,-14} marker={2} headingHits={3}" -f $l, $st, $marked, $plain)
}
Add-Content $log "TOTAL=$($labels.Count) MARKED=$withMark COLLECTOR_ONLY=$withoutMark MISSING=$($labels.Count - $withMark - $withoutMark)"
Write-Host "sections=$($labels.Count) marked=$withMark collectorOnly=$withoutMark"
Write-Host "see $log"
