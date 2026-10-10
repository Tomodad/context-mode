$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    # No execution-policy override, profiles, persistent compiler, or native build.
    Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-process-job.cs')))
    $request = [Console]::In.ReadLine() | ConvertFrom-Json
    if ($null -eq $request) { exit 1 }
    exit [ContextModeWindowsJob]::Run([string]$request.exe, [string]$request.commandLine,
        [string]$request.cwd, [string]$request.environmentBlock, [string]$request.jobName,
        [bool]$request.terminateDescendantsOnRootExit)
} catch {
    # Do not include request/environment/command text in diagnostics.
    [Console]::Error.WriteLine('[context-mode job] helper failed: ' + $_.Exception.GetType().Name)
    exit 1
}
