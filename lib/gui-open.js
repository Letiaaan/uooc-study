const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');

function browserCommand(command, url, exists = fs.existsSync) {
    const executable = command?.trim().match(/^(?:"([^"]+\.exe)"|(.+?\.exe)(?:\s|$))/i);
    const file = executable?.[1] || executable?.[2];
    if (!file || !path.win32.isAbsolute(file) || !exists(file)) return null;
    const name = path.win32.basename(file).toLowerCase();
    if (['msedge.exe', 'chrome.exe', 'brave.exe', 'vivaldi.exe'].includes(name)) return [file, ['--new-window', url]];
    if (name === 'firefox.exe') return [file, ['-new-window', url]];
    return null;
}

function launchVisible(command, start) {
    return new Promise((resolve, reject) => {
        // These are GUI executables, so showing them does not create a terminal.
        const child = start(command[0], command[1], { stdio: 'ignore', windowsHide: false });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
    });
}

async function openingCommand(url, { run, exists }) {
    try {
        const options = { windowsHide: true, encoding: 'utf8', timeout: 2000, maxBuffer: 32768 };
        const choice = await run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', '/v', 'ProgId'], options);
        const progID = choice.stdout.match(/\bProgId\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
        if (progID && /^[a-z\d._-]+$/i.test(progID)) {
            const handler = await run('reg.exe', ['query', `HKCR\\${progID}\\shell\\open\\command`, '/ve'], options);
            return browserCommand(handler.stdout.match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i)?.[1], url, exists);
        }
    } catch { /* Unknown default handler. */ }
    return null;
}

async function confirmWorkbench(url, { request = fetch, wait = delay, timeout = 1800 } = {}) {
    const headers = { Authorization: `Bearer ${new URL(url).hash.slice(7)}`, 'Content-Type': 'application/json' };
    try {
        const activation = await request(new URL('/api/activate', url), { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(1000) });
        // Older backends do not expose client readiness.
        if (activation.status === 404) return true;
        if (!activation.ok) return false;
    } catch { return false; }
    const deadline = Date.now() + timeout;
    do {
        try {
            const response = await request(new URL('/api/instance', url), { headers, signal: AbortSignal.timeout(1000) });
            if (response.ok) {
                const value = await response.json();
                if (value.clients === undefined || value.clients > 0) return true;
            }
        } catch {}
        await wait(100);
    } while (Date.now() < deadline);
    return false;
}

async function openWorkbench(url, { platform = process.platform, run = promisify(execFile), confirm = async () => true, attempts = 3,
    spawnProcess = spawn, exists = fs.existsSync } = {}) {
    if (platform !== 'win32') { console.log('请在浏览器打开程序显示的本机地址。'); return; }
    const fallback = ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
    let command = await openingCommand(url, { run, exists });
    for (let attempt = 0; attempt < attempts; attempt++) {
        try { await launchVisible(command || fallback, spawnProcess); }
        catch (error) {
            if (!command) throw error;
            command = null;
            await launchVisible(fallback, spawnProcess);
        }
        if (await confirm()) return;
    }
    throw new Error('工作台窗口未能连接，已自动重试。请关闭正在退出的浏览器后再次启动。');
}

module.exports = { openWorkbench, browserCommand, confirmWorkbench };
