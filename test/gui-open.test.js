const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { openWorkbench, browserCommand, confirmWorkbench } = require('../lib/gui-open');

const url = 'http://127.0.0.1:12345/#token=' + 'a'.repeat(48);
function recorder(calls, failFirst = false) {
    return (...args) => {
        calls.push(args);
        const child = new EventEmitter();
        child.unref = () => {};
        process.nextTick(() => child.emit(failFirst && calls.length === 1 ? 'error' : 'spawn', new Error('Fixture failure')));
        return child;
    };
}
const registry = file => async (exe, args, options) => {
    assert.equal(exe, 'reg.exe');
    assert.equal(options.windowsHide, true);
    return { stdout: args.includes('ProgId') ? '    ProgId    REG_SZ    MSEdgeHTM\r\n'
        : `    (Default)    REG_SZ    "${file}" --single-argument %1\r\n` };
};

for (const name of ['msedge', 'chrome']) {
    test(`a default ${name} opens an explicit visible window without requiring an existing browser`, async () => {
        const calls = [], file = `C:\\Program Files\\Browser\\${name}.exe`;
        await openWorkbench(url, { platform: 'win32', run: registry(file), exists: () => true, spawnProcess: recorder(calls) });
        assert.deepEqual(calls, [[file, ['--new-window', url], { stdio: 'ignore', windowsHide: false }]]);
    });
}
test('missing association and failed direct launches fall back to a visible Windows URL handler', async () => {
    for (const unavailable of [true, false]) {
        const calls = [];
        await openWorkbench(url, { platform: 'win32', run: unavailable ? async () => { throw Error('Missing association'); } : registry('C:\\Browser\\msedge.exe'),
            exists: () => true, spawnProcess: recorder(calls, !unavailable) });
        assert.deepEqual(calls.at(-1), ['rundll32.exe', ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', windowsHide: false }]);
    }
});
test('registry command text is parsed without executing stored arguments or arbitrary handlers', () => {
    assert.deepEqual(browserCommand('"C:\\Browser\\chrome.exe" --single-argument %1 & bad', url, () => true),
        ['C:\\Browser\\chrome.exe', ['--new-window', url]]);
    for (const command of ['cmd.exe /c bad', '"C:\\Windows\\cmd.exe" /c bad', 'relative\\msedge.exe %1', '"C:\\Browser\\missing.exe" %1']) {
        assert.equal(browserCommand(command, url, () => true), null);
    }
    assert.equal(browserCommand('"C:\\Browser\\msedge.exe" %1', url, () => false), null);
});

test('an opening request swallowed during browser shutdown is retried until a page connects', async () => {
    const calls = [];
    let checks = 0;
    await openWorkbench(url, { platform: 'win32', run: registry('C:\\Browser\\msedge.exe'), exists: () => true,
        spawnProcess: recorder(calls), confirm: async () => ++checks === 2 });
    assert.equal(calls.length, 2);
    const failed = [];
    await assert.rejects(openWorkbench(url, { platform: 'win32', run: registry('C:\\Browser\\msedge.exe'), exists: () => true,
        spawnProcess: recorder(failed), confirm: async () => false }), /窗口未能连接/);
    assert.equal(failed.length, 3);
});

test('readiness requires a connected page and renews its activation reservation', async () => {
    const calls = [];
    let sessions = 0;
    const ready = await confirmWorkbench(url, { wait: async () => {}, request: async (address, options) => {
        calls.push({ path: address.pathname, method: options.method });
        if (address.pathname === '/api/activate') return { ok: true };
        return { ok: true, json: async () => ({ clients: sessions++ }) };
    } });
    assert.equal(ready, true);
    assert.equal(calls[0].path, '/api/activate');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls.filter(call => call.path === '/api/instance').length, 2);
});
