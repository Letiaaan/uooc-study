const test = require('node:test');
const assert = require('node:assert/strict');
const { solvePaper } = require('../lib/quiz');

const question = (number, skipImage = false, kind = 'single') => ({ number, skipImage, kind, options: kind === 'text' ? [] : [{ letter: 'A' }, { letter: 'B' }] });

test('image choices use A while AI sees only original numbered text questions and replies merge in order', async () => {
    const paper = [question(1), question(2, true), question(3), question(4, true, 'text')];
    let calls = 0;
    const answers = await solvePaper(paper, async questions => {
        calls++;
        assert.deepEqual(questions.map(item => item.number), [1, 3]);
        return [['B'], ['A']];
    });
    assert.deepEqual(answers, [['B'], ['A'], ['A'], []]);
    assert.equal(calls, 1);
});

test('an all-image paper makes no AI request; incomplete text replies cannot shift answer positions', async () => {
    assert.deepEqual(await solvePaper([question(1, true)], () => assert.fail('No text questions')), [['A']]);
    await assert.rejects(solvePaper([question(1), question(2, true), question(3)], async () => [['A']]), /数量不完整/);
});
