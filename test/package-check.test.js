const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');

test('Windows package verification works without Get-FileHash and still rejects invalid packages', { skip: process.platform !== 'win32', timeout: 30000 }, () => {
    const root = path.resolve(__dirname, '..');
    const fixture = path.join(root, '.build', 'package-check-test-' + randomUUID());
    fs.mkdirSync(fixture, { recursive: true });
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    const script = `
        $ErrorActionPreference = 'Stop'
        Add-Type -AssemblyName System.IO.Compression
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $project = ${quote(root)}
        $fixture = ${quote(fixture)}
        [IO.File]::WriteAllText((Join-Path $fixture 'UOOC-Study.exe'), 'synthetic-launcher')
        function Write-Fixture([string]$kind) {
            $stream = [IO.File]::Open((Join-Path $fixture ("UOOC-Study-" + $kind + ".zip")), [IO.FileMode]::Create)
            $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
            try {
                $names = @('start.bat', 'start.vbs')
                if ($kind -ne 'windows-x64') { $names += @('package.json', 'app.js', 'lib/video-prompt.js', 'lib/window-rendering.js', 'lib/gui.js', 'lib/gui-open.js', 'lib/gui-instance.js', 'lib/gui-lifecycle.js', 'lib/worker.js') }
                foreach ($name in $names) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $project $name), $name) | Out-Null }
                if ($kind -ne 'source') { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $fixture 'UOOC-Study.exe'), 'UOOC-Study.exe') | Out-Null }
            } finally { $zip.Dispose(); $stream.Dispose() }
        }
        function Corrupt-Entry([string]$name, [string]$text, [string]$kind = 'windows-x64') {
            $zip = [IO.Compression.ZipFile]::Open((Join-Path $fixture ("UOOC-Study-" + $kind + ".zip")), [IO.Compression.ZipArchiveMode]::Update)
            try {
                $entry = $zip.GetEntry($name)
                if ($entry) { $entry.Delete() }
                if ($text) {
                    $writer = [IO.StreamWriter]::new($zip.CreateEntry($name).Open())
                    try { $writer.Write($text) } finally { $writer.Dispose() }
                }
            } finally { $zip.Dispose() }
        }
        function Expect-Rejection([string]$pattern) {
            $message = ''
            try { & (Join-Path $project 'tools/check-packages.ps1') -Directory $fixture }
            catch { $message = $_.Exception.Message }
            if ($message -notmatch $pattern) { throw ("Expected rejection " + $pattern + "; received: " + $message) }
            Write-Output ('Rejected: ' + $pattern)
        }
        # Reproduce the missing script function while retaining ordinary cmdlets.
        Import-Module Microsoft.PowerShell.Utility
        Remove-Item Function:\\Get-FileHash -ErrorAction SilentlyContinue
        $PSModuleAutoLoadingPreference = 'None'
        if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) { throw 'Get-FileHash must be unavailable in this regression' }
        foreach ($kind in @('windows-x64', 'complete-windows-x64', 'source')) { Write-Fixture $kind }
        & (Join-Path $project 'tools/check-packages.ps1') -Directory $fixture
        Corrupt-Entry 'UOOC-Study.exe' 'old-launcher'
        Expect-Rejection 'Stale launcher'
        Write-Fixture 'windows-x64'
        Corrupt-Entry 'UOOC-Study.exe' ''
        Expect-Rejection 'Missing or duplicate launcher'
        Write-Fixture 'windows-x64'
        Corrupt-Entry 'data/fixture.txt' 'synthetic-local-data'
        Expect-Rejection 'Private files'
        Write-Fixture 'windows-x64'
        Corrupt-Entry 'lib/video-prompt.js' 'old-source' 'complete-windows-x64'
        Expect-Rejection 'Stale or missing lib/video-prompt.js'
        Write-Fixture 'complete-windows-x64'
        Corrupt-Entry 'package.json' '{"version":"0.0.0"}' 'complete-windows-x64'
        Expect-Rejection 'Stale source version'
        Write-Output 'Package compatibility regression passed'
    `;
    const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, encoding: 'utf8', timeout: 25000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Package compatibility regression passed/);
});
