[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Python,[string]$OutputDirectory='', [switch]$RealDev)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) { throw 'Build on Windows x64.' }
$version = '0.3.0'
$dist = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $root 'dist' }
$build = Join-Path $root 'build'
$mode = if ($RealDev) { 'REAL_DEV_DISPLAY_ONLY' } else { 'SYNTHETIC_LOOPBACK_ONLY' }
$flavor = if ($RealDev) { 'real-dev' } else { 'synthetic' }
$release = Join-Path $dist "HishobConnector-$version-$flavor-windows-x64"
if (Test-Path -LiteralPath $release) { throw 'Release directory already exists; use a clean build checkout.' }
& $Python -c "import sys,struct; assert sys.version_info[:2]==(3,12) and struct.calcsize('P')==8"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 x64 required.' }
Push-Location $root
try {
    $common = @('-m','PyInstaller','--noconfirm','--clean','--onedir','--paths',$root,
        '--collect-data','hishob_connector','--distpath',$release,'--workpath',$build,'--specpath',$build)
    # Some bundled Python distributions load a public certificate-policy file from
    # beside ssl.py. Preserve that policy in the frozen runtime; never disable TLS checks.
    $sslPolicy = & $Python -c "import ssl,pathlib; p=pathlib.Path(ssl.__file__).with_name('codex-rejected-cas.pem'); print(str(p) if p.is_file() else '')"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Python TLS runtime data.' }
    if ($sslPolicy) { $common += @('--add-data',"$sslPolicy;.") }
    if ($RealDev) {
        & $Python @common --name HishobConnectorDev --console --hidden-import pyodbc --hidden-import win32timezone --hidden-import servicemanager --hidden-import win32service --hidden-import win32serviceutil real_entry.py
        if ($LASTEXITCODE -ne 0) { throw 'Real DEV build failed.' }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-DevService.ps1'),(Join-Path $PSScriptRoot 'Upgrade-DevService.ps1') -Destination $release
        foreach ($doc in @('SHOP-PC-DEV-SETUP.md','RADIOSOFT-REAL-BUSINESS-RULES.md','RADIOSOFT-REAL-IMPLEMENTATION.md')) {
            Copy-Item -LiteralPath (Join-Path $root "../docs/$doc") -Destination $release
        }
        Copy-Item -LiteralPath (Join-Path $root '../docs/dev/radiosoft-fast-refresh-2026-11-10.md') -Destination (Join-Path $release 'RADIOSOFT-FAST-REFRESH.md')
        Copy-Item -LiteralPath (Join-Path $root '../docs/dev/radiosoft-real-reviewed-files.json') -Destination $release
    } else {
        & $Python @common --name HishobConnector --console --hidden-import win32timezone --hidden-import servicemanager --hidden-import win32service --hidden-import win32serviceutil service_entry.py
        if ($LASTEXITCODE -ne 0) { throw 'Service build failed.' }
        & $Python @common --name HishobConnectorStatus --windowed --uac-admin status_entry.py
        if ($LASTEXITCODE -ne 0) { throw 'Status UI build failed.' }
        & $Python @common --name HishobLocalInspector --windowed --hidden-import pyodbc inspector_entry.py
        if ($LASTEXITCODE -ne 0) { throw 'Local-only inspector build failed.' }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-Service.ps1'),(Join-Path $PSScriptRoot 'Uninstall-Service.ps1') -Destination $release
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Verify-Payload.ps1') -Destination $release
    Copy-Item -LiteralPath (Join-Path $root 'README.md'),(Join-Path $root 'SOURCE-MAPPING.md'),(Join-Path $root 'IMPLEMENTATION-REPORT.md') -Destination $release
    & $Python (Join-Path $PSScriptRoot 'release_metadata.py') $release
    if ($LASTEXITCODE -ne 0) { throw 'Dependency notice collection failed.' }
    $manifest = Get-ChildItem -LiteralPath $release -Recurse -File | ForEach-Object {
        [ordered]@{path=$_.FullName.Substring($release.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
    }
    [ordered]@{version=$version;mode=$mode;source_revision=(& git rev-parse HEAD);source_dirty=([bool](& git status --porcelain));created_utc=[DateTime]::UtcNow.ToString('o');files=@($manifest)} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $release 'MANIFEST.json') -Encoding UTF8
    Compress-Archive -LiteralPath $release -DestinationPath "$release.zip"
    Write-Output "$release.zip"
} finally { Pop-Location }
