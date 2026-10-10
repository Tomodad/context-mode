$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    # Compatibility entry only: load the same verified managed release asset.
    # Never invoke Add-Type, csc or a runtime compilation fallback.
    $metadataPath = Join-Path $PSScriptRoot 'windows-job-runtime.json'
    if ((Get-Item -LiteralPath $metadataPath).Length -gt 4096) { throw 'manifest size' }
    $metadata = [IO.File]::ReadAllText($metadataPath) | ConvertFrom-Json
    if ($metadata.protocol -ne 'CMJ1') { throw 'protocol' }
    $sha = [Security.Cryptography.SHA256]::Create()
    function Digest($bytes) { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    foreach ($name in @('windows-process-job.cs', 'windows-job-entry.cs')) {
        if ((Get-Item -LiteralPath (Join-Path $PSScriptRoot $name)).Length -gt 1048576) { throw 'source size' }
        $text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $name)).Replace("`r`n", "`n")
        if ((Digest ([Text.Encoding]::UTF8.GetBytes($text))) -ne $metadata.sources.$name) { throw 'source mismatch' }
    }
    $assetPath = Join-Path $PSScriptRoot 'windows-job-runtime.exe'
    $size = (Get-Item -LiteralPath $assetPath).Length
    if ($size -ne $metadata.bytes -or $size -lt 1 -or $size -gt 10485760) { throw 'asset size' }
    $asset = [IO.File]::ReadAllBytes($assetPath)
    if ((Digest $asset) -ne $metadata.sha256) { throw 'asset mismatch' }
    [void][Reflection.Assembly]::Load($asset)
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
