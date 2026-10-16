const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebChat, completeReply } = require('../lib/web-chat');
const { saveAnswer } = require('../lib/answer-store');
const { buildPrompt, parseAnswers, formatAnswers } = require('../lib/answer-format');
const { Control } = require('../lib/control');
const { AppController } = require('../lib/controller');
const { inspectReadiness } = require('../lib/chat-ready');
const { dismissDoubaoPromotion } = require('../lib/chat-promotions');

const questions = [{ number: 4, text: '样例问题', kind: 'single', blanks: 0,
    options: [{ letter: 'A', text: '甲' }, { letter: 'B', text: '乙' }] }];
const config = { browser: 'auto', webPlatform: 'doubao', webLogin: 'guest' };

function fixture({ uncertain = false, noReply = false, refusal = false, pause, navigationReads = [], sendNavigation = false, readiness = [] } = {}) {
    const calls = { sends: 0, newChats: 0, profiles: [], closes: 0, reads: 0 };
    const pages = [];
    function newPage() {
        let text = '', sent = false, closed = false;
        const locator = {
            first() { return this; }, filter() { return this; }, waitFor: async () => {},
            isVisible: async () => true, isEnabled: async () => true, getAttribute: async () => null,
            innerText: async () => text, inputValue: async () => text, evaluate: async () => text,
            fill: async value => { text = value; },
            click: async () => { calls.sends++; sent = true; text = ''; if (uncertain) throw new Error('发送结果待确认');
                if (sendNavigation) throw new Error('Execution context was destroyed, most likely because of a navigation'); }
        };
        const page = {
            isClosed: () => closed, close: async () => { closed = true; }, setDefaultTimeout() {},
            addLocatorHandler: async () => {},
            locator: selector => selector.includes('send') ? locator : locator,
            getByRole: () => ({ first() { return this; }, isVisible: async () => true,
                waitFor: async () => {}, click: async () => { calls.newChats++; text = ''; sent = false; } }),
            evaluate: async fn => {
                if (fn === dismissDoubaoPromotion) return false;
                if (fn === inspectReadiness) return readiness.shift() || { ready: true, kind: 'ready' };
                if (navigationReads.includes(++calls.reads)) throw new Error('Execution context was destroyed, most likely because of a navigation');
                return { candidates: sent && !noReply ? ['4.B'] : [], copies: sent ? 1 : 0, streaming: false, blocked: false,
                    refusal: sent && refusal ? '你好，我无法回答这个问题，我们换一个话题聊聊吧。' : undefined };
            }
        };
        pages.push(page);
        return page;
    }
    const context = { pages: () => pages, newPage: async () => newPage(), close: async () => { calls.closes++; for (const page of pages) await page.close(); } };
    const web = new WebChat({ open: async options => { calls.profiles.push(options.profileName); return context; },
        go: async () => {}, pause: pause || (async () => {}) });
    return { web, calls };
}

test('web chat automatically sends and reads each quiz in a fresh conversation without approval clicks', async () => {
    const { web, calls } = fixture();
    const task = { id: 'quiz-1', prompt: buildPrompt(questions), questions, config, control: new Control() };
    assert.equal(await web.answer(task), '4.B');
    assert.equal(calls.sends, 1);
    assert.match(calls.profiles[0], /^ai-profiles\/doubao\/guest-/);
    assert.equal(await web.answer({ ...task, id: 'quiz-2' }), '4.B');
    assert.equal(calls.newChats, 2);
    assert.equal(calls.sends, 2);
    await web.close();
});

test('Qianwen requires its persistent login profile even when an older config still says guest', async () => {
    const { web, calls } = fixture();
    await web.connect({ ...config, webPlatform: 'qianwen', webLogin: 'guest' });
    assert.equal(calls.profiles[0], 'ai-profiles/qianwen/account');
    assert.equal(web.sessionConfig.webLogin, 'login');
    await web.connect({ ...config, webPlatform: 'qianwen', webLogin: 'login' });
    assert.equal(calls.profiles.length, 1, 'The same account session is reused');
    await web.close();
});

test('login, verification and consent pause sending then automatically resume when official UI is ready', async () => {
    const readiness = ['login', 'verification', 'consent'].map(kind => ({ ready: false, kind, note: kind }));
    let waiting = 0;
    const { web, calls } = fixture({ readiness, pause: async () => {
        if (waiting++ < 3) assert.equal(calls.sends, 0);
    } });
    const task = { id: 'login', prompt: buildPrompt(questions), questions, config, control: new Control() };
    assert.equal(await web.answer(task), '4.B');
    assert.equal(calls.sends, 1);
    await web.close();
});

test('required login opens the official entry once and waits before sending the quiz', async () => {
    const readiness = [
        { ready: false, kind: 'login', openLogin: true, note: 'login' },
        { ready: false, kind: 'login', openLogin: true, note: 'login' },
        { ready: false, kind: 'consent', note: 'consent' }
    ];
    const { web, calls } = fixture({ readiness, pause: async () => {
        if (readiness.length) {
            assert.equal(calls.sends, 0);
            assert.equal(calls.newChats, 1, 'Only the login entry has been clicked');
        }
    } });
    assert.equal(await web.answer({ id: 'required-login', prompt: buildPrompt(questions), questions,
        config: { ...config, webLogin: 'login' }, control: new Control() }), '4.B');
    assert.equal(calls.newChats, 2, 'One login entry and one new conversation');
    assert.equal(calls.sends, 1);
    await web.close();
});

