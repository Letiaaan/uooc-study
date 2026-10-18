param(
    [ValidateSet('Initialize','Sign','Verify','Export')][string]$Action = 'Verify',
    [string]$Path = '',
    [string]$TimestampServer = '',
    [string]$PublicCertificatePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'CODE_SIGNING_CERT.cer')
)
$ErrorActionPreference = 'Stop'
$identityDirectory = Join-Path $env:LOCALAPPDATA 'Letiaaan\CodeSigning'
$identityFile = Join-Path $identityDirectory 'identity.json'
$subject = 'CN=Letiaaan (Self-signed code signing)'

function New-LocalSigningCertificate {
    # Keep the key in the current user's CAPI provider. This also works on
    # Windows installations where the optional CNG key-isolation service is absent.
    if (-not ('LetiaaanCertificateKey' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
public static class LetiaaanCertificateKey {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct ProviderInfo {
        [MarshalAs(UnmanagedType.LPWStr)] public string Container;
        [MarshalAs(UnmanagedType.LPWStr)] public string Provider;
        public uint Type, Flags, ParameterCount;
        public IntPtr Parameters;
        public uint KeySpec;
    }
    [DllImport("crypt32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CertSetCertificateContextProperty(IntPtr context, uint property, uint flags, ref ProviderInfo info);
    public static void Attach(X509Certificate2 certificate, string container, string provider) {
        ProviderInfo info = new ProviderInfo { Container=container, Provider=provider, Type=24, KeySpec=2 };
        if (!CertSetCertificateContextProperty(certificate.Handle, 2, 0, ref info))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
'@
    }
    $parameters = [Security.Cryptography.CspParameters]::new(24, 'Microsoft Enhanced RSA and AES Cryptographic Provider', ('Letiaaan-CodeSigning-' + [guid]::NewGuid().ToString('N')))
    $parameters.KeyNumber = 2
    $key = [Security.Cryptography.RSACryptoServiceProvider]::new(3072, $parameters)
    $key.PersistKeyInCsp = $false
    try {
        $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new($subject, $key, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature,$true))
        $purposes = [Security.Cryptography.OidCollection]::new()
        [void]$purposes.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($purposes,$false))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($request.PublicKey,$false))
        $serial = New-Object byte[] 16
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($serial) } finally { $random.Dispose() }
        $generator = [Security.Cryptography.X509Certificates.X509SignatureGenerator]::CreateForRSA($key,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $certificate = $request.Create($request.SubjectName,$generator,[DateTimeOffset]::Now.AddMinutes(-5),[DateTimeOffset]::Now.AddYears(3),$serial)
        [LetiaaanCertificateKey]::Attach($certificate,$parameters.KeyContainerName,$parameters.ProviderName)
        $certificate.FriendlyName = 'Letiaaan personal code signing (self-signed)'
        $store = [Security.Cryptography.X509Certificates.X509Store]::new('My','CurrentUser')
        try {
            $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
            $store.Add($certificate)
            $key.PersistKeyInCsp = $true
        } finally { $store.Close() }
        return $certificate
    } finally { $key.Dispose() }
}

function Get-CertificateFingerprint($Certificate) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($Certificate.RawData)).Replace('-', '') }
    finally { $hash.Dispose() }
}

function Get-LocalIdentity {
    if (-not (Test-Path -LiteralPath $identityFile)) { throw 'Run code-signing.ps1 -Action Initialize once on your own computer first.' }
    $identity = [IO.File]::ReadAllText($identityFile) | ConvertFrom-Json
    if ($identity.thumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Invalid local signing identity.' }
    $certificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $identity.thumbprint) -ErrorAction Stop
    if (-not $certificate.HasPrivateKey) { throw 'The local signing private key is unavailable.' }
    if ($certificate.Subject -ne $subject) { throw 'Unexpected signing identity.' }
    if ($certificate.NotAfter -le (Get-Date)) { throw 'The signing certificate has expired.' }
    return $certificate
}

function Assert-PublicIdentity($Certificate) {
    if (-not (Test-Path -LiteralPath $PublicCertificatePath)) { throw 'The expected public certificate is missing.' }
    $expected = New-Object Security.Cryptography.X509Certificates.X509Certificate2($PublicCertificatePath)
    try {
        if ($expected.Thumbprint -ne $Certificate.Thumbprint) { throw 'The signer differs from the published certificate.' }
    } finally { $expected.Dispose() }
}

function Get-OpenSourceSigner {
    $toolDirectory = Join-Path $identityDirectory 'tools\osslsigncode-2.14'
    $tool = Join-Path $toolDirectory 'bin\osslsigncode.exe'
    if (Test-Path -LiteralPath $tool) { return $tool }
    $archive = Join-Path $identityDirectory 'tools\osslsigncode-2.14-windows-x64-mingw.zip'
    New-Item -ItemType Directory -Path (Split-Path -Parent $archive) -Force | Out-Null
    if (-not (Test-Path -LiteralPath $archive)) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri 'https://github.com/mtrojnar/osslsigncode/releases/download/2.14/osslsigncode-2.14-windows-x64-mingw.zip' -OutFile $archive -UseBasicParsing
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne '9A1722AAF62A27852C4EB9C35749A0248065052D0AE0A93D4ED6BB49DEF027F2') { throw 'The signing-tool archive failed its pinned SHA256 check.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $toolDirectory -Force
    return $tool
}

