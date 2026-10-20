param([string]$Directory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectDirectory = Split-Path -Parent $PSScriptRoot
$version = ([IO.File]::ReadAllText((Join-Path $projectDirectory 'package.json')) | ConvertFrom-Json).version
$launcherHash = (Get-FileHash -LiteralPath (Join-Path $Directory 'UOOC-Study.exe') -Algorithm SHA256).Hash

function Entry-Hash($entry) {
    $stream = $entry.Open()
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '') }
    finally { $hash.Dispose(); $stream.Dispose() }
}

foreach ($kind in @('windows-x64', 'complete-windows-x64', 'source')) {
    $file = Join-Path $Directory "UOOC-Study-$kind.zip"
    $zip = [IO.Compression.ZipFile]::OpenRead($file)
    try {
        $names = @($zip.Entries | ForEach-Object FullName)
        if (@($names | Where-Object { $_ -match '^(data|\.build|\.git)/|^config(?:\.local)?\.txt$|\.(pfx|p12|key)$' }).Count) {
            throw "Private files found in $kind package."
        }
        foreach ($name in @('start.bat', 'start.vbs')) {
            if (@($names | Where-Object { $_ -ceq $name }).Count -ne 1) { throw "Missing or duplicate $name in $kind package." }
        }
        if ($kind -eq 'source') {
            if ($names -ccontains 'UOOC-Study.exe') { throw 'Source-only package must not contain the launcher.' }
        } else {
            if (@($names | Where-Object { $_ -ceq 'UOOC-Study.exe' }).Count -ne 1) { throw "Missing or duplicate launcher in $kind package." }
            if ((Entry-Hash $zip.GetEntry('UOOC-Study.exe')) -ne $launcherHash) { throw "Stale launcher in $kind package." }
        }
        if ($kind -ne 'windows-x64') {
            $reader = [IO.StreamReader]::new($zip.GetEntry('package.json').Open())
            try { $packagedVersion = ($reader.ReadToEnd() | ConvertFrom-Json).version }
            finally { $reader.Dispose() }
            if ($packagedVersion -ne $version) { throw "Stale source version in $kind package." }
            foreach ($name in @('app.js', 'lib/video-prompt.js', 'lib/window-rendering.js', 'start.bat', 'start.vbs')) {
                $entry = $zip.GetEntry($name)
                if (-not $entry -or (Entry-Hash $entry) -ne (Get-FileHash -LiteralPath (Join-Path $projectDirectory $name) -Algorithm SHA256).Hash) {
                    throw "Stale or missing $name in $kind package."
                }
            }
        }
        Write-Output "Verified $kind package: $version, launch files, source consistency and private-data exclusion."
    } finally { $zip.Dispose() }
}
