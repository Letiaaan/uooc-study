const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { saveAnswer, removeAnswer } = require('../lib/answer-store');
const { AnswerRouter } = require('../lib/answer-router');
const { Control } = require('../lib/control');
const questions = [{ number: 1, text: '样例', kind: 'single', options: [{ letter: 'A' }] }];

test('passing one quiz removes only its registered answers, retaining another pending quiz', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-cleanup-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const records = [];
    const router = new AnswerRouter({ config: () => ({ provider: 'web', webAutomation: 'manual' }),
        chat: { close: async () => {} }, storeAnswer: (text, paper, info) => {
            const result = saveAnswer(text, paper, { ...info, directory }); records.push(result); return result;
        } });
    for (const key of ['first', 'second']) {
        const result = router.solve(questions, new Control(), key);
        router.paste('1.A', router.pending.id); await result;
    }
    assert.ok(records.every(record => fs.existsSync(record.file)));
    router.passed('first');
    assert.equal(fs.existsSync(path.dirname(records[0].file)), false);
    assert.equal(fs.existsSync(records[1].file), true);
    router.passed('first'); // Idempotent, no wider directory sweep.
    await router.close();
    assert.equal(fs.existsSync(records[1].file), true);
});

test('cleanup rejects paths outside the answer root, mismatched ids and added user files', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-cleanup-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const saved = saveAnswer('1.A', questions, { directory, id: 'owned' });
    assert.throws(() => removeAnswer(saved.file, 'owned', { directory: path.join(directory, 'wrong') }), /指定目录/);
    assert.throws(() => removeAnswer(saved.file, 'other', { directory }), /标识不匹配/);
    fs.writeFileSync(path.join(path.dirname(saved.file), 'notes.txt'), 'user data');
    assert.throws(saved.cleanup, /其他文件/);
    assert.equal(fs.existsSync(saved.file), true);
});
