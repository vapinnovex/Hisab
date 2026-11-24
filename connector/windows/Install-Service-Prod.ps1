[CmdletBinding()]
param([Parameter(Mandatory=$true)][Management.Automation.PSCredential]$ServiceCredential)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Production flavour of the real display-only connector. Origin is fixed in the EXE.
& (Join-Path $PSScriptRoot 'Install-DevService.ps1') -ServiceCredential $ServiceCredential `
    -ServiceName 'HishobRadioSoft' -StateFolder 'HishobConnector' -InstallFolder 'HishobConnector' `
    -ExeName 'HishobConnector' -Mode 'REAL_PROD_DISPLAY_ONLY' -DisplayName 'Hishob RadioSoft Connector'
