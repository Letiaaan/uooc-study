const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ensureRendered } = require('../lib/window-rendering');

function fixture() {
    const calls = [];
    const sessions = [];
    const page = Object.assign(new EventEmitter(), { isClosed: () => false, context: () => ({ newCDPSession: async () => {
        const session = Object.assign(new EventEmitter(), {
            send: async (method, params) => calls.push({ method, params }),
            detach: async () => { calls.push({ method: 'detach' }); session.emit('close'); }
        });
        sessions.push(session);
        return session;
    } }) });
    return { page, calls, sessions };
}

test('rendering stays attached once per page without changing native window state', async () => {
    const { page, calls, sessions } = fixture();
    await Promise.all([ensureRendered(page), ensureRendered(page)]);
    await ensureRendered(page);
    assert.equal(sessions.length, 1);
    assert.deepEqual(calls, [{ method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } }]);
    page.emit('close');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1).method, 'detach');
    assert.equal(page.listenerCount('close'), 0);
});

test('a disconnected rendering session is recreated; failures detach and allow retry', async () => {
    const { page, calls, sessions } = fixture();
    await ensureRendered(page);
    sessions[0].emit('close');
    await ensureRendered(page);
    assert.equal(sessions.length, 2);
    assert.equal(calls.filter(call => call.method === 'Emulation.setFocusEmulationEnabled').length, 2);
    let detached = 0, attempts = 0;
    const failing = { isClosed: () => false, context: () => ({ newCDPSession: async () => ({
        send: async () => { attempts++; throw Error('unsupported'); }, detach: async () => { detached++; }
    }) }) };
    for (let i = 0; i < 2; i++) await assert.rejects(ensureRendered(failing), /手动取消最小化/);
    assert.equal(detached, 2);
    assert.equal(attempts, 2);
    page.emit('close');
});
