const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AppController } = require('../lib/controller');
const { createGuiServer } = require('../lib/gui');
const { buildPrompt, parseAnswers } = require('../lib/answer-format');
const { testConnection } = require('../lib/model');
const { Control } = require('../lib/control');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const questions = [
    { number: 1, text: '示例单选题', kind: 'single', blanks: 0, options: [{ letter: 'A', text: '选项甲' }, { letter: 'B', text: '选项乙' }] },
    { number: 2, text: '示例多选题', kind: 'multiple', blanks: 0, options: [{ letter: 'A', text: '甲' }, { letter: 'B', text: '乙' }] }
];
const config = { username: '', password: 'sample-password', key: 'sample-key', model: 'deepseek-chat', endpoint: 'https://api.deepseek.com', browser: 'auto', provider: 'api' };

test('persistent diagnostics redact credentials including previously configured secrets', t => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-log-'));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const logFile = path.join(folder, 'runtime.log');
    const app = new AppController({ config, logFile });
    app.save({ password: 'updated-password' });
    app.log('sample-password sample-key updated-password', 'error');
    const line = fs.readFileSync(logFile, 'utf8');
    assert.ok(!/sample-password|sample-key|updated-password/.test(line));
    assert.equal(JSON.parse(line).text, '[已隐藏] [已隐藏] [已隐藏]');
});

function fakeWorker() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.sent = [];
    child.send = message => child.sent.push(message);
    child.disconnect = () => queueMicrotask(() => child.emit('exit', 0));
    child.kill = () => child.emit('exit', 1);
    return child;
}

test('web answers accept JSON and numbered choices, reject incomplete or mismatched output', () => {
    assert.match(buildPrompt(questions), /只输出题号和答案/);
    assert.match(buildPrompt(questions), /示例多选题/);
    assert.deepEqual(parseAnswers('1.A\n2.A、B', questions), [['A'], ['A', 'B']]);
    assert.deepEqual(parseAnswers('```json\n{"answers":[{"number":2,"values":["B"]},{"number":1,"values":["A"]}]}\n```', questions), [['A'], ['B']]);
    for (const text of ['1.A', '1.A\n2.C', '1.A\n1.B', '答案是 A 和 B']) assert.throws(() => parseAnswers(text, questions));
    assert.deepEqual(parseAnswers('1.["文字答案"]', [{ ...questions[0], kind: 'text', options: [], blanks: 1 }]), [['文字答案']]);
});

test('controller keeps secrets out of snapshots and logs, locks concurrent work, and validates returned answers', async () => {
    const child = fakeWorker();
    const controller = new AppController({ config, createWorker: () => child });
    const snapshot = JSON.stringify(controller.snapshot());
    assert.equal(snapshot.includes(config.password), false);
    assert.equal(snapshot.includes(config.key), false);
    controller.log(`hidden ${config.password} ${config.key}`);
    assert.equal(controller.state.logs[0].text.includes(config.password), false);
    controller.command('connect');
    assert.equal(child.sent[0].type, 'connect');
    assert.throws(() => controller.command('connect'), /尚未结束/);
    child.emit('message', { type: 'state', value: { busy: false, connected: true, courses: [{ id: '1', title: '示例课程' }] } });
    assert.throws(() => controller.command('run', { ids: ['2'], mode: 'video' }), /勾选/);
    controller.command('run', { ids: ['1'], mode: 'quiz' });
    child.emit('message', { type: 'pending', value: { id: 'paper', questions, count: 2, prompt: buildPrompt(questions) } });
    assert.throws(() => controller.answer('1.A', 'paper'), /数量/);
    assert.ok(controller.state.pending);
    controller.answer('1.A\n2.B', 'paper');
    assert.equal(child.sent.at(-1).type, 'answer');
    child.emit('message', { type: 'pending', value: null });
    assert.equal(controller.state.pending, null);
    await controller.close();
});

