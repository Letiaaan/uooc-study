const test = require('node:test');
const assert = require('node:assert/strict');
const { SimpleVerification, inspectCheckbox } = require('../lib/verification');

function widget({ text = '点击复选框开始智能验证', visible = true, click = async () => {} } = {}) {
    return { isVisible: async () => visible, evaluate: async fn => fn({ innerText: text }),
        locator: selector => { assert.equal(selector, '#aliyunCaptcha-checkbox-icon'); return { isVisible: async () => true, click }; } };
}
const pageWith = roots => ({ frames: () => [{ locator: selector => {
    assert.equal(selector, '#aliyunCaptcha-checkbox-wrapper'); return { all: async () => roots };
} }] });

test('simple verification clicks only the known visible icon once, without claiming success', async () => {
    let clicks = 0;
    const verification = new SimpleVerification();
    const page = pageWith([widget({ click: async () => { clicks++; } })]);
    assert.equal(await verification.step(page), 'checking');
    assert.equal(clicks, 0, 'A newly mounted widget is allowed to settle');
    assert.equal(await verification.step(page), 'clicked');
    assert.equal(await verification.step(page), 'manual');
    assert.equal(clicks, 1);
});

test('failed, completed, hidden and ambiguous widgets never trigger another click', async () => {
    const click = async () => assert.fail('No checkbox action expected');
    for (const [text, expected] of [['验证通过!', 'verified'], ['验证失败，请重试', 'manual'], ['验证中', 'checking']]) {
        assert.equal(await new SimpleVerification().step(pageWith([widget({ text, click })])), expected);
    }
    assert.equal(await new SimpleVerification().step(pageWith([widget({ visible: false, click })])), 'unavailable');
    assert.equal(await new SimpleVerification().step(pageWith([widget({ click }), widget({ click })])), 'unavailable');
    const verification = new SimpleVerification();
    assert.equal(await verification.step(pageWith([])), 'unavailable');
    let clicks = 0;
    const latePage = pageWith([widget({ click: async () => { clicks++; } })]);
    assert.equal(await verification.step(latePage), 'checking');
    assert.equal(await verification.step(latePage), 'clicked');
    assert.equal(clicks, 1, 'A widget loading late may be tried');
});

test('an uncertain checkbox click is not retried and a visible image challenge is left to the user', async () => {
    let clicks = 0;
    const verification = new SimpleVerification();
    const page = pageWith([widget({ click: async () => { clicks++; throw new Error('Navigation during click'); } })]);
    assert.equal(await verification.step(page), 'checking');
    assert.equal(await verification.step(page), 'manual');
    assert.equal(await verification.step(page), 'manual');
    assert.equal(clicks, 1);
    assert.equal(inspectCheckbox({ innerText: '点击复选框开始智能验证', ownerDocument: {
        getElementById: () => ({ getClientRects: () => [{}] })
    } }), 'manual');
});
