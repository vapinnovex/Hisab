[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Production flavour: binaries only; state, credentials, queues and binding preserved.
& (Join-Path $PSScriptRoot 'Upgrade-DevService.ps1') -ServiceName 'HishobRadioSoft' -InstallFolder 'HishobConnector' `
    -ExeName 'HishobConnector' -Mode 'REAL_PROD_DISPLAY_ONLY' -InstallScript 'Install-Service-Prod'
