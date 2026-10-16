const test = require('node:test');
const assert = require('node:assert/strict');
const { AnswerRouter } = require('../lib/answer-router');
const { Control } = require('../lib/control');
const { parseAnswers } = require('../lib/answer-format');

const questions = [{ number: 1, text: '样例', kind: 'single', blanks: 0,
    options: [{ letter: 'A', text: '甲' }, { letter: 'B', text: '乙' }] }];
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(solveAPI, chat = {}) {
    let config = { provider: 'api', key: 'test-key', model: 'deepseek-chat', endpoint: 'https://api.deepseek.com',
        browser: 'auto', webPlatform: 'doubao', webLogin: 'guest', webAutomation: 'manual' };
    const stored = [];
    const router = new AnswerRouter({ config: () => config, solveAPI, chat: { close: async () => {}, ...chat },
        storeAnswer: (text, paper, info) => { stored.push(info); return { file: `fixture/${info.id}`, answers: parseAnswers(text, paper) }; } });
    return { router, stored, change: values => { config = { ...config, ...values }; router.update(); } };
}

test('switching an in-flight API paper to web ignores late API results', async () => {
    let resolveAPI, signal;
    const { router, change, stored } = fixture((paper, config, request, abort) => {
        signal = abort; return new Promise(resolve => { resolveAPI = resolve; });
    });
    let finished = false;
    const result = router.solve(questions, new Control()).then(answers => { finished = true; return answers; });
    await tick();
    change({ provider: 'web' });
    const id = router.pending.id;
    assert.equal(signal.aborted, true);
    resolveAPI([['A']]); await tick();
    assert.equal(finished, false);
    router.paste('1.B', id);
    assert.deepEqual(await result, [['B']]);
    assert.equal(stored.length, 1);
    await router.close();
});

test('changing web platform invalidates pasted replies and can continue the same paper through API', async () => {
    let calls = 0;
    const { router, change } = fixture(async () => { calls++; return [['A']]; });
    change({ provider: 'web' });
    const result = router.solve(questions, new Control());
    const firstId = router.pending.id;
    change({ webPlatform: 'qianwen' });
    assert.notEqual(router.pending.id, firstId);
    assert.throws(() => router.paste('1.B', firstId), /已变化/);
    change({ provider: 'api' });
    assert.deepEqual(await result, [['A']]);
    assert.equal(calls, 1);
    await router.close();
});

test('API settings are captured per request and apply again when the next paper starts', async () => {
    let resolveFirst, firstSignal;
    const models = [];
    const { router, change } = fixture((paper, config, request, signal) => {
        models.push(config.model);
        if (models.length === 1) { firstSignal = signal; return new Promise(resolve => { resolveFirst = resolve; }); }
        return Promise.resolve([['B']]);
    });
    const result = router.solve(questions, new Control()); await tick();
    change({ model: 'updated-model' });
    assert.deepEqual(await result, [['B']]);
    resolveFirst([['A']]); await tick();
    assert.equal(firstSignal.aborted, true);
    assert.deepEqual(await router.solve(questions, new Control()), [['B']]);
    assert.deepEqual(models, ['deepseek-chat', 'updated-model', 'updated-model']);
    await router.close();
});

test('unchanged settings and unrelated API edits do not resend a web paper; stop cancels it', async () => {
    let requests = 0;
    const { router, change } = fixture(() => assert.fail('No API request expected'), {
        answer: async () => { requests++; return null; }
    });
    change({ provider: 'web', webAutomation: 'auto' });
    const control = new Control();
    const result = router.solve(questions, control); await tick();
    const id = router.pending.id;
    change({ key: 'other-key' }); change({ webPlatform: 'doubao' }); await tick();
    assert.equal(router.pending.id, id);
    assert.equal(requests, 1);
    const rejected = assert.rejects(result, /已停止/);
    control.stop(); await rejected;
    assert.equal(router.pending, null);
    await router.close();
});