test('GUI server requires local authorization, rejects foreign origins, and tests API only on explicit action', async t => {
    const controller = new AppController({ config });
    let calls = 0;
    const app = await createGuiServer({ controller, token: 'test-token', testAPI: async actual => {
        calls++;
        assert.equal(actual.key, config.key);
        return { message: '本地样例回复', latency: 1 };
    } });
    t.after(() => new Promise(resolve => app.server.close(resolve)));
    const origin = new URL(app.url).origin;
    assert.equal((await fetch(`${origin}/api/state`)).status, 401);
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${origin}/api/state`, { headers: { ...headers, Origin: 'https://example.org' } })).status, 403);
    const state = await (await fetch(`${origin}/api/state`, { headers })).json();
    assert.equal(state.settings.hasKey, true);
    assert.equal('key' in state.settings, false);
    assert.equal(calls, 0);
    const html = await (await fetch(origin)).text();
    assert.match(html, /课程与任务/);
    assert.match(html, /跟随系统/);
    const tested = await fetch(`${origin}/api/test-api`, { method: 'POST', headers, body: '{}' });
    assert.equal(tested.status, 200);
    assert.equal(calls, 1);
    const webTest = await fetch(`${origin}/api/test-api`, { method: 'POST', headers, body: JSON.stringify({ provider: 'web' }) });
    assert.equal(webTest.status, 400);
    assert.equal(calls, 1);
    const badSettings = await fetch(`${origin}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ browser: 'invalid' }) });
    assert.equal(badSettings.status, 400);
    assert.equal(calls, 1);
});

test('connection test makes one small model request and does not expose key on failure', async () => {
    let calls = 0;
    const result = await testConnection(config, async (url, options) => {
        calls++;
        assert.equal(url, 'https://api.deepseek.com/chat/completions');
        assert.equal(JSON.parse(options.body).max_tokens, 16);
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) };
    });
    assert.equal(calls, 1);
    assert.match(result.message, /连接成功/);
    await assert.rejects(testConnection({ ...config, key: '' }, () => assert.fail('Missing key must not issue request')), /请填写/);
    await assert.rejects(testConnection(config, async () => ({ ok: false, status: 401 })), /HTTP 401/);
});

test('live answer settings are applied while account changes stay guarded and API preview stays separate', async () => {
    const child = fakeWorker();
    const controller = new AppController({ config, createWorker: () => child });
    controller.worker();
    Object.assign(controller.state, { busy: true, operation: 'run', connected: true, answer: { id: 'paper' } });
    const result = controller.save({ provider: 'web', webPlatform: 'qianwen', webLogin: 'guest', webAutomation: 'manual' });
    assert.match(result.effect, /当前测验/);
    assert.equal(child.sent.at(-1).type, 'configure');
    assert.throws(() => controller.save({ username: 'different' }), /停止任务/);
    assert.throws(() => controller.save({ browser: 'msedge' }), /停止任务/);
    const draft = controller.preview({ provider: 'api', key: 'new-test-key', model: 'candidate' });
    assert.equal(draft.model, 'candidate');
    assert.equal(controller.config.model, 'deepseek-chat');
    assert.equal(controller.config.key, 'sample-key');
    controller.save({ key: 'new-test-key' });
    controller.log('sample-key new-test-key');
    assert.equal(controller.state.logs.at(-1).text, '[已隐藏] [已隐藏]');
    controller.command('web-connect');
    assert.equal(child.sent.at(-1).type, 'web-connect');
    assert.equal(controller.state.busy, true);
    assert.throws(() => controller.command('web-connect'), /正在连接/);
    controller.command('pause');
    assert.equal(child.sent.at(-1).type, 'pause');
    controller.command('stop');
    assert.throws(() => controller.save({ provider: 'api' }), /正在停止/);
    await controller.close();
});

test('pause holds a checkpoint until resumed and stop aborts waiting work', async () => {
    const control = new Control();
    control.pause();
    let advanced = false;
    const waiting = control.checkpoint().then(() => { advanced = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(advanced, false);
    control.resume();
    await waiting;
    assert.equal(advanced, true);
    assert.ok(control.waited >= 0);
    control.stop();
    await assert.rejects(control.checkpoint(), error => error.code === 'STOPPED');
    assert.equal(control.abort.signal.aborted, true);
});
