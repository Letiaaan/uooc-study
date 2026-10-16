const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
process.env.UOOC_STUDY_HOME = path.join(__dirname, '..', '.build', 'runner-fixture');
const { CourseSite } = require('../lib/site');
const { Journal } = require('../lib/journal');
const { runCourse } = require('../lib/runner');

const units = [{ chapter: '10', section: '11', title: '第一章 / 课后作业' },
    { chapter: '20', section: '21', title: '第二章 / 课后作业' }];

function fixture(t, gated = false) {
    const events = [];
    const course = { id: randomUUID(), title: '示例课程' };
    let unlocked = false;
    const source = unit => ({ id: `${unit.section}0`, title: unit.title, unit, type: 'quiz', finished: false });
    const page = Object.assign(new EventEmitter(), { isClosed: () => false, locator: () => ({ evaluateAll: async () => {} }) });
    t.mock.method(CourseSite.prototype, 'open', async () => units);
    t.mock.method(CourseSite.prototype, 'visit', async unit => {
        events.push(`visit:${unit.section}`);
        return gated && unit === units[1] && !unlocked ? { sources: [], reason: '请先完成前置测验' } : { sources: [source(unit)] };
    });
    t.mock.method(CourseSite.prototype, 'openResource', async resource => {
        events.push(`open:${resource.unit.section}`);
        return { page: { isClosed: () => false, section: resource.unit.section, close: async () => { events.push(`close:${resource.unit.section}`); } }, popup: true };
    });
    t.mock.method(CourseSite.prototype, 'refreshUnit', async unit => ({ sources: [{ ...source(unit), finished: true }] }));
    const handleQuiz = async (quiz, beforeSubmit) => {
        events.push(`solve:${quiz.section}`);
        beforeSubmit(); unlocked = true;
        return '已提交待网站确认';
    };
    return { page, course, events, handleQuiz };
}

test('quiz mode opens each discovered homework before scanning the next section and follows chapter order', async t => {
    const { page, course, events, handleQuiz } = fixture(t);
    new Journal(course).record({ id: 'old-video', title: '示例视频', unit: units[1] }, '播放中');
    const rows = await runCourse(page, course, 'quiz', { handleQuiz });
    assert.deepEqual(events, ['visit:11', 'open:11', 'solve:11', 'close:11', 'visit:21', 'open:21', 'solve:21', 'close:21']);
    assert.equal(rows.filter(row => row.status === '网站确认完成').length, 2);
});

test('video mode collects quizzes and resolves them after a later section is gated', async t => {
    const { page, course, events, handleQuiz } = fixture(t, true);
    await runCourse(page, course, 'video', { handleQuiz });
    assert.deepEqual(events, ['visit:11', 'visit:21', 'open:11', 'solve:11', 'close:11', 'visit:21']);
});

test('cleanup notification requires pass or refreshed website completion, never mere submission or explicit failure', async t => {
    const { page, course, handleQuiz } = fixture(t);
    const passes = [];
    t.mock.method(CourseSite.prototype, 'refreshUnit', async () => ({ sources: [] }));
    await runCourse(page, course, 'quiz', { handleQuiz, onQuizPassed: key => passes.push(key) });
    assert.deepEqual(passes, []);
    await runCourse(page, course, 'quiz', { handleQuiz: async () => '页面确认通过', onQuizPassed: key => passes.push(key) });
    assert.equal(passes.length, 2);
    passes.length = 0;
    t.mock.method(CourseSite.prototype, 'refreshUnit', async unit => ({ sources: [{ id: `${unit.section}0`, finished: true }] }));
    await runCourse(page, course, 'quiz', { handleQuiz: async () => '未通过', onQuizPassed: key => passes.push(key) });
    assert.deepEqual(passes, []);
});

test('single quiz acceptance mode stops after one attempted paper', async t => {
    const { page, course, events, handleQuiz } = fixture(t);
    let attempts = 0;
    await runCourse(page, course, 'quiz', { handleQuiz, quizLimit: 1, onQuizAttempt: () => attempts++ });
    assert.equal(attempts, 1);
    assert.deepEqual(events, ['visit:11', 'open:11', 'solve:11', 'close:11']);
});

test('an acknowledged pass remains a pass when directory refresh fails', async t => {
    const { page, course } = fixture(t);
    t.mock.method(CourseSite.prototype, 'refreshUnit', async () => { throw new Error('refresh failed'); });
    const rows = await runCourse(page, course, 'quiz', { handleQuiz: async () => '页面确认通过', quizLimit: 1 });
    assert.equal(rows[0].status, '页面确认通过');
});

test('question extraction failure retains the real quiz page and reports where to inspect it', async t => {
    const { page, course, events } = fixture(t);
    const notices = [];
    const rows = await runCourse(page, course, 'quiz', { quizLimit: 1,
        handleQuiz: async () => { throw new Error('需要核对题目图片'); }, onVerify: (notice, tab) => notices.push({ notice, tab }) });
    assert.equal(rows[0].status, '测验待处理');
    assert.equal(events.some(event => event.startsWith('close:')), false);
    assert.equal(notices.at(-1).notice.kind, 'quiz-review');
    assert.equal(notices.at(-1).tab.section, '11');
});