test('manual retry cannot bypass a blocking official prompt and stop cancels readiness polling', async () => {
    const control = new Control();
    const { web, calls } = fixture({ readiness: [{ ready: false, kind: 'consent', note: 'official prompt' }],
        pause: async () => control.stop() });
    web.approve();
    await assert.rejects(web.answer({ id: 'stop-before-send', prompt: buildPrompt(questions), questions, config, control }), /已停止/);
    assert.equal(calls.sends, 0);
    await web.close();
});

test('uncertain send is read again without sending the same quiz twice', async () => {
    const { web, calls } = fixture({ uncertain: true });
    await web.connect(config); web.approve();
    const task = { id: 'uncertain', prompt: buildPrompt(questions), questions, config, control: new Control() };
    await assert.rejects(web.answer(task), /发送结果/);
    assert.equal(await web.answer(task), '4.B');
    assert.equal(calls.sends, 1);
    await web.close();
});

test('an explicit service refusal stops immediately without waiting for or resending answers', async () => {
    const { web, calls } = fixture({ refusal: true });
    await assert.rejects(web.answer({ id: 'refused', prompt: buildPrompt(questions), questions, config, control: new Control() }), /未提供答案/);
    assert.equal(calls.sends, 1);
    await web.close();
});

test('navigation during new-chat inspection, sending and reply reading recovers without resending', async () => {
    const { web, calls } = fixture({ navigationReads: [1, 2, 6, 7], sendNavigation: true });
    await web.connect(config); web.approve();
    assert.equal(await web.answer({ id: 'redirects', prompt: buildPrompt(questions), questions, config, control: new Control() }), '4.B');
    assert.equal(calls.sends, 1);
    assert.equal(calls.newChats, 1);
    assert.ok(calls.reads >= 11);
    await web.close();
});

test('a closed previously sent conversation cannot cause another send for the same quiz', async () => {
    const { web, calls } = fixture();
    await web.connect(config); web.approve();
    const task = { id: 'closed', prompt: buildPrompt(questions), questions, config, control: new Control() };
    await web.answer(task);
    await web.page.close();
    await assert.rejects(web.answer(task), /避免重复发送/);
    assert.equal(calls.sends, 1);
    await web.close();
});

test('streaming, incomplete and conflicting replies are kept pending; stop aborts waiting', async () => {
    const ready = { candidates: ['4.B'], copies: 1, streaming: false, blocked: false };
    assert.equal(completeReply(ready, questions), '4.B');
    assert.equal(completeReply({ ...ready, copies: 0, assistantCandidates: ['4.B'] }, questions), '4.B');
    assert.equal(completeReply({ ...ready, copies: 0, assistantCandidates: ['4.B'], streaming: true }, questions), null);
    for (const change of [{ streaming: true }, { blocked: true }, { copies: 0 }, { candidates: ['4.?'] }, { candidates: ['4.A', '4.B'] }]) {
        assert.equal(completeReply({ ...ready, ...change }, questions), null);
    }
    const control = new Control();
    const { web } = fixture({ noReply: true, pause: async () => control.stop() });
    await web.connect(config); web.approve();
    await assert.rejects(web.answer({ id: 'stop', prompt: buildPrompt(questions), questions, config, control }), /已停止/);
    await web.close();
});

test('answer files keep each quiz separate and round-trip text and multi-blank answers', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-answers-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const paper = [...questions, { number: 7, text: '两个空', kind: 'text', blanks: 2, options: [] }];
    const reply = '4.B\n7.["甲\\n乙","丙"]';
    const first = saveAnswer(reply, paper, { directory, id: 'first', platform: 'doubao' });
    const second = saveAnswer('4.A\n7.["丁","戊"]', paper, { directory, id: 'second', platform: 'qianwen' });
    assert.notEqual(first.file, second.file);
    assert.deepEqual(first.answers, [['B'], ['甲\n乙', '丙']]);
    assert.equal(fs.readFileSync(first.file, 'utf8'), formatAnswers(paper, first.answers));
    assert.deepEqual(parseAnswers(fs.readFileSync(second.file, 'utf8'), paper), [['A'], ['丁', '戊']]);
    assert.throws(() => saveAnswer('4.B', paper, { directory }), /数量/);
    assert.throws(() => saveAnswer('4.B\n7.["?","戊"]', paper, { directory }), /未作答/);
    assert.equal(fs.readdirSync(directory).length, 2);
});

test('web settings are validated separately and API credentials survive switching providers', () => {
    const app = new AppController({ config: { provider: 'api', key: 'test-key', model: 'deepseek-chat' } });
    const result = app.save({ provider: 'web', webPlatform: 'deepseek', webLogin: 'login', webAutomation: 'auto' });
    assert.equal(result.webPlatform, 'deepseek');
    assert.equal(app.config.key, 'test-key');
    assert.equal('key' in result, false);
    assert.throws(() => app.save({ webPlatform: 'other' }), /平台/);
    assert.throws(() => app.save({ webLogin: 'other' }), /登录/);
    assert.throws(() => app.save({ webAutomation: 'other' }), /操作方式/);
});
