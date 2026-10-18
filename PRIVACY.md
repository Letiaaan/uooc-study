# Privacy Policy / 隐私政策

Last updated / 最后更新：2026-10-18。适用于 UOOC Study 0.4.16；后续数据处理变化会更新此文档。

UOOC Study 是在用户电脑上运行的第三方学习工作台，由 [Letiaaan](https://github.com/Letiaaan) 维护。[项目源码](https://github.com/Letiaaan/uooc-study)按 MIT 许可证公开。本项目与 UOOC、豆包、千问及 DeepSeek 无隶属关系。

## 数据用途与存储

| 信息 | 用途与保存位置 |
| --- | --- |
| UOOC 账号、密码 | 在 UOOC 官网完成用户选择的登录操作。工作台输入只用于当前运行会话，不自动写回配置；用户自行创建的 `config.txt` 可含明文账号、密码 |
| AI API 密钥、接口地址、模型设置 | 向用户配置的接口请求答案或测试连接。工作台输入不自动写回配置；配置文件和环境变量也可提供密钥 |
| Cookie 与登录会话 | UOOC 专用浏览器档案位于 `data/browser-profile*`，AI 档案位于 `data/ai-profiles/`；保存登录状态，退出程序后通常仍保留 |
| 课程与运行记录 | `data/` 下保存课程标识、处理进度和诊断记录；`data/runtime.log` 记录运行事件 |
| 隐藏启动日志 | `data/startup.log`（EXE）及 `data/bootstrap.log`（BAT）保存本次启动输出，可能含本机工作台访问地址与令牌；仅用于本机排错，不应公开分享 |
| 临时答案 | `data/temp-answers/quiz-*/` 下的 `reply.txt`、`answers.txt`、`paper.json` 保存 AI 原回复、规范答案、测验标识与题号，供回读和结果核对 |
| 工作台偏好与访问令牌 | 主题保存在浏览器 localStorage；本次本机工作台的访问令牌保存在 sessionStorage |
| 运行环境 | EXE 将运行时解压到 `%LOCALAPPDATA%\UOOC-Study\runtime`；完整包另含程序目录下的 `runtime/` 和依赖 |

程序尝试遮盖日志中自身已知的密码和密钥，**不能保证日志、AI 回复或截图不含其他敏感内容**。提交问题前请本人检查。不要分享正在使用的本机工作台链接或访问令牌。

## 联网与第三方服务

- 程序通过 UOOC 官网加载课程、播放资源、读取和提交用户选定的普通测验。账号与登录请求由 UOOC 接收。
- 使用网页 AI 时，整卷文字题干、选项和答案格式提示会发送到所选官网。登录在该平台官网完成，平台接收相应账号、Cookie、消息及普通网络请求信息。
- 使用 API 时，题目、提示和模型设置发送到配置的 `BASE_URL` 对应的 `/chat/completions` 接口；密钥通过 Authorization 请求头发送到**该接口地址**。请核对自定义地址的运营者。API 只在测验取答或用户主动测试连接时调用；连接测试也会向接口发送一条简短提示。
- 当前源码没有向维护者服务器发送应用遥测或崩溃报告的功能。官网和浏览器仍可能联网加载资源、统计脚本及 Cookie；这部分遵循各自规则。
- 缺少可用浏览器时，程序可能下载 Playwright Chromium；安装或构建源码会联网取得 npm 依赖和官方 Node.js 运行时。软件签名申请不会自动上传用户课程、账号或本机运行数据。

第三方对消息的保存、训练用途、删除和账号管理由其政策决定。本地删除临时文件或每卷开启新会话，**不会删除 AI 官网的历史会话或服务端记录**。

| 服务 | 官方条款或隐私入口 |
| --- | --- |
| UOOC | [服务条款（含隐私相关约定）](https://www.uooc.net.cn/misc/provision) |
| 豆包 | [隐私政策](https://www.doubao.com/legal/privacy) |
| 千问 | [隐私政策](https://terms.alicdn.com/legal-agreement/terms/privacy_policy_full/20231011201849846/20231011201849846.html) |
| DeepSeek | [隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html) |
| 自定义 API | 以所配置接口运营者的政策为准 |

需要人工登录或验证时，Windows 版本可弹出本机桌面提醒；用户点击“前往页面”后才调出相关页面。可在工作台关闭弹窗。提醒及后台窗口恢复通过程序自带的 PowerShell / Windows 窗口接口完成，不上传账号或题目，也不更改系统安全设置。

可选的维护者签名 / 用户验签命令首次使用时下载官方 osslsigncode 工具，仅供本机操作；正常启动不下载签名工具。维护者私钥留在 Windows 当前用户证书库，公钥 CER 随源码分发。本地签名只在本机处理待签文件，临时私钥导出使用随机密码加密并清理；备份或将加密 PFX 配置为 GitHub Actions Secret 由维护者本人明确操作。指定外部时间戳服务时会向其发送时间戳请求，默认不请求时间戳。

## 保留、退出与删除

确认测验通过后，程序仅清理标识匹配且目录结构符合预期的本卷临时答案。失败、结果不明或安全校验未通过时保留供核对；其他记录、配置和登录档案不会随退出自动清空，没有统一的自动到期删除期限。

可以停止任务，或使用“退出账号”清除当前 UOOC 浏览器会话的 Cookie 和网页存储。此操作不代表退出 AI 官网账号，也不删除第三方服务端数据。AI 登录退出和聊天记录删除请在对应官网操作。

卸载或清除本地数据时：

1. 在工作台点击“退出程序”，等待程序及其专用浏览器退出；备份需要保留的记录。
2. 按需删除程序目录内的 `config.txt`、其他实际配置及 `data/`。删除浏览器档案会丢失登录状态，删除运行记录会丢失本地进度记录。
3. 不再使用任何本项目版本时，可删除程序文件夹及 `%LOCALAPPDATA%\UOOC-Study\runtime` 缓存。本项目无需运行系统卸载服务。

Playwright 的全局浏览器缓存可能被其他程序使用，通常无需为卸载本项目而清空。删除本地记录不会撤销已向 UOOC 提交的结果；远端数据请求请联系对应平台。

## 联系与变更

一般问题通过 [GitHub Issues](https://github.com/Letiaaan/uooc-study/issues) 联系维护者；此处公开可见，请勿附上账号、密码、密钥、Cookie、私人课程内容或未脱敏日志。安全漏洞请按 [Security Policy](SECURITY.md) 私下报告。政策随版本维护，重大数据处理变化会在文档和发布说明中说明。

## English notice

UOOC Study runs locally. Workbench credentials and API settings are used in the current process and are not automatically written back to configuration files. User-created configuration files may store secrets in plaintext. Dedicated browser profiles retain UOOC and AI sign-in sessions; local course records, logs and temporary answers remain under `data/`. Logs redact secrets known to the application but may still contain sensitive information.

UOOC receives the website operations selected by the user. AI-assisted answering sends question text, answer options and prompts to the selected chat website or configured API endpoint. The API key is sent to that configured endpoint. Those services control their own processing, retention and deletion under the policies linked above. A new chat or local cleanup does not erase provider-side history. The application has no maintainer-hosted telemetry or crash collection feature; websites, browsers and dependency downloads still make network requests.

Temporary answers are removed only after confirmed quiz completion and successful local cleanup checks. Failed or uncertain attempts remain for review. Other local records have no automatic expiry. Exit the application before removing configuration, `data/`, application files or the app-specific runtime cache. UOOC logout does not sign out AI accounts. Use the official services to manage their remote data. Contact the maintainer through GitHub without disclosing secrets; see [SECURITY.md](SECURITY.md) for private vulnerability reporting.
