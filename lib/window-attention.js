const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const helper = path.join(__dirname, 'window-helper.ps1');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper];

async function restoreBackground(page) {
    if (process.platform !== 'win32') return false;
    const browser = page.context().browser?.();
    if (!browser?.newBrowserCDPSession) return false;
    const session = await browser.newBrowserCDPSession();
    try {
        const { processInfo } = await session.send('SystemInfo.getProcessInfo');
        const pid = processInfo.find(info => info.type === 'browser')?.id;
        if (!Number.isSafeInteger(pid) || pid <= 0) return false;
        const { stdout } = await promisify(execFile)(powershell,
            [...args, '-Action', 'restore', '-BrowserProcessId', String(pid)], { windowsHide: true, timeout: 8000 });
        return Number(stdout.trim()) > 0;
    } finally { await session.detach().catch(() => {}); }
}

class VerificationNotice {
    constructor({ start = spawn, platform = process.platform, onOpen = () => {}, onError = () => {} } = {}) {
        Object.assign(this, { start, platform, onOpen, onError });
        this.value = null;
        this.enabled = true;
        this.seen = null;
    }
    update(value = this.value, enabled = this.enabled) {
        this.value = value;
        this.enabled = enabled;
        if (!value || !enabled) { this.close(); this.seen = null; return; }
        if (this.seen === value.id) return;
        this.close();
        this.seen = value.id;
        if (this.platform !== 'win32') return;
        let child;
        try {
            child = this.start(powershell, [...args, '-Action', 'notice', '-Reason',
                value.kind === 'video-question' ? 'video' : value.kind !== 'login' ? 'quiz' : value.reason === 'credentials' ? 'credentials' : 'login'],
            { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch { this.onError(); return; }
        this.child = child;
        let output = '';
        child.stdout?.on('data', chunk => { output = (output + chunk).slice(-100); });
        child.stderr?.resume?.();
        child.on('error', () => { if (this.child === child) { this.child = null; this.onError(); } });
        child.on('exit', code => {
            if (this.child !== child) return;
            this.child = null;
            if (this.enabled && this.value?.id === value.id && output.trim() === 'open') this.onOpen(value.id);
            else if (code) this.onError();
        });
    }
    close() {
        const child = this.child;
        this.child = null;
        child?.kill();
    }
}

module.exports = { restoreBackground, VerificationNotice };
