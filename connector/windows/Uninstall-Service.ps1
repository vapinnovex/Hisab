[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$admin = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator is required to remove the service.' }
$name = 'HishobRadioSoftSynthetic'
$service = Get-Service -Name $name -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') { Stop-Service -Name $name; $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30)) }
    & sc.exe delete $name
    if ($LASTEXITCODE -ne 0) { throw 'Service removal failed.' }
}
Write-Output 'Service removed. ProgramData state, credentials, sequencing and queued observations are retained; program files are retained. Revoke the connector in the isolated Hishob preview when retiring it. No SQL permissions/settings were changed.'
