const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { launchLocalBrowser } = require('../lib/local-browser');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function childProcess() {
    return Object.assign(new EventEmitter(), {
        exitCode: null, killed: false, unref() {},
        kill() { this.killed = true; this.exitCode = 1; this.emit('exit', 1); }
    });
}

test('local browser connects to its own loopback endpoint and closes gracefully once', async () => {
    const child = childProcess();
    let port, requests = 0, closed = 0, sent = 0;
    const context = {};
    const browser = {
        contexts: () => [context],
        newBrowserCDPSession: async () => ({ send: async method => {
            assert.equal(method, 'Browser.close');
            sent++;
            child.exitCode = 0;
            child.emit('exit', 0);
        } }),
        close: async () => { closed++; }
    };
    const result = await launchLocalBrowser('C:/Browser/chrome.exe', 'C:/Sample Data/profile', {
        background: true,
        start: (executable, args, options) => {
            assert.equal(executable, 'C:/Browser/chrome.exe');
            assert.ok(args.includes('--user-data-dir=C:/Sample Data/profile'));
            assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
            assert.ok(args.includes('--disable-backgrounding-occluded-windows'));
            assert.ok(args.includes('--no-startup-window'));
            assert.equal(args.includes('--start-maximized'), false);
            port = Number(args.find(value => value.startsWith('--remote-debugging-port=')).split('=')[1]);
            assert.ok(port > 0);
            assert.equal(options.stdio, 'ignore');
            assert.equal(options.windowsHide, true);
            return child;
        },
        request: async url => {
            assert.equal(url, `http://127.0.0.1:${port}/json/version`);
            requests++;
            if (requests === 1) throw new Error('Starting');
            return { ok: true, json: async () => ({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/sample` }) };
        },
        pause: async () => {},
        connect: async (url, options) => {
            assert.equal(url, `http://127.0.0.1:${port}`);
            assert.equal(options.noDefaults, true);
            return browser;
        }
    });
    assert.equal(result, context);
    await Promise.all([context.close(), context.close()]);
    assert.equal(sent, 1);
    assert.equal(closed, 1);
    assert.equal(child.killed, false);
});

test('an occupied profile produces an actionable error before connection', async () => {
    const child = childProcess();
    child.exitCode = 0;
    await assert.rejects(launchLocalBrowser('browser', 'profile', {
        start: () => child,
        request: async () => { throw new Error('No debugging endpoint'); }, pause: async () => {},
        connect: async () => assert.fail('Exited browser must not be connected')
    }), /关闭上次由程序打开的浏览器/);
    assert.equal(child.killed, false);
});

test('Edge bootstrap may exit before its debugging endpoint becomes available', async () => {
    const child = childProcess(); child.exitCode = 0;
    let port, requests = 0;
    const context = {};
    const browser = { contexts: () => [context], close: async () => {}, newBrowserCDPSession: async () => ({ send: async () => {} }) };
    const result = await launchLocalBrowser('browser', 'profile', {
        start: (exe, args) => { port = args.find(arg => arg.startsWith('--remote-debugging-port=')).split('=')[1]; return child; },
        request: async () => {
            if (++requests < 3) throw new Error('Still starting after handoff');
            return { ok: true, json: async () => ({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/handoff` }) };
        }, pause: async () => {}, connect: async () => browser
    });
    assert.equal(result, context);
    assert.equal(requests, 3);
    assert.equal(child.killed, false);
    await context.close();
});

test('unexpected remote endpoints are rejected and only the started process is stopped', async () => {
    const child = childProcess();
    await assert.rejects(launchLocalBrowser('browser', 'profile', {
        start: () => child,
        request: async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://example.org/devtools/browser/sample' }) }),
        pause: async () => {},
        connect: async () => assert.fail('Remote endpoint must not be connected')
    }), /连接超时/);
    assert.equal(child.killed, true);
});

test('an owned browser left by a dead worker reconnects without launching or closing unrelated browsers', async t => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-reconnect-'));
    t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
    const executable = path.resolve('sample-edge.exe');
    const socket = 'ws://127.0.0.1:12345/devtools/browser/owned-nonce';
    fs.writeFileSync(path.join(profile, '.uooc-browser.json'), JSON.stringify({
        profile, executable, endpoint: 'http://127.0.0.1:12345', socket, owner: 2147483647
    }));
    const context = {};
    let closes = 0;
    const browser = { contexts: () => [context], newBrowserCDPSession: async () => ({ send: async () => { closes++; } }), close: async () => {} };
    const restored = await launchLocalBrowser(executable, profile, {
        remember: true, start: () => assert.fail('An orphaned owned browser should be reused'),
        request: async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: socket }) }),
        connect: async endpoint => { assert.equal(endpoint, 'http://127.0.0.1:12345'); return browser; }
    });
    assert.equal(restored, context);
    assert.equal(closes, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, '.uooc-browser.json'))).owner, process.pid);
    await context.close();
    assert.equal(closes, 1);
    assert.equal(fs.existsSync(path.join(profile, '.uooc-browser.json')), false);
});

test('a browser still owned by another live worker is not attached or killed', async t => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-reconnect-'));
    t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
    const executable = path.resolve('sample-edge.exe');
    const socket = 'ws://127.0.0.1:12345/devtools/browser/owned-nonce';
    fs.writeFileSync(path.join(profile, '.uooc-browser.json'), JSON.stringify({
        profile, executable, endpoint: 'http://127.0.0.1:12345', socket, owner: process.ppid
    }));
    await assert.rejects(launchLocalBrowser(executable, profile, {
        remember: true, start: () => assert.fail('Must not launch'), connect: () => assert.fail('Must not attach'),
        request: async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: socket }) })
    }), /另一个 UOOC 工作台/);
});
