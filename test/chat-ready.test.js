const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { inspectReadiness, readEditorText } = require('../lib/chat-ready');

function inspect(markup, requireLogin = false, pathname = '/chat/') {
    const { document } = parseHTML(`<html><body>${markup}</body></html>`);
    for (const node of document.querySelectorAll('*')) node.getClientRects = () => node.closest('[hidden]') ? [] : [{}];
    return vm.runInNewContext(`(${inspectReadiness.toString()})({editor:'textarea',requireLogin:${requireLogin}})`, {
        document, location: { pathname }
    });
}

test('visible enabled guest editor is enough to proceed without any approval or login button click', () => {
    assert.equal(inspect('<button>登录</button><textarea></textarea>').ready, true);
    assert.equal(inspect('<textarea disabled></textarea>').kind, 'loading');
    assert.equal(inspect('<textarea readonly></textarea>').kind, 'loading');
    assert.equal(inspect('<div hidden><textarea></textarea></div>').kind, 'loading');
});

test('official login, consent and verification take precedence over a visible editor', () => {
    assert.equal(inspect('<textarea></textarea><button>登录</button>', true).kind, 'login');
    assert.equal(inspect('<textarea></textarea><button>登录</button>', true).openLogin, true);
    assert.equal(inspect('<textarea></textarea><button>登录</button><div role="dialog">登录或注册</div>', true).openLogin, false);
    assert.equal(inspect('<textarea></textarea>', true, '/login/').kind, 'login');
    assert.equal(inspect('<textarea></textarea><div role="dialog">登录或注册</div>').kind, 'login');
    assert.equal(inspect('<textarea></textarea><div role="dialog">请阅读用户协议和隐私政策</div>').kind, 'consent');
    assert.equal(inspect('<textarea></textarea><p>请完成人机验证</p>').kind, 'verification');
    assert.equal(inspect('<textarea></textarea><div role="dialog" hidden>请阅读用户协议</div>').ready, true);
    assert.equal(inspect('<textarea></textarea><div role="dialog">下载豆包电脑版<button>立即下载</button></div>').kind, 'dialog');
});

test('Slate placeholders do not make an empty chat nonempty and actual paragraphs retain their text', () => {
    const { document } = parseHTML('<div id="empty"><p><span data-slate-zero-width="n">\uFEFF<br></span><span data-slate-placeholder="true" contenteditable="false">向千问提问</span></p></div><div id="filled"><p>第一行</p><p>第二行<br>第三行</p></div>');
    assert.equal(readEditorText(document.getElementById('empty')).trim(), '');
    assert.equal(readEditorText(document.getElementById('filled')).trim(), '第一行\n第二行\n第三行');
    assert.equal(readEditorText({ value: 'textarea input' }), 'textarea input');
});
