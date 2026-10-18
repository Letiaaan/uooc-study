const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { VerificationNotice } = require('../lib/window-attention');

function fixture() {
    const children = [], opened = [], errors = [];
    const notice = new VerificationNotice({ platform: 'win32', onOpen: id => opened.push(id), onError: () => errors.push(true),
        start: (exe, args, options) => {
            assert.ok(args.includes('-NonInteractive'));
            assert.equal(options.windowsHide, true);
            const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), arguments: args, killed: false,
                kill() { this.killed = true; } });
            children.push(child);
            return child;
        }
    });
    return { notice, children, opened, errors };
}

test('disabled verification reminders stay pending without a native popup; toggling on is live', () => {
    const { notice, children, opened } = fixture();
    const value = { id: 'pending', kind: 'login' };
    notice.update(value, false);
    assert.equal(children.length, 0);
    notice.update(value, true);
    notice.update(value, true);
    assert.equal(children.length, 1);
    children[0].stdout.emit('data', 'open\r\n');
    children[0].emit('exit', 0);
    assert.deepEqual(opened, ['pending']);
});

test('video questions and quiz review prompts do not use the account-login message', () => {
    const { notice, children } = fixture();
    notice.update({id:'video',kind:'video-question'},true);
    assert.equal(children[0].arguments.at(-1),'video');
    notice.update({id:'review',kind:'quiz-review'},true);
    assert.equal(children[1].arguments.at(-1),'quiz');
    notice.close();
});

test('late native replies cannot open cleared or disabled verification pages', () => {
    const { notice, children, opened } = fixture();
    const value = { id: 'old', kind: 'quiz' };
    notice.update(value, true);
    notice.update(null);
    assert.equal(children[0].killed, true);
    children[0].stdout.emit('data', 'open'); children[0].emit('exit', 0);
    notice.update(value, true);
    notice.update(value, false);
    assert.equal(children[1].killed, true);
    children[1].stdout.emit('data', 'open'); children[1].emit('exit', 0);
    assert.deepEqual(opened, []);
});

test('postpone does not reopen the same reminder, and native errors fall back to the workbench', () => {
    const { notice, children, opened, errors } = fixture();
    const value = { id: 'one', kind: 'login' };
    notice.update(value, true); children[0].emit('exit', 0);
    notice.update(value, true);
    assert.equal(children.length, 1);
    notice.update({ id: 'two', kind: 'quiz' }, true);
    children[1].emit('error', Error('Unavailable'));
    assert.equal(errors.length, 1);
    assert.deepEqual(opened, []);
});
