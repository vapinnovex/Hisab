# Execute only the production lookup function, never the installer/service operations.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$path=Join-Path $PSScriptRoot '../windows/Upgrade-DevService.ps1'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$functions=@($ast.FindAll({param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'ConvertTo-LocalSidAccount'
},$true))
if ($functions.Count -ne 1) { throw 'Expected one production lookup function' }
. ([scriptblock]::Create($functions[0].Extent.Text))
$service=[pscustomobject]@{StartName='.\HishobDevReader'}
$expected=$env:COMPUTERNAME+'\HishobDevReader'
if ((ConvertTo-LocalSidAccount $service.StartName) -cne $expected) { throw 'Dot account was not normalized' }
if ($service.StartName -cne '.\HishobDevReader') { throw 'Service identity was mutated' }
if ((ConvertTo-LocalSidAccount $expected) -cne $expected) { throw 'Qualified account was changed' }
$lower=$expected.ToLowerInvariant()
if ((ConvertTo-LocalSidAccount $lower) -cne $lower) { throw 'Qualified account case was changed' }
foreach ($invalid in @('OTHERDOMAIN\Reader','LocalSystem','Reader','prefix.\Reader')) {
    $rejected=$false
    try { ConvertTo-LocalSidAccount $invalid | Out-Null } catch { $rejected=$true }
    if (-not $rejected) { throw "Unexpected identity accepted: $invalid" }
}
# Real Windows SID lookup against an existing local account, without creating one.
$local=Get-CimInstance Win32_UserAccount -Filter 'LocalAccount=True' | Select-Object -First 1
if (-not $local) { throw 'No existing local account for SID regression' }
$qualified=$env:COMPUTERNAME+'\'+$local.Name
foreach ($name in @(('.\'+$local.Name),$qualified)) {
    $lookup=ConvertTo-LocalSidAccount $name
    $account=New-Object Security.Principal.NTAccount($lookup)
    if ($account.Translate([Security.Principal.SecurityIdentifier]).Value -ne $local.SID) {
        throw 'Normalized lookup did not resolve to the existing local SID'
    }
}
Write-Output 'PASS: dot and qualified accounts resolve; configuration preserved; foreign identities rejected.'
