# Security Policy / 安全政策

Last updated / 最后更新：2026-10-17。

## Supported versions / 支持范围

Security fixes are targeted at the latest released version, currently **0.4.12**. Older versions may not receive backported fixes. This is a community project with no guaranteed response time or independent audit claim.

安全修复优先提供给最新发布版本；旧版本不保证回补。维护者会核对报告、评估影响并通过修复版本及发布说明通知用户，目前不承诺固定响应时限。

## Reporting a vulnerability / 报告漏洞

Please do not publish credentials, API keys, cookies, browser profiles, private course material, live workbench URLs/tokens, or exploit details in a public issue.

1. Open the repository's [Security page](https://github.com/Letiaaan/uooc-study/security). If GitHub private vulnerability reporting is enabled, use **Report a vulnerability** to contact the maintainer privately. Availability depends on the repository setting; this document does not assert it is already enabled.
2. If that option is unavailable, open a [public issue](https://github.com/Letiaaan/uooc-study/issues) requesting a private reporting channel, with only a brief, nonsensitive description. Wait for a private channel before sharing reproduction details or sensitive files. No dedicated security email is currently published.

可在仓库 Security 页面使用私密漏洞报告（需仓库已开启）。若没有该入口，请先发一个仅请求私下联系的公开 Issue，**不要公开可利用步骤或敏感附件**。

A useful private report includes the application version, Windows/browser version, affected component, a minimal reproduction using dummy data, and the expected versus observed behavior. Redact all personal information. Do not test against other people's accounts or production services without their permission.

## If a secret has been exposed / 意外泄露

Revoke or rotate the affected API key, change the relevant password where appropriate, and revoke sessions through the official service. Removing a file in a new Git commit does not remove it from earlier history, releases, forks or previously downloaded copies. Tell the maintainer privately if public project artifacts are affected.

若误传密钥、密码或会话，请先在对应官网撤销或更换；仅从最新提交删除文件不足以消除历史泄露。发布日志前需本人核对，程序脱敏不能覆盖所有敏感内容。

## Local access and related policies

The workbench listens on `127.0.0.1` and uses a per-run access token. Do not expose it through port forwarding, share its live token, or run untrusted software with access to your browser profiles. Local configuration can contain plaintext secrets. Dedicated browser profiles are private login data, not distributable application files.

See the [Privacy Policy](PRIVACY.md), [Code signing policy](CODE_SIGNING.md) and [third-party notices](第三方声明.md). These documents describe current behavior and release expectations; they do not certify the security of UOOC or an AI provider.
