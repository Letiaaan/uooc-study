# Code signing policy

Last updated: 2026-10-18.

## Current status / 当前状态

**The SignPath Foundation application was declined. Local builds can now use a maintainer-owned self-signed certificate. This certificate is not authenticated by a public CA and is not trusted by Windows by default.**

SignPath 申请已被拒绝，未接入其服务。0.4.14 起支持 Letiaaan 自签名；本机使用 `-SelfSign` 生成的包带有该签名。GitHub 默认构建仍未签名，只有维护者另行配置私钥并明确启用后才自签名。请以每个 Release 的实际签名状态为准，旧包不会自动补签。

发布者：`CN=Letiaaan (Self-signed code signing)`。这是维护者自行声明的身份，不是公共机构核验的姓名或公司。公钥：[CODE_SIGNING_CERT.cer](CODE_SIGNING_CERT.cer)。证书 SHA256 指纹：

```text
117B412815FEEB22338A2DADBD0CF1C4273EEA2F794573B884124E36AB39FB01
```

证书使用 RSA 3072 / SHA256，代码签名用途，有效期至 2029-10-18。未使用可信时间戳时，不承诺证书过期后签名仍有效。自签名用于核对同一密钥签署和文件完整性，**不能保证消除“未知发布者”、SmartScreen 或其他安全提示**。程序不会安装受信任根证书或更改 Windows 安全设置。

## Project and responsibilities

The public source is maintained at [Letiaaan/uooc-study](https://github.com/Letiaaan/uooc-study) under the [MIT License](LICENSE).

[Letiaaan](https://github.com/Letiaaan) is responsible for source changes, local signing, release preparation and publication. Private keys remain under the maintainer's control; CI signing requires explicit configuration and opt-in. This is a single-maintainer project; no independent security audit or separate reviewer is claimed.

## Conditions for future publicly trusted signing

The following requirements apply before claiming a future publicly trusted CA/service signature. Current self-signed builds are explicitly labeled as such:

1. The signing service must be approved and configured for this repository. Repository and signing accounts must meet its multi-factor authentication and access requirements.
2. The release source, version and commit must be identified. The public [Windows build workflow](.github/workflows/windows.yml) runs checks and builds packages; signing integration must establish the connection between that source, its build and the artifact submitted for signing. Product and version metadata must match the release.
3. Each signing request must receive explicit human approval from the designated maintainer. A successful build alone must not authorize signing or publication.
4. Only the project's own launcher is in scope. Bundled upstream software, including the official Node.js runtime, retains its original licenses and any upstream signatures; it must not be presented as authored or signed by this project.
5. The signed EXE must pass signature verification before being included in the final download ZIP. Release notes must identify the signing status and the corresponding source revision.

These are requirements for future service integration, not a claim that the current self-signed build passed a signing-provider provenance check. The workflow creates release drafts; it signs only when explicitly configured, and does not automatically publish a draft.

## Verification by users

Download from the project's [GitHub Releases](https://github.com/Letiaaan/uooc-study/releases), extract the ZIP, and inspect the EXE in PowerShell from its folder:

```powershell
Get-AuthenticodeSignature -LiteralPath .\UOOC-Study.exe |
    Format-List Status, StatusMessage, SignerCertificate
Get-FileHash -LiteralPath .\UOOC-Study.exe -Algorithm SHA256
```

Unsigned builds show `NotSigned`. Self-signed builds can show `UnknownError` or `NotTrusted` with an untrusted-root message even when their file signature is intact. A different error must not be assumed harmless. Check the signer and certificate fingerprint, and use the verification helper below to check the signature and file digest against the published public certificate. This explicit per-command verification does not install the certificate as a Windows trust root. A SHA256 file hash is not a publisher signature. Keep Windows security protections enabled.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/code-signing.ps1 -Action Verify -Path .\UOOC-Study.exe
```

The helper downloads a pinned upstream osslsigncode release on first use, verifies its published SHA256 and uses the supplied public certificate as the expected signer for that operation only. Tampered files or a different signer fail verification. The signing tool is a build/verification dependency, not part of normal application startup.

## Maintainer reuse and private-key backup / 复用与备份

私钥在维护者电脑的 `Cert:\CurrentUser\My` 中；本机身份索引位于 `%LOCALAPPDATA%\Letiaaan\CodeSigning\identity.json`，只含公开证书标识。首次维护者初始化使用 `-Action Initialize`，已有身份会复用；找不到已有公钥对应私钥时拒绝静默换签名。

给自己的其他项目签名，可在本源码目录运行，或保留此脚本与公钥后复用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/code-signing.ps1 -Action Sign -Path "D:\MyProject\MyApp.exe"
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build.ps1 -SelfSign
```

支持 EXE、DLL、MSI、CAB。仅签署自己拥有发布权的文件，不覆盖其他发布者的签名。私钥使用临时随机密码加密后供签名工具读取，密码通过标准输入传递；临时 PFX 位于本机私有数据目录并在操作后清理，不进入源码或 ZIP。默认不联网请求时间戳；需要 RFC 3161 时可为签名命令指定 `-TimestampServer`。

**重装系统前请做加密私钥备份，否则可能无法继续使用同一签名。** 先创建源码目录之外的安全备份文件夹，然后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/code-signing.ps1 -Action Export -Path "D:\PrivateBackups\Letiaaan-CodeSigning.pfx"
```

在本机命令行输入备份密码；不要在聊天中发送密码。将 PFX 离线保存，密码分开保管。换电脑时本人通过 Windows 证书导入向导将 PFX 导入当前用户“个人”证书库，然后复用脚本；不需要导入受信任根证书库。公钥 CER 可以公开，**PFX/P12/KEY 和私钥不能上传源码或 Release**。密钥泄露时应停止使用并公开说明轮换；自签名没有公共 CA 替你完成全网撤销的保证。

## Service attribution and privacy

No SignPath service or sponsorship is active. If a publicly trusted service is adopted later, its status, attribution and workflow will be documented separately. The self-signed certificate does not imply approval by SignPath or Microsoft. Upstream signing utility: [osslsigncode](https://github.com/mtrojnar/osslsigncode), pinned to version 2.14 and archive SHA256 `9a1722aaf62a27852c4eb9c35749a0248065052d0ae0a93d4ed6bb49def027f2`.

The application's data handling is described in the [Privacy Policy / 隐私政策](PRIVACY.md). Personal configuration, credentials, browser profiles, logs and temporary answers must be excluded from public source and signing artifacts. Security concerns should be reported according to [SECURITY.md](SECURITY.md).
