const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { once } = require('node:events');
const { createGuiServer, startGUI } = require('../lib/gui');
const { claimGuiInstance, workbenchURL } = require('../lib/gui-instance');

const directory = () => {
    const dir = path.resolve('.build', 'gui-instance-test-' + randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};
const controller = () => ({ closed: 0, snapshot: () => ({ version: '0.4.18', settings: {}, courses: [] }), async close() { this.closed++; } });
async function session(app) {
    const abort = new AbortController();
    const response = await fetch(new URL('/api/session', app.url), { headers: { Authorization: `Bearer ${new URL(app.url).hash.slice(7)}` }, signal: abort.signal });
    assert.equal(response.status, 200);
    return { abort: () => abort.abort(), reader: response.body.getReader() };
}

test('the last workbench disconnect exits; refresh and other tabs preserve the service', { timeout: 5000 }, async t => {
    const control = controller();
    const app = await createGuiServer({ controller: control, lifecycle: { grace: 80 } });
    t.after(() => app.close());
    const first = await session(app), second = await session(app);
    first.abort();
    await delay(120);
    assert.equal(control.closed, 0);
    second.abort();
    await delay(25);
    const refreshed = await session(app);
    await delay(120);
    assert.equal(control.closed, 0);
    const ended = once(app.server, 'close');
    refreshed.abort();
    await ended;
    assert.equal(control.closed, 1);
    await app.close();
    assert.equal(control.closed, 1);
});

test('the default last-window exit begins within one second', { timeout: 3000 }, async t => {
    const control = controller(), app = await createGuiServer({ controller: control });
    t.after(() => app.close());
    const tab = await session(app), ended = once(app.server, 'close'), started = Date.now();
    tab.abort();
    await ended;
    assert.ok(Date.now() - started < 1500, 'Last-window close must not retain the previous eight-second delay');
    assert.equal(control.closed, 1);
});

test('a slow refresh reserves the backend until its replacement session connects', { timeout: 3000 }, async t => {
    const control = controller(), app = await createGuiServer({ controller: control, lifecycle: { grace: 50, openingGrace: 500 } });
    t.after(() => app.close());
    const original = await session(app);
    // HTML can arrive before the old document disconnects its stream.
    await (await fetch(app.url)).text();
    original.abort();
    await delay(120);
    assert.equal(control.closed, 0);
    const replacement = await session(app), ended = once(app.server, 'close');
    replacement.abort();
    await ended;
    assert.equal(control.closed, 1);
});

test('immediately relaunching after close reserves the existing service before the browser opens', { timeout: 3000 }, async t => {
    const dir = directory(), control = controller();
    const options = { directory: dir, open: false, create: value => createGuiServer({ ...value, controller: control, lifecycle: { grace: 80, openingGrace: 500 } }) };
    const app = await startGUI(options);
    t.after(() => app.close());
    const original = await session(app);
    original.abort();
    await delay(20);
    assert.equal((await startGUI(options)).reused, true);
    await delay(120);
    assert.equal(control.closed, 0);
    const reopened = await session(app), ended = once(app.server, 'close');
    reopened.abort();
    await ended;
    assert.equal(control.closed, 1);
});

test('relaunch waits for a closing backend and then creates a fresh instance', { timeout: 3000 }, async t => {
    const dir = directory();
    const app = await startGUI({ directory: dir, open: false, create: value => createGuiServer({ ...value, controller: {
        ...controller(), async close() { await delay(120); }
    } }) });
    t.after(() => app.close());
    const closing = app.close();
    const replacement = await startGUI({ directory: dir, open: false, create: value => createGuiServer({ ...value, controller: controller() }) });
    t.after(() => replacement.close());
    await closing;
    assert.notEqual(replacement.url, app.url);
    assert.equal(replacement.reused, undefined);
});

test('activating an already connected workbench does not delay the next close', { timeout: 3000 }, async t => {
    const app = await createGuiServer({ controller: controller(), lifecycle: { grace: 50, openingGrace: 2000 } });
    t.after(() => app.close());
    const tab = await session(app), headers = { Authorization: `Bearer ${new URL(app.url).hash.slice(7)}`, 'Content-Type': 'application/json' };
    await fetch(new URL('/api/activate', app.url), { method: 'POST', headers, body: '{}' });
    const ended = once(app.server, 'close'), started = Date.now();
    tab.abort(); await ended;
    assert.ok(Date.now() - started < 500);
});

test('a duplicate launch reuses the authenticated workbench; shutdown releases its identity', { timeout: 5000 }, async t => {
    const dir = directory(), opened = [];
    let created = 0;
    const options = { directory: dir, openURL: url => opened.push(url), create: opts => {
        created++;
        return createGuiServer({ ...opts, controller: controller() });
    } };
    const app = await startGUI(options);
    t.after(() => app.close());
    const duplicate = await startGUI(options);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.url, app.url);
    assert.equal(created, 1);
    assert.equal(opened.length, 2);
    await app.close();
    assert.equal(fs.existsSync(path.join(dir, 'gui-instance.json')), false);
});

test('simultaneous startup claims one server and stale records recover without killing processes', { timeout: 5000 }, async t => {
    const dir = directory();
    fs.writeFileSync(path.join(dir, 'gui-instance.json'), JSON.stringify({ pid: 2147483647, instance: 'dead', url: 'https://example.org/' }));
    let created = 0;
    const options = { directory: dir, open: false, create: opts => { created++; return createGuiServer({ ...opts, controller: controller() }); } };
    const pair = await Promise.all([startGUI(options), startGUI(options)]);
    const app = pair.find(item => item.server);
    t.after(() => app.close());
    assert.equal(created, 1);
    assert.equal(pair.filter(item => item.reused).length, 1);
    await app.close();
    fs.writeFileSync(path.join(dir, 'gui-instance.json'), '{');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dir, 'gui-instance.json'), old, old);
    const claim = await claimGuiInstance(dir);
    assert.ok(claim.identity);
    claim.release();
});

test('a failed workbench opening closes the new backend and allows the next launch', async () => {
    const dir = directory(), control = controller();
    let first;
    await assert.rejects(startGUI({ directory: dir, openURL: async () => { throw Error('Fixture browser failure'); },
        create: async options => first = await createGuiServer({ ...options, controller: control }) }), /Fixture browser failure/);
    assert.equal(first.server.listening, false);
    assert.equal(control.closed, 1);
    assert.equal(fs.existsSync(path.join(dir, 'gui-instance.json')), false);
    const second = await startGUI({ directory: dir, open: false, create: options => createGuiServer({ ...options, controller: controller() }) });
    await second.close();
});

test('legacy workbenches are reopened from logs and external or malformed URLs are rejected', { timeout: 5000 }, async t => {
    const dir = directory();
    const app = await createGuiServer({ controller: controller() });
    t.after(() => app.close());
    fs.writeFileSync(path.join(dir, 'startup.log'), 'UOOC Study\n' + app.url + '\n');
    const existing = await claimGuiInstance(dir);
    assert.equal(existing.legacy, true);
    assert.equal(existing.existing, app.url);
    assert.equal(fs.existsSync(path.join(dir, 'gui-instance.json')), false);
    for (const value of ['https://example.org/', 'http://127.0.0.1:80/other#token=' + 'a'.repeat(48), 'http://127.0.0.1:80/#token=short', 'http://user:pass@127.0.0.1:80/#token=' + 'a'.repeat(48)]) assert.equal(workbenchURL(value), null);
});
