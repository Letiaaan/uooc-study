const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { dismissDoubaoPromotion } = require('../lib/chat-promotions');

function fixture(markup) {
    const { document } = parseHTML(`<html><body>${markup}</body></html>`);
    const clicks = [];
    for (const node of document.querySelectorAll('*')) {
        node.getClientRects = () => node.closest('[hidden]') ? [] : [{}];
        node.addEventListener('click', () => clicks.push(node.id));
    }
    return { clicks, dismiss: () => vm.runInNewContext(`(${dismissDoubaoPromotion.toString()})()`, { document }) };
}

test('a desktop promotion closes with its labelled X without activating its download button', () => {
    const page = fixture('<div role="dialog">下载豆包电脑版 解锁本地任务能力<button id="download">立即下载</button><button id="close" aria-label="关闭"></button></div>');
    assert.equal(page.dismiss(), true);
    assert.equal(page.clicks[0], 'close');
    assert.ok(!page.clicks.includes('download'));
});

test('login, consent, verification, hidden promotions and unrelated dialogs are left intact', () => {
    for (const notice of ['登录', '用户协议', '隐私政策', '请完成智能验证', 'Log in']) {
        const page = fixture(`<div role="dialog">下载豆包电脑版 ${notice}<button id="close" aria-label="关闭"></button></div>`);
        assert.equal(page.dismiss(), false);
        assert.equal(page.clicks.length, 0);
    }
    for (const markup of ['<div role="dialog" hidden>下载豆包电脑版<button aria-label="关闭"></button></div>',
        '<div role="dialog">下载豆包电脑版<button>立即下载</button></div>',
        '<div role="dialog">其他公告<button aria-label="关闭"></button></div>',
        '<div role="dialog">下载豆包电脑版<button aria-label="关闭" disabled></button></div>']) {
        const page = fixture(markup);
        assert.equal(page.dismiss(), false);
        assert.equal(page.clicks.length, 0);
    }
});

test('closing a promotion does not dismiss a separate official consent dialog', () => {
    const page = fixture('<div role="dialog">用户协议<button id="consent">同意</button></div><div role="dialog">下载豆包电脑版<button id="close" aria-label="关闭"></button></div>');
    assert.equal(page.dismiss(), true);
    assert.ok(page.clicks.includes('close'));
    assert.ok(!page.clicks.includes('consent'));
});
