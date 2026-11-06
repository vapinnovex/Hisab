# Run from the extracted release in an elevated PowerShell. Does not touch SQL.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$admin = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator is required to install the Windows service and protected directories.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This package supports Windows x64 only.' }
$name = 'HishobRadioSoftSynthetic'
$version = '0.2.0'
$state = Join-Path $env:ProgramData 'HishobConnectorSynthetic'
$base = Join-Path $env:ProgramFiles 'HishobConnectorSynthetic'
$destination = Join-Path $base $version
function Check-Native([string]$message) { if ($LASTEXITCODE -ne 0) { throw $message } }
. (Join-Path $PSScriptRoot 'Verify-Payload.ps1')
foreach ($path in @($state,$base,$destination)) { Reject-Reparse $path }
if (Test-Path -LiteralPath $state) {
    Get-ChildItem -LiteralPath $state -Recurse -Force | ForEach-Object { Reject-Reparse $_.FullName }
}
$alreadyStaged = Test-Path -LiteralPath $destination
$manifestPath = Join-Path $PSScriptRoot 'MANIFEST.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne $version -or $manifest.mode -ne 'SYNTHETIC_LOOPBACK_ONLY') { throw 'Wrong release mode/version.' }
foreach ($entry in $manifest.files) {
    $file = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $entry.path))
    if (-not $file.StartsWith($PSScriptRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path escapes release.' }
    Reject-Reparse $file
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Package integrity check failed: $($entry.path)" }
    if ($alreadyStaged -and $entry.path -match '^(HishobConnector|HishobConnectorStatus|HishobLocalInspector)/') {
        $installed = Join-Path $destination $entry.path
        Reject-Reparse $installed
        if (-not (Test-Path -LiteralPath $installed) -or (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $entry.sha256) {
            throw 'Staged version differs or is incomplete. Review it; installed files are never overwritten.'
        }
    }
}
Verify-Payload $PSScriptRoot $manifest @('HishobConnector','HishobConnectorStatus','HishobLocalInspector')
# No service deletion or automatic queue reset. Existing service is a reviewed upgrade.
$existing = Get-Service -Name $name -ErrorAction SilentlyContinue
if ($existing) { throw 'Existing service detected. Stop and follow the reviewed upgrade procedure; this installer never replaces it automatically.' }
$newState = -not (Test-Path -LiteralPath $state)
New-Item -ItemType Directory -Path $base -Force | Out-Null
$programAcl = New-Object Security.AccessControl.DirectorySecurity
$programAcl.SetAccessRuleProtection($true,$false)
foreach ($sid in @('S-1-5-18','S-1-5-32-544','S-1-5-32-545','S-1-5-19')) {
    $rights = if ($sid -in @('S-1-5-18','S-1-5-32-544')) { 'FullControl' } else { 'ReadAndExecute' }
    $identity = New-Object Security.Principal.SecurityIdentifier($sid)
    $programAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,$rights,'ContainerInherit,ObjectInherit','None','Allow')))
}
Set-Acl -LiteralPath $base -AclObject $programAcl
New-Item -ItemType Directory -Path $destination -Force | Out-Null
if (-not $alreadyStaged) {
    foreach ($folder in @('HishobConnector','HishobConnectorStatus','HishobLocalInspector')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $folder) -Destination $destination -Recurse
    }
}
Protect-Program $base 'S-1-5-19'
Verify-Payload $destination $manifest @('HishobConnector','HishobConnectorStatus','HishobLocalInspector') $true
New-Item -ItemType Directory -Path $state -Force | Out-Null
# Replace, rather than append to, potentially permissive existing ACLs.
function Protect-State {
    param([bool]$WithService)
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
        $identity = New-Object Security.Principal.SecurityIdentifier($sid)
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    }
    if ($WithService) {
        $identity = New-Object Security.Principal.NTAccount("NT SERVICE\$name")
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'Modify','ContainerInherit,ObjectInherit','None','Allow')))
    }
    Set-Acl -LiteralPath $state -AclObject $acl
    Get-ChildItem -LiteralPath $state -Force | ForEach-Object {
        & icacls.exe $_.FullName /reset /T /Q
        Check-Native 'Failed to reset child state ACL.'
    }
}
Protect-State $false
$exe = Join-Path $destination 'HishobConnector\HishobConnector.exe'
if ($newState) { & $exe init --state $state; Check-Native 'State initialization failed; preserve the partial directory for review.' }
else { & $exe status --state $state | Out-Null; Check-Native 'Existing state is unreadable; never reset it.' }
$command = '"' + $exe + '" service'
New-Service -Name $name -DisplayName 'Hishob RadioSoft Synthetic Preview' -BinaryPathName $command -StartupType Automatic -Credential (New-Object Management.Automation.PSCredential('NT AUTHORITY\LocalService',(New-Object Security.SecureString))) | Out-Null
& sc.exe sidtype $name unrestricted
Check-Native 'Failed to assign service SID.'
Protect-State $true
& sc.exe config $name start= delayed-auto
Check-Native 'Failed to set delayed automatic start.'
& sc.exe failure $name reset= 86400 actions= restart/5000/restart/15000/restart/60000
Check-Native 'Failed to set service recovery.'
& sc.exe failureflag $name 1
Check-Native 'Failed to enable non-crash recovery.'
Start-Service -Name $name
$service = Get-Service -Name $name
$service.WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
Write-Output 'Synthetic service installed. Open HishobConnectorStatus as administrator to pair with an isolated local test API. No SQL access was configured.'
Write-Output (Join-Path $destination 'HishobConnectorStatus\HishobConnectorStatus.exe')
