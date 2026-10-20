param([string]$NodeVersion = '24.14.1', [string]$NodeArchive = '', [switch]$SelfSign)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir
if ($NodeVersion -notmatch '^24\.\d+\.\d+$') { throw 'Use a Node.js 24 release version.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x compiler is required.' }
$buildDir = Join-Path $projectDir '.build'
$distDir = Join-Path $projectDir 'dist'
New-Item -ItemType Directory -Path $buildDir, $distDir -Force | Out-Null
$nodeName = "node-v$NodeVersion-win-x64"
$nodeZip = if ($NodeArchive) { (Resolve-Path -LiteralPath $NodeArchive).Path } else { Join-Path $buildDir "$nodeName.zip" }
$releaseUrl = "https://nodejs.org/dist/v$NodeVersion"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$checksums = (Invoke-WebRequest -Uri "$releaseUrl/SHASUMS256.txt" -UseBasicParsing).Content
$checksumLine = ($checksums -split '\n' | Where-Object { $_.Trim().EndsWith(" $nodeName.zip") })
if (-not $checksumLine) { throw 'Official Node.js checksum was not found.' }
if (-not (Test-Path -LiteralPath $nodeZip)) {
    Invoke-WebRequest -Uri "$releaseUrl/$nodeName.zip" -OutFile $nodeZip -UseBasicParsing
}
$sha = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($nodeZip)
try { $actualHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
finally { $stream.Dispose(); $sha.Dispose() }
if ($actualHash -ne ($checksumLine.Trim() -split '\s+')[0]) { throw 'Node.js archive checksum mismatch.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$nodeDir = Join-Path $buildDir $nodeName
if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
    [IO.Compression.ZipFile]::ExtractToDirectory($nodeZip, $buildDir)
}
$dependencies = Join-Path $buildDir ('dependencies-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dependencies | Out-Null
Copy-Item -LiteralPath (Join-Path $projectDir 'package.json'), (Join-Path $projectDir 'package-lock.json') -Destination $dependencies
& (Join-Path $nodeDir 'npm.cmd') --prefix $dependencies ci --omit=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
$completeDependencies = Join-Path $buildDir ('complete-dependencies-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $completeDependencies | Out-Null
Copy-Item -LiteralPath (Join-Path $projectDir 'package.json'), (Join-Path $projectDir 'package-lock.json') -Destination $completeDependencies
& (Join-Path $nodeDir 'npm.cmd') --prefix $completeDependencies ci --include=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Complete package dependency installation failed.' }

$notices = [Text.StringBuilder]::new()
[void]$notices.AppendLine('UOOC Study third-party software notices')
[void]$notices.AppendLine('Node.js ' + $NodeVersion)
[void]$notices.AppendLine([IO.File]::ReadAllText((Join-Path $nodeDir 'LICENSE')))
Get-ChildItem -LiteralPath (Join-Path $completeDependencies 'node_modules') -File -Recurse | Where-Object { $_.Name -match '^(licen[cs]e|notice|copying)([.-].*)?$' } | ForEach-Object {
    [void]$notices.AppendLine("`n=== " + $_.FullName.Substring($completeDependencies.Length + 1) + ' ===')
    [void]$notices.AppendLine([IO.File]::ReadAllText($_.FullName))
}
$noticePath = Join-Path $distDir 'THIRD-PARTY-NOTICES.txt'
[IO.File]::WriteAllText($noticePath, $notices.ToString(), [Text.UTF8Encoding]::new($false))

function Add-File($archive, [string]$file, [string]$relative) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $relative.Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
$sourceFiles = @('app.js', 'package.json', 'package-lock.json', 'config.example.txt', 'LICENSE', 'README.md', 'PRIVACY.md', 'CODE_SIGNING.md', 'CODE_SIGNING_CERT.cer', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', '原理.md', '技术选型.md', '测试记录.md', '第三方声明.md', '.gitignore', 'start.bat', 'start.vbs')
$payloadPath = Join-Path $buildDir ('payload-' + [guid]::NewGuid().ToString('N') + '.zip')
$archive = [IO.Compression.ZipFile]::Open($payloadPath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($relative in $sourceFiles) { Add-File $archive (Join-Path $projectDir $relative) $relative }
    foreach ($folder in @('lib', 'ui')) {
        Get-ChildItem -LiteralPath (Join-Path $projectDir $folder) -File -Recurse | ForEach-Object {
            Add-File $archive $_.FullName $_.FullName.Substring($projectDir.Length + 1)
        }
    }
    Add-File $archive (Join-Path $PSScriptRoot 'code-signing.ps1') 'tools/code-signing.ps1'
    Get-ChildItem -LiteralPath (Join-Path $dependencies 'node_modules') -File -Recurse | ForEach-Object {
        Add-File $archive $_.FullName $_.FullName.Substring($dependencies.Length + 1)
    }
    foreach ($file in @('node.exe', 'LICENSE')) { Add-File $archive (Join-Path $nodeDir $file) "runtime/$file" }
    Add-File $archive $noticePath 'THIRD-PARTY-NOTICES.txt'
} finally { $archive.Dispose() }
$exePath = Join-Path $distDir 'UOOC-Study.exe'
$productVersion = ([IO.File]::ReadAllText((Join-Path $projectDir 'package.json')) | ConvertFrom-Json).version
if ($productVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'The product version must have three numeric components.' }
$assemblyInfo = Join-Path $buildDir 'Launcher.AssemblyInfo.cs'
$metadata = @"
using System.Reflection;
[assembly: AssemblyTitle("UOOC Study")]
[assembly: AssemblyProduct("UOOC Study")]
[assembly: AssemblyCompany("Letiaaan")]
[assembly: AssemblyDescription("UOOC Study local learning workbench")]
[assembly: AssemblyVersion("$productVersion.0")]
[assembly: AssemblyFileVersion("$productVersion.0")]
[assembly: AssemblyInformationalVersion("$productVersion")]
"@
[IO.File]::WriteAllText($assemblyInfo,$metadata,[Text.UTF8Encoding]::new($false))
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$exePath" /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/resource:$payloadPath,payload.zip" (Join-Path $PSScriptRoot 'Launcher.cs') $assemblyInfo
if ($LASTEXITCODE -ne 0) { throw 'EXE compilation failed.' }
$signingStatus = @{ type = 'unsigned' }
if ($SelfSign) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'code-signing.ps1') -Action Sign -Path $exePath
    if ($LASTEXITCODE -ne 0) { throw 'Self-signing or verification failed; no release ZIP will be prepared.' }
    $publicCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $projectDir 'CODE_SIGNING_CERT.cer'))
    $certificateHash = [Security.Cryptography.SHA256]::Create()
    try { $fingerprint = [BitConverter]::ToString($certificateHash.ComputeHash($publicCertificate.RawData)).Replace('-','') }
    finally { $certificateHash.Dispose(); $publicCertificate.Dispose() }
    $signingStatus = @{ type = 'self-signed'; certificateSha256 = $fingerprint; windowsStatus = (Get-AuthenticodeSignature -LiteralPath $exePath).Status.ToString() }
}
[IO.File]::WriteAllText((Join-Path $buildDir 'signing-status.json'),($signingStatus | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
try { Copy-Item -LiteralPath $exePath -Destination (Join-Path $projectDir 'UOOC-Study.exe') -ErrorAction Stop }
catch {
    $version = ([IO.File]::ReadAllText((Join-Path $projectDir 'package.json')) | ConvertFrom-Json).version
    $versionedExe = Join-Path $projectDir "UOOC-Study-$version.exe"
    try { Copy-Item -LiteralPath $exePath -Destination $versionedExe -ErrorAction Stop; Write-Host "Updated launcher: $versionedExe" }
    catch { Write-Host 'The updated launcher is available in dist\UOOC-Study.exe.' }
}

foreach ($kind in @('windows-x64', 'source', 'complete-windows-x64')) {
    $zipPath = Join-Path $distDir "UOOC-Study-$kind.zip"
    $releaseStream = [IO.File]::Open($zipPath, [IO.FileMode]::Create)
    $release = [IO.Compression.ZipArchive]::new($releaseStream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        if ($kind -eq 'windows-x64') {
            Add-File $release $exePath 'UOOC-Study.exe'
            Add-File $release (Join-Path $PSScriptRoot 'code-signing.ps1') 'tools/code-signing.ps1'
            foreach ($file in @('start.bat', 'start.vbs', 'config.example.txt', 'README.md', 'PRIVACY.md', 'CODE_SIGNING.md', 'CODE_SIGNING_CERT.cer', 'SECURITY.md', 'CHANGELOG.md', '原理.md', '技术选型.md', '测试记录.md', '第三方声明.md', 'LICENSE')) {
                Add-File $release (Join-Path $projectDir $file) $file
            }
            Add-File $release $noticePath 'THIRD-PARTY-NOTICES.txt'
        } else {
            foreach ($file in $sourceFiles) { Add-File $release (Join-Path $projectDir $file) $file }
            foreach ($folder in @('lib', 'ui', 'tools', 'test', '.github')) {
                Get-ChildItem -LiteralPath (Join-Path $projectDir $folder) -File -Recurse | ForEach-Object {
                    Add-File $release $_.FullName $_.FullName.Substring($projectDir.Length + 1)
                }
            }
            if ($kind -eq 'complete-windows-x64') {
                Add-File $release $exePath 'UOOC-Study.exe'
                Add-File $release $noticePath 'THIRD-PARTY-NOTICES.txt'
                Get-ChildItem -LiteralPath (Join-Path $completeDependencies 'node_modules') -File -Recurse | ForEach-Object {
                    Add-File $release $_.FullName $_.FullName.Substring($completeDependencies.Length + 1)
                }
                Get-ChildItem -LiteralPath $nodeDir -File -Recurse | ForEach-Object {
                    Add-File $release $_.FullName ('runtime/' + $_.FullName.Substring($nodeDir.Length + 1))
                }
            }
        }
    } finally { $release.Dispose(); $releaseStream.Dispose() }
    Write-Host "Built $zipPath"
}
& (Join-Path $PSScriptRoot 'check-packages.ps1') -Directory $distDir
Write-Host "Built $exePath"
