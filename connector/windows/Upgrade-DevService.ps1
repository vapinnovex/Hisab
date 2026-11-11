[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Verify-Payload.ps1')
# Lookup-only normalization: never assign this value back to StartName or SCM.
function ConvertTo-LocalSidAccount([string]$AccountName) {
    if ($AccountName -notmatch ('^'+[regex]::Escape($env:COMPUTERNAME)+'\\|^\.\\')) {
        throw 'Review the dedicated local service identity before upgrading.'
    }
    if ($AccountName.StartsWith('.\')) {
        return $env:COMPUTERNAME + '\' + $AccountName.Substring(2)
    }
    return $AccountName
}

$admin=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator required' }
$name='HishobRadioSoftDev'
$service=Get-CimInstance Win32_Service -Filter "Name='$name'"
if (-not $service) { throw 'No existing service. Use Install-DevService for a new installation.' }
$sidAccount=ConvertTo-LocalSidAccount $service.StartName
$identity=New-Object Security.Principal.NTAccount($sidAccount)
$sid=$identity.Translate([Security.Principal.SecurityIdentifier]).Value
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'MANIFEST.json') -Raw | ConvertFrom-Json
if ($manifest.mode -ne 'REAL_DEV_DISPLAY_ONLY' -or $manifest.version -ne '0.3.0') { throw 'Wrong release' }
Verify-Payload $PSScriptRoot $manifest @('HishobConnectorDev')
$base=Join-Path $env:ProgramFiles 'HishobConnectorDev'
$destination=Join-Path $base '0.3.0'
foreach ($p in @($base,$destination)) { Reject-Reparse $p }
if (-not (Test-Path -LiteralPath $destination)) {
    New-Item -ItemType Directory -Path $destination | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'HishobConnectorDev') -Destination $destination -Recurse
}
Protect-Program $base $sid
Verify-Payload $destination $manifest @('HishobConnectorDev') $true
$exe=Join-Path $destination 'HishobConnectorDev\HishobConnectorDev.exe'
$oldPath=$service.PathName
$wasRunning=$service.State -eq 'Running'
# No init/configure/pair, no ProgramData copies, no account/start-mode/SQL changes.
try {
    Stop-Service $name
    (Get-Service $name).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
    & $exe status | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Existing state unreadable. Preserve it and review recovery.' }
    & sc.exe config $name binPath= ('"'+$exe+'" service')
    if ($LASTEXITCODE -ne 0) { throw 'Service path update failed' }
    if ($wasRunning) { Start-Service $name }
} catch {
    & sc.exe config $name binPath= $oldPath
    if ($wasRunning) { Start-Service $name }
    throw
}
Write-Output 'Upgraded binaries to 0.3.0. Existing credentials, queues, sequence, binding and delayed startup setting preserved. Working PCs do not need pairing.'
