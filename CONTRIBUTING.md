# 开发与发布指南

用户安装、账号连接和运行模式见 [README](README.md)。提交安全问题请先阅读 [SECURITY.md](SECURITY.md)。

## 本地开发

使用 Node.js 24，在仓库目录执行：

```powershell
npm ci
npm test
npm run check
```

`npm test` 使用本地样例检查目录、浏览器、取答、运行控制、验证提醒、交卷与清理，不访问真实课程或 AI 官网。`npm run check` 只检查运行环境。

```powershell
npm run test:browsers
npm run test:promotions
npm run build:windows
```

浏览器测试使用本机 Chrome / Edge 和豆包 / 千问样例，每组两份 30 题试卷，共 8 份；默认不显示窗口。需观察时追加 `-- --headed`。不要在测试脚本中加入真实密码、Cookie、密钥或私人试卷。

`npm run test:minimized` 是单独启用的 Windows 桌面验收：使用本机 Chrome / Edge 和本地生成的媒体，检查实际最小化窗口中的播放、弹题、导航以及前台窗口保持；最后测试主动恢复页面，会短暂显示测试窗口。此项需要可交互桌面，不加入默认单元测试和无桌面的 CI。构建后可运行 `node tools/check-launcher.js`，等待 GUI 子系统 EXE 的环境检查结束并校验版本与退出码。

Windows 构建使用系统 .NET Framework C# 编译器，下载官方 Node.js 并核对 SHA256。输出在 `dist/`：完整 Windows 包、较小运行包、纯源码包、启动器及第三方许可。完整包保留全部源码、开发与生产依赖和 Node.js 运行时；实际配置与 `data/` 不进入包。

构建后运行 `node tools/test-launchers.js`，在隔离目录验证 EXE 连续启动、BAT 与 EXE 混合启动和旧版独占启动日志；不打开桌面浏览器、不连接 UOOC 或 AI。Windows 与 Release 工作流均执行此检查。

构建结束自动执行 `tools/check-packages.ps1`，检查 Windows ZIP 内的 EXE 与独立 EXE 的 SHA256 一致、源码版本一致、视频弹题及窗口模块未过期，同时检查启动脚本和私人文件排除。Release 附件包含三种 ZIP、独立 EXE、许可及统一 SHA256 清单。更新运行目录时，注意 BAT 优先运行源码；只换 EXE 后应直接运行 EXE，完整升级应使用同一版本整包。

## 提交更新

1. 在 GitHub Desktop 克隆仓库；已有克隆时，先 Fetch / Pull 取得远端更新。
2. 在克隆目录编辑源码。若从其他工作目录复制更新，只复制明确的源码文件，保留克隆目录中的 `.git`，核对并合并 README 等远端编辑。
3. 在 Changes 检查差异。`config.txt`、`.env`、`data/`、日志和浏览器档案不能提交；`.gitignore` 不能保护已经被 Git 跟踪的秘密。
4. Commit 到本地后 Push origin。二进制、依赖与 ZIP 放入 Releases，不进入源码历史。

## 自动构建与 Release 草稿

普通 main 推送和 Pull Request 触发 [Windows build](.github/workflows/windows.yml)，执行测试、环境检查和打包，将 ZIP 保存为 Actions Artifacts。

版本发布由 [Prepare release draft](.github/workflows/release.yml) 处理：

1. 更新 `package.json` 和 `package-lock.json` 中的版本，更新 [CHANGELOG](CHANGELOG.md)，并核对政策、签名状态和文档。
2. 提交并推送源码，在该提交上创建与版本完全一致的标签，例如 `v0.4.19`，然后推送标签。
3. Actions 校验标签与源码版本，执行测试及打包；生成 SHA256 清单，在单独的发布任务中校验附件，再创建 Release **草稿**。
4. 到 GitHub Releases 打开草稿，核对源码提交、说明和附件，试用下载包后点击 **Publish release**。

GitHub Desktop 可在 History 中右键要发布的提交创建标签，再推送到 origin。也可在仓库终端执行：

```powershell
git tag v0.4.19
git push origin v0.4.19
```

不要在错误的提交上打标签。流程也支持在 Actions 手动运行并填写**已存在的版本标签**。重复运行同一标签时，若已有同名 Release，创建步骤会失败，不覆盖已发布附件；请先核对已有版本。

发布使用 GitHub 内置 `GITHUB_TOKEN`，无需在源码中填写个人 Token。构建任务只有读取权限，创建草稿的独立任务才有写入权限。SignPath 申请已被拒绝，未接入其服务。推送 main 本身不会发布新版本。

本机自签名使用 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/build.ps1 -SelfSign`，在生成 ZIP 前签署并校验启动器。复用及加密私钥备份见 [签名政策](CODE_SIGNING.md)。不要把本机签过的 EXE 当作与默认 CI 无签名 EXE 完全相同的文件；发布说明必须对应实际附件。

### 可选：在自己的 Release 工作流启用同一自签名

默认不上传或使用私钥。维护者决定启用时，在仓库 **Settings → Secrets and variables → Actions** 配置：

- Secret `CODE_SIGNING_PFX_BASE64`：加密 PFX 文件的 Base64 内容，仅在 GitHub 的 Secret 输入框填写。
- Secret `CODE_SIGNING_PFX_PASSWORD`：该 PFX 的强密码。
- Variable `ENABLE_SELF_SIGNING`：`true`，明确启用。

PFX 与密码属于敏感凭据，应先确认仓库、标签发布权限及有权修改工作流的人。不要放入 Issue、聊天、配置示例或源码。工作流校验证书必须与公开 CER 一致；缺少、过期或不匹配会失败，不会偷偷替换签名。只开启变量却没有配置两个 Secret 时发布失败；未开启变量时正常生成未签名包并如实标注。是否使用 GitHub 保存该私钥由维护者自行决定，本项目不会自动上传本机证书。

## 分发前检查

- 检查改动和测试结果，核对版本标签、锁文件、更新说明和下载包。
- 确认包内无实际配置、登录档案、日志、临时答案或本地构建数据。
- 保留 MIT、依赖许可和 `THIRD-PARTY-NOTICES.txt`，第三方来源见 [第三方声明](第三方声明.md)。
- 核对本次构建究竟是未签名还是自签名，不把自签名描述成公共 CA 信任或 SmartScreen 放行。指纹、验证和私钥保护见 [Code signing policy](CODE_SIGNING.md)。

站点适配依据与实现原理见 [技术选型](技术选型.md)、[原理](原理.md)；既往验证与限制见 [测试记录](测试记录.md)。
