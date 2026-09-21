# Manual acceptance test: temporarily restarts the installed background instance.
[CmdletBinding()]
param([switch]$IncludeCrashRecovery)
$ErrorActionPreference = 'Stop'
$manager = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\agentdeck.ps1'
$dataRoot = Join-Path $env:LOCALAPPDATA 'AgentDeck'
$recordFile = Join-Path $dataRoot 'run\process.json'
$stateFile = Join-Path $dataRoot 'state\registry.json'
function Assert($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Record { Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json }
function Check-Web {
    $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4310/'
    Assert ($response.StatusCode -eq 200) 'The main page did not load.'
    $asset = [regex]::Match($response.Content, '/assets/[^" ]+\.js').Value
    Assert ($asset.Length -gt 0) 'The main page has no compiled JavaScript asset.'
    Assert ((Invoke-WebRequest -UseBasicParsing ('http://127.0.0.1:4310' + $asset)).StatusCode -eq 200) 'The compiled asset did not load.'
    $snapshot = Invoke-RestMethod 'http://127.0.0.1:4310/api/projects' -Headers @{ 'Sec-Fetch-Site' = 'same-origin' }
    return $snapshot
}
$originalHash = if (Test-Path -LiteralPath $stateFile) { (Get-FileHash -LiteralPath $stateFile).Hash } else { $null }
$snapshot = Check-Web
$first = Record
& $manager -Action Start
Assert ((Record).pid -eq $first.pid) 'Repeated Start spawned another instance.'
& $manager -Action Stop
Assert (!(Get-Process -Id $first.pid -ErrorAction SilentlyContinue)) 'Stop left the original child alive.'
foreach ($port in @(4310,4311)) {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
    try { $listener.Start() } finally { $listener.Stop() }
}
& $manager -Action Start
$restored = Check-Web
Assert (($snapshot.projects | ConvertTo-Json -Depth 10 -Compress) -eq ($restored.projects | ConvertTo-Json -Depth 10 -Compress)) 'Projects changed after restart.'
Assert (($snapshot.mounts.id | ConvertTo-Json -Compress) -eq ($restored.mounts.id | ConvertTo-Json -Compress)) 'Mount IDs changed after restart.'
if ($IncludeCrashRecovery) {
    $beforeCrash = Record
    $owned = Get-Process -Id $beforeCrash.pid
    Assert ($owned.ProcessName -eq 'node' -and $owned.StartTime.ToUniversalTime().Ticks.ToString() -eq $beforeCrash.startTicks) 'The recorded process identity no longer matches.'
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Stop-Process -Id $owned.Id
    $recovered = $false
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        Start-Sleep -Seconds 1
        if (Test-Path -LiteralPath $recordFile) {
            $current = Record
            if ($current.pid -ne $beforeCrash.pid) {
                try { $null = Check-Web; $recovered = $true; break } catch { }
            }
        }
    }
    Assert $recovered 'The task did not recover from the forced child exit within 100 seconds.'
    Write-Host "Crash recovery passed in $([math]::Round($watch.Elapsed.TotalSeconds)) seconds."
}
if ($originalHash) { Assert ((Get-FileHash -LiteralPath $stateFile).Hash -eq $originalHash) 'The registry changed during lifecycle checks.' }
Write-Host 'PASS: repeated start, stop, released ports, restart, static assets and unchanged persistent configuration.'
