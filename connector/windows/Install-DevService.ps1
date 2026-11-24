[CmdletBinding()]
param([Parameter(Mandatory=$true)][Management.Automation.PSCredential]$ServiceCredential)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Verify-Payload.ps1')
$admin=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator required' }
if (-not [Environment]::Is64BitProcess) { throw 'x64 PowerShell required' }
$name='HishobRadioSoftDev'
$state=Join-Path $env:ProgramData 'HishobConnectorDev'
$base=Join-Path $env:ProgramFiles 'HishobConnectorDev'
$destination=Join-Path $base '0.3.0'
if ($ServiceCredential.UserName -notmatch ('^'+[regex]::Escape($env:COMPUTERNAME)+'\\')) { throw 'Use the dedicated local non-administrator SQL reader account' }
$id=New-Object Security.Principal.NTAccount($ServiceCredential.UserName)
$sid=$id.Translate([Security.Principal.SecurityIdentifier]).Value
if ($sid -in @('S-1-5-18','S-1-5-19','S-1-5-20') -or $sid.EndsWith('-500')) { throw 'System/default administrator identity refused' }
# Nested group/inherited privileges must also be reviewed during qualification.
if (Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object { $_.SID.Value -eq $sid }) { throw 'Administrator account refused' }
if (Get-Service -Name $name -ErrorAction SilentlyContinue) { throw 'Existing service: reviewed upgrade required' }
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'MANIFEST.json') -Raw | ConvertFrom-Json
if ($manifest.mode -ne 'REAL_DEV_DISPLAY_ONLY' -or $manifest.version -ne '0.3.0') { throw 'Wrong release' }
Verify-Payload $PSScriptRoot $manifest @('HishobConnectorDev')
foreach ($p in @($state,$base,$destination)) { Reject-Reparse $p }
if (Test-Path -LiteralPath $state) { Get-ChildItem -LiteralPath $state -Recurse -Force | ForEach-Object { Reject-Reparse $_.FullName } }
$newState= -not (Test-Path -LiteralPath $state)
New-Item -ItemType Directory -Path $base -Force | Out-Null
if (-not (Test-Path -LiteralPath $destination)) {
    New-Item -ItemType Directory -Path $destination | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'HishobConnectorDev') -Destination $destination -Recurse
}
Protect-Program $base $sid
Verify-Payload $destination $manifest @('HishobConnectorDev') $true
New-Item -ItemType Directory -Path $state -Force | Out-Null
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach ($principal in @('S-1-5-18','S-1-5-32-544',$sid)) {
    $rights=if ($principal -eq $sid) { 'Modify' } else { 'FullControl' }
    $identity=New-Object Security.Principal.SecurityIdentifier($principal)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,$rights,'ContainerInherit,ObjectInherit','None','Allow')))
}
Set-Acl -LiteralPath $state -AclObject $acl
Get-ChildItem -LiteralPath $state -Force | ForEach-Object { & icacls.exe $_.FullName /reset /T /Q; if ($LASTEXITCODE -ne 0) { throw 'State ACL failed' } }
$exe=Join-Path $destination 'HishobConnectorDev\HishobConnectorDev.exe'
if ($newState) { & $exe init --state $state } else { & $exe status --state $state | Out-Null }
if ($LASTEXITCODE -ne 0) { throw 'State unreadable: preserve it; never reset' }
# Grant SeServiceLogonRight to this exact account in Local Security Policy first.
New-Service -Name $name -DisplayName 'Hishob RadioSoft DEV Display Preview' -BinaryPathName ('"'+$exe+'" service') -Credential $ServiceCredential -StartupType Manual | Out-Null
& sc.exe failure $name reset= 86400 actions= restart/15000/restart/60000/restart/60000
if ($LASTEXITCODE -ne 0) { throw 'Recovery setup failed' }
Write-Output 'Installed stopped. Configure and pair, qualify under the dedicated identity, then start explicitly. No SQL permissions were changed.'
