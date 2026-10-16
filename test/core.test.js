const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { optionSets } = require('../lib/media');
const { validateAnswers, solveQuestions } = require('../lib/model');
const { flattenCatalog, normalizeSource, CourseSite } = require('../lib/site');
const { orderUnits } = require('../lib/runner');
const { chooseCourses, credentials } = require('../lib/console');
const { resultOnPage } = require('../lib/quiz');

test('single choice tries four distinct options; multiple choice covers each nonempty set once', () => {
    assert.deepEqual([...optionSets(4, false)], [[0], [1], [2], [3]]);
    const groups = [...optionSets(4, true)].map(group => group.join(','));
    assert.equal(groups.length, 15);
    assert.equal(new Set(groups).size, 15);
});

test('catalog retains section and knowledge point identity', () => {
    const units = flattenCatalog([{ id: 1, name: '章', children: [{ id: 2, name: '节', children: [{ id: 3, name: '知识点' }] }] }]);
    assert.deepEqual(units, [{ chapter: '1', section: '2', title: '章 / 节' }, { chapter: '1', section: '2', point: '3', title: '章 / 节 / 知识点' }]);
    assert.deepEqual(orderUnits(units, units[1]), [units[1], units[0]]);
    assert.equal(normalizeSource({ type: 10 }).id, '');
    assert.equal(normalizeSource({ id: 4, type: 10, finished: '0', video_pos: '12' }).finished, false);
});

function reply(endpoint, params, body, hostname = 'www.uooc.net.cn') {
    return { url: () => `https://${hostname}/home/learn/${endpoint}?${new URLSearchParams(params)}`,
        ok: () => true, json: async () => body, request: () => ({ postDataJSON: () => null }) };
}

test('observer accepts only matching course responses and actual finished state', async () => {
    const page = new EventEmitter();
    const site = new CourseSite(page, { id: '1' });
    const sources = [{ id: 4, type: 10, finished: 0 }];
    await site.observe(reply('getUnitLearn', { cid: 2, section_id: 2 }, { code: 1, data: sources }));
    await site.observe(reply('getUnitLearn', { cid: 1, section_id: 2 }, { code: 1, data: sources }, 'example.org'));
    assert.equal(site.units.size, 0);
    await site.observe(reply('getUnitLearn', { cid: 1, section_id: 2, subsection_id: 3 }, { code: 1, data: sources }));
    assert.equal(site.units.get('3').sources[0].id, '4');
    assert.equal(site.completions.size, 0);
    await site.observe(reply('markVideoLearn', { cid: 1, resource_id: 4 }, { code: 0, data: { finished: 1 } }));
    assert.equal(site.completions.size, 0);
    await site.observe(reply('markVideoLearn', { cid: 1, resource_id: 4 }, { code: 1, data: { finished: 1 } }));
    assert.equal(site.completions.has('4'), true);
    await site.observe(reply('getUnitLearn', { cid: 1, section_id: 2 }, { code: 1, data: sources }));
    assert.equal(site.completions.has('4'), false);
    site.close();
    assert.equal(page.listenerCount('response'), 0);
});

test('observer parses website form bodies and preserves gated errors', async () => {
    const site = new CourseSite(new EventEmitter(), { id: '1' });
    const response = reply('getUnitLearn', {}, { code: 0, msg: '请先完成测验' });
    response.request = () => ({ postDataJSON: () => ({ cid: '1', section_id: '2' }) });
    await site.observe(response);
    assert.equal(site.units.get('2').reason, '请先完成测验');
    site.close();
});

const questions = [{ number: 1, kind: 'single', blanks: 0, options: [{ letter: 'A' }, { letter: 'B' }] },
    { number: 2, kind: 'text', blanks: 2, options: [] }];
const valid = { answers: [{ number: 2, values: ['一', '二'] }, { number: 1, values: [' A '] }] };
test('model answers are matched by question number and validated before writing', () => {
    assert.deepEqual(validateAnswers(questions, valid), [['A'], ['一', '二']]);
    for (const answers of [[], [{ number: 1, values: ['C'] }], [{ number: 1, values: ['A', 'B'] }],
        [{ number: 1, values: ['A'] }, { number: 1, values: ['B'] }],
        [{ number: 1, values: ['A'] }, { number: 2, values: ['一'] }]]) {
        assert.throws(() => validateAnswers(questions, { answers }));
    }
    assert.throws(() => validateAnswers([{ ...questions[0], kind: 'multiple' }], { answers: [{ number: 1, values: ['A', 'A'] }] }));
});

test('missing key makes no network request; API failure is not retried', async () => {
    let requests = 0;
    const request = async () => { requests++; return { ok: false, status: 401 }; };
    await assert.rejects(solveQuestions(questions, { key: '' }, request), /DEEPSEEK_API_KEY/);
    assert.equal(requests, 0);
    await assert.rejects(solveQuestions(questions, { key: 'test', endpoint: 'https://example.test' }, request), /HTTP 401/);
    assert.equal(requests, 1);
});

test('one model request contains the whole paper and uses JSON answers', async () => {
    let calls = 0;
    const answers = await solveQuestions(questions, { key: 'test', endpoint: 'https://example.test', model: 'test' }, async (url, options) => {
        calls++;
        assert.equal(url, 'https://example.test/chat/completions');
        const body = JSON.parse(options.body);
        assert.equal(JSON.parse(body.messages[1].content).length, 2);
        assert.equal(body.response_format.type, 'json_object');
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(valid) } }] }) };
    });
    assert.equal(calls, 1);
    assert.deepEqual(answers, [['A'], ['一', '二']]);
});

test('course selection rejects invalid indices and credentials support configured noninteractive use', async () => {
    const courses = [{ id: '1' }, { id: '2' }];
    assert.deepEqual(await chooseCourses(courses, '2,2,1'), [courses[1], courses[0]]);
    await assert.rejects(chooseCourses(courses, '3'), /范围/);
    assert.deepEqual(await credentials({ username: 'test', password: 'example' }), { username: 'test', password: 'example' });
});

test('quiz result remains unknown without explicit website acknowledgement', async () => {
    const page = text => ({ frames: () => [{ locator: () => ({ allTextContents: async () => text }) }] });
    assert.equal(await resultOnPage(page([])), null);
    assert.equal(await resultOnPage(page(['提交成功'])), '已提交待网站确认');
    assert.equal(await resultOnPage(page(['未通过，请重新提交'])), '未通过');
    assert.equal(await resultOnPage(page(['测验通过'])), '页面确认通过');
    assert.equal(await resultOnPage(page(['未通过；测验通过后可继续'])), '未通过');
});
