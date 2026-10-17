# Code signing policy

Last updated: 2026-10-17.

## Current status / 当前状态

**A SignPath Foundation application has been submitted; approval and signing integration are pending. Current UOOC Study launchers are unsigned, including version 0.4.13 prepared for release.**

已提交 SignPath Foundation 申请，尚未获批或接入签名。当前发布的启动器没有代码签名。申请不代表安全认证；本页也不表示 SignPath 已为项目提供签名服务。

## Project and responsibilities

The public source is maintained at [Letiaaan/uooc-study](https://github.com/Letiaaan/uooc-study) under the [MIT License](LICENSE).

[Letiaaan](https://github.com/Letiaaan) is the maintainer responsible for source changes, release preparation and publication. If signing is approved and enabled, the maintainer will be the designated signing approver, subject to the provider's enrollment and access requirements. This is currently a single-maintainer project; no independent security audit or separate reviewer is claimed.

## Conditions for future signed releases

Before a release is represented as signed:

1. The signing service must be approved and configured for this repository. Repository and signing accounts must meet its multi-factor authentication and access requirements.
2. The release source, version and commit must be identified. The public [Windows build workflow](.github/workflows/windows.yml) runs checks and builds packages; signing integration must establish the connection between that source, its build and the artifact submitted for signing. Product and version metadata must match the release.
3. Each signing request must receive explicit human approval from the designated maintainer. A successful build alone must not authorize signing or publication.
4. Only the project's own launcher is in scope. Bundled upstream software, including the official Node.js runtime, retains its original licenses and any upstream signatures; it must not be presented as authored or signed by this project.
5. The signed EXE must pass signature verification before being included in the final download ZIP. Release notes must identify the signing status and the corresponding source revision.

These are requirements for future integration, not a claim that the current locally built release already passed a signing-provider provenance check. The current workflow builds unsigned packages and does not automatically publish releases.

## Verification by users

Download from the project's [GitHub Releases](https://github.com/Letiaaan/uooc-study/releases), extract the ZIP, and inspect the EXE in PowerShell from its folder:

```powershell
Get-AuthenticodeSignature -LiteralPath .\UOOC-Study.exe |
    Format-List Status, StatusMessage, SignerCertificate
Get-FileHash -LiteralPath .\UOOC-Study.exe -Algorithm SHA256
```

For the current release, `NotSigned` is expected. For a future signed release, check for a valid signature and the publisher stated in that release. A SHA256 hash can identify a file and be compared with a published checksum; a hash is not a publisher signature. Code signing does not guarantee immediate Microsoft SmartScreen reputation or absence of defects. Keep Windows security protections enabled.

## Service attribution and privacy

After approval and actual service activation, this page and the download information will be updated with the required provider attribution and final workflow details. Until then, no active signing-service sponsorship is claimed. See [SignPath Foundation](https://signpath.org/), its [terms](https://signpath.org/terms) and [privacy policy](https://signpath.io/privacy-policy).

The application's data handling is described in the [Privacy Policy / 隐私政策](PRIVACY.md). Personal configuration, credentials, browser profiles, logs and temporary answers must be excluded from public source and signing artifacts. Security concerns should be reported according to [SECURITY.md](SECURITY.md).
