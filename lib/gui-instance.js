const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

function workbenchURL(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password
            || url.pathname !== '/' || url.search || !/^#token=[a-f0-9]{48}$/.test(url.hash)) return null;
        return url;
    } catch { return null; }
}

async function probe(record, request = fetch, legacy = false) {
    const url = workbenchURL(record?.url);
    if (!url) return false;
    try {
        const response = await request(new URL(legacy ? '/api/state' : '/api/instance', url), {
            headers: { Authorization: `Bearer ${url.hash.slice(7)}` }, redirect: 'error', signal: AbortSignal.timeout(1200)
        });
        if (!response.ok) return false;
        const value = await response.json();
        if (legacy) return /^\d+\.\d+\.\d+$/.test(value.version) && Boolean(value.settings) && Array.isArray(value.courses);
        if (value.application !== 'uooc-study' || value.instance !== record.instance || value.pid !== record.pid) return false;
        if (value.activation) {
            const activated = await request(new URL('/api/activate', url), { method: 'POST',
                headers: { Authorization: `Bearer ${url.hash.slice(7)}`, 'Content-Type': 'application/json' },
                body: '{}', redirect: 'error', signal: AbortSignal.timeout(1200) });
            if (!activated.ok) return false;
        }
        return true;
    } catch { return false; }
}

function alive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
}

async function claimGuiInstance(directory, { request = fetch, attempts = 100, pause = delay } = {}) {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'gui-instance.json');
    for (let attempt = 0; attempt < attempts; attempt++) {
        let text, record;
        try { text = fs.readFileSync(file, 'utf8'); record = JSON.parse(text); } catch {}
        if (record && await probe(record, request)) return { existing: record.url };
        if (text !== undefined) {
            let malformedStale = false;
            try { malformedStale = !record && Date.now() - fs.statSync(file).mtimeMs > 30000; } catch { continue; }
            if (malformedStale || record && !alive(record.pid)) {
                // Only remove the stale record we inspected; never kill a PID.
                try { if (fs.readFileSync(file, 'utf8') === text) fs.unlinkSync(file); } catch {}
                continue;
            }
            await pause(150);
            continue;
        }
        // Older hidden launchers have no instance record, but their log contains
        // the authenticated local URL. Reopen them without touching their locks.
        try {
            const log = ['startup.log', 'bootstrap.log'].map(name => {
                try { return fs.readFileSync(path.join(directory, name), 'utf8'); } catch { return ''; }
            }).join('\n');
            const urls = [...log.matchAll(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{48}/g)].slice(-8).reverse();
            for (const [url] of urls) if (await probe({ url }, request, true)) return { existing: url, legacy: true };
        } catch {}
        const identity = { application: 'uooc-study', instance: randomUUID(), pid: process.pid, url: null };
        let fd;
        try { fd = fs.openSync(file, 'wx', 0o600); }
        catch (error) { if (error.code === 'EEXIST') continue; throw error; }
        try { fs.writeFileSync(fd, JSON.stringify(identity)); } finally { fs.closeSync(fd); }
        const owned = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).instance === identity.instance; } catch { return false; } };
        return {
            identity,
            publish(url) { if (!owned()) throw new Error('工作台启动记录已变化，请重新启动'); identity.url = url; fs.writeFileSync(file, JSON.stringify(identity), { mode: 0o600 }); },
            release() { try { if (owned()) fs.unlinkSync(file); } catch {} }
        };
    }
    throw new Error('上一个工作台正在启动或暂未响应，请稍后再次打开启动器。');
}

module.exports = { claimGuiInstance, workbenchURL };
