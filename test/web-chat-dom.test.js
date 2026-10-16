const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { inspectChat, completeReply } = require('../lib/web-chat');

function inspect(markup) {
    const { document } = parseHTML(`<html><body>${markup}</body></html>`);
    for (const node of document.querySelectorAll('*')) node.getClientRects = () => node.closest('[hidden]') ? [] : [{}];
    return vm.runInNewContext(`(${inspectChat.toString()})({prompt:''})`, { document });
}

test('Qianwen answers are read from the assistant card, excluding user examples even with a copy toolbar', () => {
    const snapshot = inspect('<div class="chat-round"><div class="message-card-wrap question"><p>1.A</p></div><div class="chat-answers-card-wrap"><p>1.B</p><button aria-label="复制"></button></div></div>');
    const questions = [{ number: 1, kind: 'single', options: [{ letter: 'A' }, { letter: 'B' }] }];
    assert.equal(snapshot.assistantReplies, 1);
    assert.ok(snapshot.assistantCandidates.includes('1.B'));
    assert.ok(!snapshot.candidates.includes('1.A'));
    assert.equal(completeReply({ ...snapshot, candidates: ['1.A', ...snapshot.candidates] }, questions), '1.B');
});

test('an explicit assistant refusal is recognized and a quoted user refusal is ignored', () => {
    assert.match(inspect('<div class="chat-answers-card-wrap">你好，我无法回答这个问题，我们换一个话题聊聊吧。</div>').refusal, /无法回答/);
    assert.equal(inspect('<div class="message-card-wrap question">你好，我无法回答这个问题</div><div class="chat-answers-card-wrap">1.A</div>').refusal, undefined);
});
