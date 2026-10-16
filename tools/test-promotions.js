// Local fixture only: never sends a message to an AI service.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchLocalBrowser } = require('../lib/local-browser');
const { WebChat } = require('../lib/web-chat');
const { inspectReadiness } = require('../lib/chat-ready');

const html = `<!doctype html><meta charset="utf-8"><textarea></textarea><button id="send" onclick="sends++">发送</button>
<article data-message-role="assistant">1.A</article><script>
let closes=0,downloads=0,sends=0;
function showPromotion(extra=''){
 document.querySelector('[role=dialog]')?.remove();
 const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
 dialog.style.cssText='position:fixed;inset:0;background:white;z-index:1000;padding:40px';
 dialog.innerHTML='<h2>下载豆包电脑版 解锁本地任务能力</h2><p>'+extra+'</p><button id="download" onclick="downloads++">立即下载</button><button aria-label="关闭" onclick="closes++;this.parentElement.remove()">×</button>';
 document.body.append(dialog);
}
showPromotion();
</script>`;

(async () => {
    const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const results = [];
    try {
        for (const [browser, executable] of [
            ['chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
            ['msedge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
        ]) {
            const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-promotion-test-'));
            const context = await launchLocalBrowser(executable, profile, { headless: true });
            try {
                const page = await context.newPage();
                const chat = new WebChat();
                chat.sessionConfig = { webPlatform: 'doubao' };
                await chat.preparePage(page);
                await page.goto(`http://127.0.0.1:${server.address().port}`);
                await chat.clearPromotions(page);
                assert.equal(await page.getByRole('dialog').count(), 0);
                await page.evaluate(() => showPromotion());
                await page.locator('textarea').fill('fixture prompt');
                await page.evaluate(() => showPromotion());
                await page.locator('#send').click();
                await page.evaluate(() => showPromotion());
                const reply = await chat.read(page, {});
                assert.ok(reply.assistantCandidates.includes('1.A'));
                assert.equal(await page.getByRole('dialog').count(), 0);
                for (const [extra, kind] of [['用户协议', 'consent'], ['登录', 'login'], ['请完成人机验证', 'verification']]) {
                    await page.evaluate(value => showPromotion(value), extra);
                    await chat.clearPromotions(page);
                    assert.equal(await page.getByRole('dialog').count(), 1);
                    assert.equal((await page.evaluate(inspectReadiness, { editor: 'textarea' })).kind, kind);
                }
                const actions = await page.evaluate(() => ({ closes, downloads, sends }));
                assert.deepEqual(actions, { closes: 4, downloads: 0, sends: 1 });
                results.push({ browser, passed: true, ...actions });
                console.log(JSON.stringify(results.at(-1)));
            } finally { await context.close(); }
        }
        fs.mkdirSync(path.resolve('.build'), { recursive: true });
        fs.writeFileSync(path.resolve('.build/promotion-acceptance.json'), JSON.stringify({ kind: 'local-fixtures-only', time: new Date().toISOString(), results }, null, 2));
    } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
