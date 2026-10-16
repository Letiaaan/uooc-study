const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

function alive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
}

async function reconnectOwned(executable, profile, { request, connect, recordFile }) {
    let record;
    try { record = JSON.parse(fs.readFileSync(recordFile, 'utf8')); } catch { return null; }
    if (record.profile !== path.resolve(profile) || record.executable !== path.resolve(executable)) return null;
    let endpoint;
    try { endpoint = new URL(record.endpoint); } catch { return null; }
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port) return null;
    let info;
    try {
        const response = await request(`${endpoint.origin}/json/version`, { signal: AbortSignal.timeout(1200) });
        if (!response.ok) return null;
        info = await response.json();
    } catch { return null; }
    if (info.webSocketDebuggerUrl !== record.socket) return null;
    if (record.owner !== process.pid && alive(record.owner)) throw new Error('另一个 UOOC 工作台仍在使用这个程序浏览器档案，请退出旧工作台后重连；无需关闭日常使用的 Edge 或 Chrome');
    const browser = await connect(endpoint.origin, { noDefaults: true, timeout: 15000 });
    const context = browser.contexts()[0];
    if (!context) { await browser.close(); return null; }
    const updated = { ...record, owner: process.pid };
    fs.writeFileSync(recordFile, JSON.stringify(updated));
    installClose(context, browser, null, recordFile, updated.socket);
    console.log('已重新连接上次程序留下的浏览器，保留登录状态。');
    return context;
}

function installClose(context, browser, child, recordFile, socket) {
    let closing;
    context.close = () => closing ||= (async () => {
        let stopped = false;
        try {
            const session = await browser.newBrowserCDPSession();
            await session.send('Browser.close');
            stopped = true;
        } catch {} finally { await browser.close().catch(() => {}); }
        if (recordFile && stopped) {
            try {
                if (JSON.parse(fs.readFileSync(recordFile, 'utf8')).socket === socket) fs.unlinkSync(recordFile);
            } catch {}
        }
        if (child?.exitCode === null) await new Promise(resolve => {
            const done = () => { clearTimeout(timer); child.off('exit', done); resolve(); };
            const timer = setTimeout(done, 3000);
            child.once('exit', done);
        });
    })();
}

async function localPort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function launchLocalBrowser(executable, profile, {
    start = spawn, request = fetch, pause = delay, headless = false, remember = start === spawn,
    connect = (url, options) => chromium.connectOverCDP(url, options)
} = {}) {
    const recordFile = remember ? path.join(profile, '.uooc-browser.json') : null;
    if (recordFile) {
        fs.mkdirSync(profile, { recursive: true });
        const restored = await reconnectOwned(executable, profile, { request, connect, recordFile });
        if (restored) return restored;
    }
    const port = await localPort();
    const endpoint = `http://127.0.0.1:${port}`;
    const child = start(executable, [
        `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
        '--no-first-run', '--no-default-browser-check', ...(headless ? ['--headless=new', '--window-size=1280,900'] : ['--start-maximized']), '--mute-audio',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows', 'about:blank'
    ], { stdio: 'ignore', windowsHide: headless });
    let failed;
    child.once('error', error => { failed = error; });
    let browser;
    try {
        let ready = false, socket, exitedChecks = 0;
        for (let attempt = 0; attempt < 60; attempt++) {
            if (failed) throw new Error(`浏览器进程启动失败：${failed.code || '未知错误'}`);
            try {
                const response = await request(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) });
                if (response.ok) {
                    const info = await response.json();
                    const address = new URL(info.webSocketDebuggerUrl);
                    ready = address.protocol === 'ws:' && address.hostname === '127.0.0.1'
                        && address.port === String(port) && address.pathname.startsWith('/devtools/browser/');
                    if (ready) socket = info.webSocketDebuggerUrl;
                }
            } catch {}
            if (ready) break;
            // Edge may hand startup off to another process before CDP is ready.
            // An exited bootstrap process alone does not prove a profile lock.
            if (child.exitCode !== null && ++exitedChecks >= 12) {
                if (recordFile) {
                    const restored = await reconnectOwned(executable, profile, { request, connect, recordFile });
                    if (restored) return restored;
                }
                throw new Error(`浏览器启动进程已退出（${child.exitCode}），程序档案可能被旧窗口占用。请关闭上次由程序打开的浏览器窗口或退出旧工作台后重连；无需关闭日常使用的浏览器`);
            }
            await pause(250);
        }
        if (!ready) throw new Error('等待本机浏览器连接超时，请关闭程序浏览器后重试；也可在 config.txt 中设置 BROWSER=msedge');
        browser = await connect(endpoint, { noDefaults: true, timeout: 15000 });
        const context = browser.contexts()[0];
        if (!context) throw new Error('尚未找到浏览器会话');
        if (recordFile) fs.writeFileSync(recordFile, JSON.stringify({ profile: path.resolve(profile), executable: path.resolve(executable),
            endpoint, socket, owner: process.pid, pid: child.pid }));
        installClose(context, browser, child, recordFile, socket);
        child.unref();
        return context;
    } catch (error) {
        if (browser) await browser.close().catch(() => {});
        if (child.exitCode === null) child.kill();
        throw error;
    }
}

module.exports = { launchLocalBrowser };
