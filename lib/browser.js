const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { data, makeDataDirectory, settings } = require('./settings');
const { launchLocalBrowser } = require('./local-browser');

async function openBrowser({ profileName, browser: selected = settings().browser } = {}) {
    if (!['auto', 'chrome', 'msedge', 'chromium'].includes(selected)) throw new Error('BROWSER 可选 auto、chrome、msedge 或 chromium');
    makeDataDirectory();
    const channels = selected === 'auto' ? ['chrome', 'msedge', 'chromium'] : [selected];
    for (const channel of channels) {
        const executable = channel === 'chrome' ? [
            path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
        ] : channel === 'msedge' ? [
            path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe')
        ] : [chromium.executablePath()];
        const installed = executable.find(file => fs.existsSync(file));
        if (!installed) continue;
        const profile = profileName ? path.join(data, profileName, channel)
            : path.join(data, channel === 'chrome' ? 'browser-profile' : `browser-profile-${channel}`);
        console.log(`启动本机 ${channel === 'msedge' ? 'Edge' : channel === 'chrome' ? 'Chrome' : 'Chromium'}，请在浏览器手动完成智能验证。`);
        return launchLocalBrowser(installed, profile);
    }
    if (!channels.includes('chromium')) throw new Error(`本机尚未找到 ${selected}，请安装对应浏览器或设置 BROWSER=auto`);
    console.log('正在从 Playwright 官方源安装 Chromium，首次运行需要联网。');
    const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    const install = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
    if (install.status !== 0) throw new Error('浏览器下载失败，请检查网络后重试');
    return launchLocalBrowser(chromium.executablePath(), path.join(data, profileName || 'browser-profile-chromium'));
}

async function visibleAcrossFrames(page, selector) {
    for (const frame of page.frames()) {
        const candidates = frame.locator(selector);
        for (const item of await candidates.all()) if (await item.isVisible().catch(() => false)) return item;
    }
    return null;
}

async function navigate(page, url) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return;
        } catch (error) {
            if (attempt) {
                const code = error.message.match(/net::ERR_[A-Z_]+|Timeout \d+ms exceeded/)?.[0] || '跳转未完成';
                throw new Error(`页面加载失败：${new URL(url).hostname}${new URL(url).pathname}（${code}）`, { cause: error });
            }
            await page.waitForTimeout(1200);
        }
    }
}

module.exports = { openBrowser, visibleAcrossFrames, navigate };
