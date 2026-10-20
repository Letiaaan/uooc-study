const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const { createGuiServer } = require('../lib/gui');
const { AppController } = require('../lib/controller');

const config = { username: 'fixture-user', password: '', key: '', browser: 'chrome', provider: 'web', webPlatform: 'doubao',
    webLogin: 'guest', webAutomation: 'auto', model: 'deepseek-chat', endpoint: 'https://api.deepseek.com', verificationPopup: false };
async function loaded(page, url) {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#run').hasAttribute('aria-disabled'));
}
for (const channel of ['chrome', 'msedge']) {
    const relative = channel === 'chrome' ? 'Google/Chrome/Application/chrome.exe' : 'Microsoft/Edge/Application/msedge.exe';
    const installed = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
        .filter(Boolean).some(base => fs.existsSync(path.join(base, relative)));
    test(`${channel} workbench close, refresh, multi-tab, course reselection and F12`, { skip: !installed, timeout: 30000 }, async t => {
        const browser = await chromium.launch({ channel, headless: true });
        t.after(() => browser.close());
        await t.test('a background tab and refresh retain the service; closing the last tab exits', async () => {
            const controller = new AppController({ config });
            let exits = 0;
            controller.close = async () => { exits++; };
            const app = await createGuiServer({ controller, lifecycle: { grace: 500 } });
            const context = await browser.newContext();
            try {
                const first = await context.newPage(); await loaded(first, app.url);
                const second = await context.newPage(); await loaded(second, app.url);
                await second.bringToFront();
                await delay(700);
                assert.equal(exits, 0);
                await first.reload();
                await first.waitForFunction(() => document.querySelector('#run').hasAttribute('aria-disabled'));
                await delay(700);
                assert.equal(exits, 0);
                await first.goto('about:blank');
                await first.goBack();
                await first.waitForFunction(() => document.querySelector('#run').hasAttribute('aria-disabled'));
                await second.close(); await delay(700);
                assert.equal(exits, 0);
                const ended = once(app.server, 'close');
                await first.close(); await ended;
                assert.equal(exits, 1);
            } finally { await context.close(); await app.close(); }
        });
        await t.test('stop permits another course selection and F12 shuts down without another connect', async () => {
            const child = Object.assign(new EventEmitter(), { sent: [], send(message) {
                this.sent.push(message);
                if (message.type === 'stop') this.emit('message', { type: 'state', value: { busy: false, stopping: false, connected: true, phase: '已停止，可重新选课并开始' } });
            }, disconnect() { this.emit('exit', 0); }, kill() { this.emit('exit', 1); } });
            const controller = new AppController({ config, createWorker: () => child });
            Object.assign(controller.state, { connected: true, courses: [{ id: '1', title: 'First' }, { id: '2', title: 'Second' }] });
            const app = await createGuiServer({ controller });
            const page = await browser.newPage();
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            try {
                await loaded(page, app.url);
                await page.locator('.course-row input[value="1"]').check();
                await page.locator('#run').click();
                await page.waitForFunction(() => document.querySelector('#pause').getAttribute('aria-disabled') === 'false');
                await page.locator('#stop').click();
                await page.waitForFunction(() => document.querySelector('#run').getAttribute('aria-disabled') === 'false');
                await page.locator('.course-row input[value="1"]').uncheck();
                await page.locator('.course-row input[value="2"]').check();
                await page.locator('#mode').selectOption('quiz');
                const submitted = page.waitForResponse(response => response.url().endsWith('/api/command') && response.request().postDataJSON()?.action === 'run');
                await page.locator('#run').click();
                assert.equal((await submitted).status(), 200);
                assert.deepEqual(child.sent.filter(message => message.type === 'run').map(message => message.ids), [['1'], ['2']]);
                assert.equal(child.sent.some(message => message.type === 'connect'), false);
                const ended = once(app.server, 'close');
                await page.keyboard.press('F12');
                await ended;
                assert.equal(controller.child, null);
                assert.deepEqual(errors, []);
                assert.match(await page.locator('#notice').textContent(), /程序已退出/);
            } finally { await page.close(); await app.close(); }
        });
    });
}
