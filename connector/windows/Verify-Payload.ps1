# Shared installer verification. Hashes establish integrity, not publisher trust.
function Reject-Reparse([string]$path) {
    $item = [IO.Path]::GetFullPath($path)
    while ($item) {
        if ((Test-Path -LiteralPath $item) -and ((Get-Item -LiteralPath $item -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Reparse point refused: $item" }
        $item = Split-Path -Path $item -Parent
    }
}
function Verify-Payload([string]$root, $manifest, [string[]]$folders, [bool]$staged = $false) {
    Reject-Reparse $root
    $seen = @{}
    foreach ($entry in $manifest.files) {
        $relative = [string]$entry.path
        if ($relative -match '\\|:|(^|/)\.\.?(/|$)' -or $relative.StartsWith('/') -or $relative -match '[ .](/|$)') { throw 'Unsafe manifest path' }
        $normal = $relative.ToLowerInvariant()
        if ($seen.ContainsKey($normal)) { throw 'Duplicate manifest path' }
        $seen[$normal] = $entry
    }
    foreach ($folder in $folders) {
        $required = "$folder/$folder.exe"
        if (-not $seen.ContainsKey($required.ToLowerInvariant())) { throw "Missing required EXE: $required" }
    }
    $actual = @{}
    $roots = if ($staged) { @($root) } else { $folders | ForEach-Object { Join-Path $root $_ } }
    foreach ($scan in $roots) {
        Reject-Reparse $scan
        Get-ChildItem -LiteralPath $scan -Recurse -Force | ForEach-Object {
            Reject-Reparse $_.FullName
            if (-not $_.PSIsContainer) {
                $rel = $_.FullName.Substring($root.Length+1).Replace('\','/').ToLowerInvariant()
                if (-not $seen.ContainsKey($rel)) { throw "Unexpected payload: $rel" }
                $entry = $seen[$rel]
                if ($_.Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Payload mismatch: $rel" }
                $actual[$rel] = $true
            }
        }
    }
    foreach ($rel in $seen.Keys) {
        if (($folders | Where-Object { $rel.StartsWith($_.ToLowerInvariant()+'/') }) -and -not $actual.ContainsKey($rel)) { throw "Missing payload: $rel" }
    }
}
function Protect-Program([string]$root, [string]$readerSid) {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @('S-1-5-18','S-1-5-32-544',$readerSid)) {
        $rights = if ($sid -eq $readerSid) { 'ReadAndExecute' } else { 'FullControl' }
        $id = New-Object Security.Principal.SecurityIdentifier($sid)
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($id,$rights,'ContainerInherit,ObjectInherit','None','Allow')))
    }
    Set-Acl -LiteralPath $root -AclObject $acl
    Get-ChildItem -LiteralPath $root -Force | ForEach-Object {
        & icacls.exe $_.FullName /reset /T /Q
        if ($LASTEXITCODE -ne 0) { throw 'Program ACL reset failed' }
    }
}