if ($Action -eq 'Initialize') {
    if (Test-Path -LiteralPath $identityFile) {
        $certificate = Get-LocalIdentity
    } else {
        $existing = @(Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq $subject -and $_.HasPrivateKey })
        if ($existing.Count -gt 1) { throw 'Multiple matching signing identities exist. Select the intended identity before continuing.' }
        if ($existing.Count -eq 1) { $certificate = $existing[0] }
        else {
            if (Test-Path -LiteralPath $PublicCertificatePath) { throw 'A public identity is already published, but its private key was not found. Restore your certificate backup instead of silently replacing it.' }
            $certificate = New-LocalSigningCertificate
        }
        New-Item -ItemType Directory -Path $identityDirectory -Force | Out-Null
        $identity = @{ thumbprint = $certificate.Thumbprint; subject = $certificate.Subject; certificateSha256 = (Get-CertificateFingerprint $certificate) }
        [IO.File]::WriteAllText($identityFile, ($identity | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    }
    if (Test-Path -LiteralPath $PublicCertificatePath) { Assert-PublicIdentity $certificate }
    else { [IO.File]::WriteAllBytes($PublicCertificatePath, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)) }
    Write-Output ('Local signing identity: ' + $certificate.Subject)
    Write-Output ('Certificate SHA256: ' + (Get-CertificateFingerprint $certificate))
    Write-Output ('Expires: ' + $certificate.NotAfter.ToString('yyyy-MM-dd'))
    Write-Output 'Private key remains in CurrentUser\My. No trusted-root or trusted-publisher store was changed.'
    exit
}

if ($Action -eq 'Export') {
    $certificate = Get-LocalIdentity
    if (-not $Path) { throw 'Specify a private backup path outside the repository using -Path.' }
    $backupPath = [IO.Path]::GetFullPath($Path)
    $repositoryPath = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
    if ($backupPath.StartsWith($repositoryPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Keep private-key backups outside the source repository.' }
    if (Test-Path -LiteralPath $backupPath) { throw 'The backup file already exists; it will not be overwritten.' }
    $password = Read-Host 'Enter a strong password for this private PFX backup (never send it in chat)' -AsSecureString
    if ($password.Length -lt 12) { throw 'Use a backup password with at least 12 characters.' }
    Export-PfxCertificate -Cert $certificate -FilePath $backupPath -Password $password -CryptoAlgorithmOption AES256_SHA256 | Out-Null
    Write-Output 'Encrypted private-key backup created. Store it offline and keep its password separately.'
    exit
}

if (-not $Path) { throw 'Specify the file to sign or verify using -Path.' }
$target = (Resolve-Path -LiteralPath $Path).Path
if ([IO.Path]::GetExtension($target).ToLowerInvariant() -notin @('.exe','.dll','.msi','.cab')) { throw 'This helper supports Authenticode EXE, DLL, MSI and CAB files.' }
$tool = Get-OpenSourceSigner
$publicCertificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2($PublicCertificatePath)
$publicFingerprint = Get-CertificateFingerprint $publicCertificate
$publicPem = Join-Path $identityDirectory 'public-certificate.pem'
New-Item -ItemType Directory -Path $identityDirectory -Force | Out-Null
$pemText = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($publicCertificate.RawData,[Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----`n"
[IO.File]::WriteAllText($publicPem,$pemText,[Text.UTF8Encoding]::new($false))
if ($Action -eq 'Sign') {
    $certificate = Get-LocalIdentity
    Assert-PublicIdentity $certificate
    $signature = Get-AuthenticodeSignature -LiteralPath $target
    if ($signature.SignerCertificate -and $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) { throw 'This file is signed by another publisher; it will not be re-signed.' }
    $workDirectory = Join-Path $identityDirectory ('work-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $workDirectory | Out-Null
    $privateArchive = Join-Path $workDirectory 'temporary-encrypted.pfx'
    $candidate = Join-Path $workDirectory ('signed' + [IO.Path]::GetExtension($target))
    try {
        # The private key never goes into the repository. Its temporary export is
        # encrypted with a fresh random password passed through stdin, not argv.
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        $passwordBytes = New-Object byte[] 48
        try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
        $temporaryPassword = [Convert]::ToBase64String($passwordBytes)
        $privateBytes = $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$temporaryPassword)
        try { [IO.File]::WriteAllBytes($privateArchive,$privateBytes) } finally { [Array]::Clear($privateBytes,0,$privateBytes.Length) }
        $signArguments = @('sign','-pkcs12',$privateArchive,'-readpass','-','-h','sha256','-n','Letiaaan software')
        if ($TimestampServer) { $signArguments += @('-ts',$TimestampServer) }
        $temporaryPassword | & $tool @signArguments -in $target -out $candidate
        if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing failed.' }
        & $tool verify -CAfile $publicPem -require-leaf-hash ('sha256:' + $publicFingerprint) -in $candidate
        if ($LASTEXITCODE -ne 0) { throw 'The candidate failed cryptographic signature or file-digest verification.' }
        Copy-Item -LiteralPath $candidate -Destination $target -Force
    } finally {
        $temporaryPassword = $null
        if ($passwordBytes) { [Array]::Clear($passwordBytes,0,$passwordBytes.Length) }
        foreach ($temporaryFile in @($privateArchive,$candidate)) { Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $workDirectory -ErrorAction SilentlyContinue
    }
}

& $tool verify -CAfile $publicPem -require-leaf-hash ('sha256:' + $publicFingerprint) -in $target
if ($LASTEXITCODE -ne 0) { throw 'Cryptographic signature, file digest or signer identity verification failed.' }
$signature = Get-AuthenticodeSignature -LiteralPath $target
if ($signature.SignerCertificate) { Assert-PublicIdentity $signature.SignerCertificate }
Write-Output ('Signer: ' + $publicCertificate.Subject)
Write-Output ('Certificate SHA256: ' + $publicFingerprint)
Write-Output ('Windows trust status: ' + $signature.Status)
Write-Output $signature.StatusMessage
$publicCertificate.Dispose()
