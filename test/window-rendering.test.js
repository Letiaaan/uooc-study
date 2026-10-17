const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureRendered } = require('../lib/window-rendering');

function fixture(windowState) {
    const calls = [];
    const session = {
        send: async (method, params) => {
            calls.push({ method, params });
            if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'owned-tab' } };
            if (method === 'Browser.getWindowForTarget') return { windowId: 7, bounds: { windowState } };
            assert.equal(method, 'Browser.setWindowBounds');
        },
        detach: async () => calls.push({ method: 'detach' })
    };
    const page = { isClosed: () => false, context: () => ({ newCDPSession: async () => session }) };
    return { page, calls };
}

test('a minimized program window is restored once without bringing a tab to the foreground', async () => {
    const { page, calls } = fixture('minimized');
    let restored = 0;
    const options = { restore: async actual => { assert.equal(actual, page); restored++; return true; } };
    await Promise.all([ensureRendered(page, options), ensureRendered(page, options)]);
    await ensureRendered(page, options);
    assert.equal(calls.filter(call => call.method === 'Target.getTargetInfo').length, 1);
    assert.equal(restored, 1);
    assert.equal(calls.some(call => call.method === 'Browser.setWindowBounds'), false);
    assert.equal(calls.at(-1).method, 'detach');
});

test('normal and maximized windows keep their state and CDP is detached on failure', async () => {
    for (const state of ['normal', 'maximized', 'fullscreen']) {
        const { page, calls } = fixture(state);
        await ensureRendered(page);
        assert.equal(calls.some(call => call.method === 'Browser.setWindowBounds'), false);
    }
    let detached = false;
    const page = { isClosed: () => false, context: () => ({ newCDPSession: async () => ({
        send: async () => { throw Error('Closed during check'); }, detach: async () => { detached = true; }
    }) }) };
    await assert.rejects(ensureRendered(page), /Closed during check/);
    assert.equal(detached, true);
});
