const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');

const assets = ['UOOC-Study-complete-windows-x64.zip', 'UOOC-Study-windows-x64.zip',
    'UOOC-Study-source.zip', 'THIRD-PARTY-NOTICES.txt'];

function validateTag(tag, version) {
    if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('版本标签必须形如 v0.4.16');
    if (tag !== `v${version}`) throw new Error('版本标签必须与 package.json 的 version 一致');
    return tag;
}

function releaseNotes({ tag, version, commit, repository, changelog, signing = { type: 'unsigned' } }) {
    validateTag(tag, version);
    if (!/^[a-f0-9]{40}$/i.test(commit || '')) throw new Error('需要完整的 Git 提交标识');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('GitHub 仓库标识无效');
    const escaped = version.replace(/\./g, '\\.');
    const changes = changelog.match(new RegExp(`^## ${escaped}(?:[^\\n]*)\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1]?.trim();
    if (!changes) throw new Error('CHANGELOG.md 缺少当前版本说明');
    const source = `https://github.com/${repository}/blob/${tag}`;
    if (!['unsigned','self-signed'].includes(signing.type)) throw new Error('未知签名状态');
    if (signing.type === 'self-signed' && !/^[a-f0-9]{64}$/i.test(signing.certificateSha256 || '')) throw new Error('自签名证书指纹无效');
    const signatureNote = signing.type === 'self-signed'
        ? `**签名状态：Letiaaan 自签名，未经公共 CA 认证，Windows 不会默认信任，SmartScreen 仍可能提示。**\n\n证书 SHA256：\`${signing.certificateSha256}\`。公钥及核对方法见代码签名政策。`
        : '**签名状态：此下载包的启动器未签名。** 项目支持维护者本地自签名；本次构建没有使用私钥。SignPath 申请已被拒绝，未使用其签名服务。';
    return `## 更新内容\n\n${changes}\n\n## 下载\n\n` +
        '- 首次使用推荐 **UOOC-Study-complete-windows-x64.zip**，完整解压后启动 EXE 或 BAT。\n' +
        '- **UOOC-Study-windows-x64.zip** 为较小运行包；**UOOC-Study-source.zip** 为纯源码。\n' +
        '- **SHA256SUMS.txt** 用于核对附件完整性；文件哈希不等于发布者签名。\n\n' +
        `${signatureNote}\n\n` +
        `[使用说明](${source}/README.md) · [隐私政策](${source}/PRIVACY.md) · ` +
        `[Code signing policy](${source}/CODE_SIGNING.md) · [安全报告](${source}/SECURITY.md)\n\n` +
        `构建源码：[${commit}](https://github.com/${repository}/commit/${commit})；版本标签：\`${tag}\`。\n`;
}

function prepare({ root, tag, commit, repository }) {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const statusFile = path.join(root, '.build', 'signing-status.json');
    const signing = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile,'utf8')) : { type: 'unsigned' };
    const notes = releaseNotes({ tag, version, commit, repository, changelog: fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), signing });
    const dist = path.join(root, 'dist');
    const checksums = assets.map(name => `${createHash('sha256').update(fs.readFileSync(path.join(dist, name))).digest('hex')}  ${name}`).join('\n') + '\n';
    fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), checksums);
    fs.mkdirSync(path.join(root, '.build'), { recursive: true });
    fs.writeFileSync(path.join(root, '.build', 'release-notes.md'), notes);
}

if (require.main === module) {
    const { values } = parseArgs({ options: { tag: { type: 'string' }, commit: { type: 'string' },
        repository: { type: 'string' }, 'validate-only': { type: 'boolean' } } });
    const root = path.resolve(__dirname, '..');
    const { version } = require('../package.json');
    validateTag(values.tag, version);
    if (values['validate-only']) {
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${values.tag}\nversion=${version}\n`);
        console.log(`Release tag validated: ${values.tag}`);
    } else {
        prepare({ root, tag: values.tag, commit: values.commit, repository: values.repository });
        console.log('Release notes and SHA256SUMS.txt generated.');
    }
}

module.exports = { assets, validateTag, releaseNotes, prepare };
