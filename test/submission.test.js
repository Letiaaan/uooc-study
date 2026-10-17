const test = require('node:test');
const assert = require('node:assert/strict');
const { finishSubmission, resultOnPage, submissionState } = require('../lib/quiz');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('an enabled final button does not bypass pending verification; success resumes and clicks only once', async () => {
    let verified = false, clicked = 0;
    const notices = [];
    const final = { isVisible: async () => true, evaluate: async () => ({ enabled: true, verificationPending: !verified }),
        click: async () => { assert.equal(verified, true); clicked++; } };
    const frame = { evaluate: async () => false, locator: selector => ({
        allTextContents: async () => clicked ? ['测验已通过'] : [],
        all: async () => selector.startsWith('div.btn') ? [final] : []
    }) };
    const page = { isClosed: () => false, frames: () => [frame], waitForTimeout: async () => { verified = true; } };
    assert.equal(await finishSubmission(page, { onVerify: notice => notices.push(notice) }), '页面确认通过');
    assert.equal(clicked, 1);
    assert.equal(notices.filter(Boolean).length, 0);
    assert.equal(notices.at(-1), null);
});

test('a quiz challenge requests help once and clears the notice after manual verification', async () => {
    let verified = false, clicked = 0;
    const notices = [];
    const root = { isVisible: async () => true, evaluate: async () => verified ? 'verified' : 'manual' };
    const final = { isVisible: async () => true, evaluate: async () => ({ enabled: true, verificationPending: !verified }),
        click: async () => { assert.equal(verified, true); clicked++; } };
    const frame = { evaluate: async () => false, locator: selector => ({
        allTextContents: async () => clicked ? ['测验已通过'] : [],
        all: async () => selector.startsWith('div.btn') ? [final] : selector === '#aliyunCaptcha-checkbox-wrapper' ? [root] : []
    }) };
    const page = { isClosed: () => false, frames: () => [frame], waitForTimeout: async () => { verified = true; } };
    assert.equal(await finishSubmission(page, { onVerify: value => notices.push(value) }), '页面确认通过');
    assert.equal(notices.filter(Boolean).length, 1);
    assert.equal(notices[0].kind, 'quiz');
    assert.equal(notices.at(-1), null);
    assert.equal(clicked, 1);
});

test('verification failure is not a failed quiz, and a graded paper means already submitted', async () => {
    const page = { frames: () => [{ locator: () => ({ allTextContents: async () => ['智能验证未通过，请重试'] }), evaluate: async () => false }] };
    assert.equal(await resultOnPage(page), null);
    page.frames = () => [{ locator: () => ({ allTextContents: async () => [] }), evaluate: async () => true }];
    assert.equal(await resultOnPage(page), '已提交待网站确认');
});

test('verification can submit automatically without clicking a stale confirmation button', async () => {
    let passed = false, checkboxClicks = 0, finalClicks = 0;
    const root = { isVisible: async () => !passed, evaluate: async () => 'ready', locator: () => ({
        isVisible: async () => true, click: async () => { checkboxClicks++; passed = true; }
    }) };
    const final = { isVisible: async () => !passed,
        evaluate: async () => assert.fail('Old dialog must not be inspected after callback submission'),
        click: async () => { finalClicks++; } };
    const frame = { evaluate: async () => false, locator: selector => ({
        allTextContents: async () => passed ? ['测验已通过'] : [],
        all: async () => selector.startsWith('div.btn') ? [final] : selector === '#aliyunCaptcha-checkbox-wrapper' ? [root] : []
    }) };
    const page = { isClosed: () => false, frames: () => [frame], waitForTimeout: async () => {} };
    assert.equal(await finishSubmission(page), '页面确认通过');
    assert.equal(checkboxClicks, 1);
    assert.equal(finalClicks, 0);
});

test('a success label cannot enable final submission before the website callback is ready', () => {
    const scope = { vcode_params: {} };
    let disabled = false;
    const node = { disabled: false, classList: { contains: () => false },
        closest: () => ({ innerText: '确定要提交吗？验证通过!' }),
        getAttribute: name => name === 'ng-disabled' ? '!vcode_params.captchaVerifyParam' : null,
        hasAttribute: name => name === 'disabled' && disabled };
    const read = () => vm.runInNewContext(`(${submissionState.toString()})(node)`, { node, window: { angular: { element: () => ({ scope: () => scope }) } } });
    assert.equal(read().verificationPending, true);
    scope.vcode_params.captchaVerifyParam = 'fixture';
    assert.equal(read().verificationPending, false);
    assert.equal(read().enabled, true);
    disabled = true;
    assert.equal(read().enabled, false);
});

test('a business rejection over HTTP 200 reports the website reason and releases its observer', async () => {
    const page = new EventEmitter();
    const final = { isVisible: async () => true, evaluate: async () => ({ enabled: true, verificationPending: false }),
        click: async () => page.emit('response', { url: () => 'https://www.uooc.net.cn/exam/commit', request: () => ({ method: () => 'POST' }),
            json: async () => ({ code: 0, msg: '验证结果已过期' }) }) };
    page.frames = () => [{ evaluate: async () => false, locator: selector => ({ allTextContents: async () => [],
        all: async () => selector.startsWith('div.btn') ? [final] : [] }) }];
    page.isClosed = () => false;
    page.waitForTimeout = () => new Promise(resolve => setImmediate(resolve));
    await assert.rejects(finishSubmission(page), /网站拒绝交卷.*验证结果已过期/);
    assert.equal(page.listenerCount('response'), 0);
});
