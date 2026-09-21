[CmdletBinding()]
param(
    [ValidateSet('Install', 'Start', 'Stop', 'Restart', 'Update', 'Status', 'Uninstall', 'Run')]
    [string]$Action = 'Status',
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = 'AgentDeck'
$dataRoot = Join-Path $env:LOCALAPPDATA 'AgentDeck'
$logsRoot = Join-Path $dataRoot 'logs'
$runRoot = Join-Path $dataRoot 'run'
$recordPath = Join-Path $runRoot 'process.json'
$entry = Join-Path $projectRoot 'dist\server\server\main.js'
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Get-AgentDeckTask {
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

function Test-Port([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $Port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

function Assert-PortsFree {
    if ((Test-Port 4310) -or (Test-Port 4311)) {
        throw 'Port 4310 or 4311 is already in use. Stop the existing service first; no unrelated process will be terminated.'
    }
}

function Resolve-Node {
    if (!$script:NodePath) { $script:NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
    if (!(Test-Path -LiteralPath $script:NodePath -PathType Leaf)) { throw 'Node.js executable is missing. Reinstall the AgentDeck task after installing Node.js.' }
}

function Wait-Ready {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $status = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/status' -Headers @{ 'Sec-Fetch-Site' = 'same-origin' } -TimeoutSec 2
            if ($status.schemaVersion -eq 1 -and (Test-Port 4311)) {
                Write-Host 'AgentDeck is ready: http://127.0.0.1:4310'
                return
            }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "AgentDeck did not become ready. Inspect the task and logs in $logsRoot"
}

function Start-Instance {
    $task = Get-AgentDeckTask
    if (!$task) { throw 'AgentDeck is not installed. Run this script with -Action Install first.' }
    if ($task.State -eq 'Running') { Wait-Ready; return }
    Assert-PortsFree
    Start-ScheduledTask -TaskName $taskName
    Wait-Ready
}

function Stop-Instance {
    # Capture the child identity before stopping the scheduler wrapper. Never kill by port or name.
    $record = $null
    if (Test-Path -LiteralPath $recordPath) { $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json }
    $task = Get-AgentDeckTask
    if ($task) { Stop-ScheduledTask -TaskName $taskName }
    if ($record) {
        $owned = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
        if ($owned -and $owned.ProcessName -eq 'node' -and $owned.StartTime.ToUniversalTime().Ticks.ToString() -eq $record.startTicks) {
            Stop-Process -Id $owned.Id -ErrorAction Stop
            $owned.WaitForExit(10000) | Out-Null
        }
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $task = Get-AgentDeckTask
        if (!$task -or $task.State -ne 'Running') { break }
        Start-Sleep -Milliseconds 250
    }
    if ($task -and $task.State -eq 'Running') { throw 'The AgentDeck task did not stop.' }
    if (Test-Path -LiteralPath $recordPath) { Remove-Item -LiteralPath $recordPath }
    Write-Host 'AgentDeck background instance stopped. Data has been preserved.'
}

function Build-Project {
    Resolve-Node
    $npm = Join-Path (Split-Path -Parent $script:NodePath) 'npm.cmd'
    Push-Location -LiteralPath $projectRoot
    try {
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed. AgentDeck has not been started; fix the build and run Start.' }
    } finally { Pop-Location }
}

function Save-LegacyReferences {
    if (!(Test-Port 4310)) { return }
    $headers = @{ 'Sec-Fetch-Site' = 'same-origin' }
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/status' -Headers $headers -TimeoutSec 5
    if ($status.navigation -eq 'files') { return }
    $entries = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/entries' -Headers $headers -TimeoutSec 15
    $references = [ordered]@{}
    foreach ($item in $entries) {
        if ($item.id -match '^[a-fA-F0-9]{32}$' -and $item.mountId -and $item.relativePath) {
            $references[$item.id] = 'file:' + $item.mountId + ':' + $item.relativePath
        }
    }
    if ($references.Count -eq 0) { return }
    $stateRoot = Join-Path $dataRoot 'state'
    $mappingFile = Join-Path $stateRoot 'legacy-file-references.json'
    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    [IO.File]::WriteAllText(($mappingFile + '.tmp'), ($references | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath ($mappingFile + '.tmp') -Destination $mappingFile -Force
    Write-Host ('Preserved ' + $references.Count + ' legacy file references without scanning.')
}

switch ($Action) {
    'Run' {
        Resolve-Node
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $mutex = New-Object System.Threading.Mutex($false, "Local\AgentDeck-$sid")
        $locked = $false
        $child = $null
        $exitCode = 1
        try {
            try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
            if (!$locked) { throw 'Another AgentDeck background runner is active.' }
            Assert-PortsFree
            if (!(Test-Path -LiteralPath $entry)) { throw 'Build AgentDeck before starting it.' }
            New-Item -ItemType Directory -Force -Path $logsRoot, $runRoot | Out-Null
            # Keep recovery in the runner: scheduler retries did not fire reliably
            # for demand-started tasks on the verified Windows installation.
            for ($attempt = 0; $attempt -le 3; $attempt++) {
                Assert-PortsFree
                $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
                $stdout = Join-Path $logsRoot "$stamp.stdout.log"
                $stderr = Join-Path $logsRoot "$stamp.stderr.log"
                $child = Start-Process -FilePath $NodePath -ArgumentList ('"' + $entry + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
                @{ pid = $child.Id; startTicks = $child.StartTime.ToUniversalTime().Ticks.ToString(); projectRoot = $projectRoot; stdout = $stdout; stderr = $stderr } | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
                $child.WaitForExit()
                $child.Dispose()
                $child = $null
                Remove-Item -LiteralPath $recordPath -ErrorAction SilentlyContinue
                "$(Get-Date -Format o) Node exited unexpectedly (attempt $($attempt + 1)/4)." | Add-Content -LiteralPath (Join-Path $logsRoot 'runner.log')
                if ($attempt -lt 3) { Start-Sleep -Seconds 60 }
            }
            # Exhausted retries must report failure, never a nullable child ExitCode.
            $exitCode = 1
        } catch {
            New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null
            "$(Get-Date -Format o) $_" | Add-Content -LiteralPath (Join-Path $logsRoot 'runner.log')
        } finally {
            if ($child -and !$child.HasExited) { $child.Kill(); $child.WaitForExit() }
            if ($locked) {
                if (Test-Path -LiteralPath $recordPath) { Remove-Item -LiteralPath $recordPath }
                $mutex.ReleaseMutex()
            }
            $mutex.Dispose()
        }
        exit $exitCode
    }
    'Install' {
        Resolve-Node
        if (Get-AgentDeckTask) { Stop-Instance }
        Assert-PortsFree
        Build-Project
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '" -Action Run -NodePath "' + $NodePath + '"'
        $execution = New-ScheduledTaskAction -Execute $powershellExe -Argument $arguments -WorkingDirectory $projectRoot
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
        $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $execution -Trigger $trigger -Principal $principal -Settings $settings -Description 'AgentDeck local background server; persistent data is outside the checkout.' -Force | Out-Null
        Start-Instance
    }
    'Start' { Start-Instance }
    'Stop' { Stop-Instance }
    'Restart' { Stop-Instance; Start-Instance }
    'Update' { Save-LegacyReferences; Stop-Instance; Build-Project; Start-Instance }
    'Uninstall' {
        Stop-Instance
        if (Get-AgentDeckTask) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
        Write-Host 'AgentDeck autostart removed. State, logs and mounted files have been preserved.'
    }
    'Status' {
        $task = Get-AgentDeckTask
        if ($task) {
            $info = Get-ScheduledTaskInfo -TaskName $taskName
            [pscustomobject]@{ Task = $taskName; State = $task.State; LastRunTime = $info.LastRunTime; LastTaskResult = $info.LastTaskResult } | Format-List | Out-Host
        }
        else { Write-Host 'AgentDeck autostart is not installed.' }
        Write-Host "Project: $projectRoot"
        Write-Host "Data: $dataRoot"
        Write-Host "Logs: $logsRoot"
        Write-Host "Port 4310: $(Test-Port 4310); Port 4311: $(Test-Port 4311)"
        if ($task -and $task.State -eq 'Running') { Wait-Ready }
    }
}
