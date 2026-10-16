const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureLogin } = require('../lib/auth');

function loginPage({ reject = false, manual = false } = {}) {
    let loggedIn = false, verified = false, ticks = 0, clicks = 0, logins = 0;
    let address = 'https://www.uooc.net.cn/user/login';
    const widget = { isVisible: async () => !loggedIn,
        evaluate: async () => verified ? 'verified' : 'ready',
        locator: () => ({ isVisible: async () => true, click: async () => { clicks++; verified = true; } }) };
    const button = { isVisible: async () => !loggedIn, isEnabled: async () => verified,
        click: async () => { assert.equal(verified, true); logins++; if (!reject) { loggedIn = true; address = 'https://www.uooc.net.cn/home'; } } };
    const form = { isVisible: async () => !loggedIn, waitFor: async () => {}, fill: async () => {} };
    const course = { isVisible: async () => loggedIn, waitFor: async () => { if (!loggedIn) throw new Error('Not signed in'); } };
    const page = {
        goto: async url => { address = loggedIn ? url : 'https://www.uooc.net.cn/user/login'; },
        url: () => address, isClosed: () => false, frames: () => [page],
        waitForTimeout: async () => { if (manual && ++ticks === 3) { loggedIn = true; address = 'https://www.uooc.net.cn/home'; } },
        locator: selector => {
            if (selector.startsWith('a[href=')) return course;
            if (selector === '.tp_f2 .tp_in2' || selector === '#password') return { ...form, all: async () => loggedIn ? [] : [form] };
            if (selector === 'input[name="remember"]') return { count: async () => 0 };
            if (selector === '#aliyunCaptcha-checkbox-wrapper') return { all: async () => loggedIn ? [] : [widget] };
            if (selector === '.tp_f2 button[type="submit"]') return { all: async () => loggedIn ? [] : [button] };
            assert.fail(`Unexpected selector: ${selector}`);
        }
    };
    return { page, counts: () => ({ clicks, logins }) };
}

test('configured login tries a checkbox, submits only after verified and checks the course page', async () => {
    const fixture = loginPage();
    await ensureLogin(fixture.page, async () => ({ username: 'fixture-user', password: 'fixture-password' }));
    assert.deepEqual(fixture.counts(), { clicks: 1, logins: 1 });
});

test('a rejected login is not submitted repeatedly and blank-config users retain manual login', async () => {
    const rejected = loginPage({ reject: true });
    await assert.rejects(ensureLogin(rejected.page, async () => ({ username: 'fixture-user', password: 'fixture-password' })), /等待登录超时/);
    assert.deepEqual(rejected.counts(), { clicks: 1, logins: 1 });
    const manual = loginPage({ manual: true });
    await ensureLogin(manual.page, async () => ({ username: '', password: '' }));
    assert.deepEqual(manual.counts(), { clicks: 1, logins: 0 });
});
