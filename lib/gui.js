const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { openWorkbench, confirmWorkbench } = require('./gui-open');
const { AppController } = require('./controller');
const { testConnection } = require('./model');
const { data } = require('./settings');
const { claimGuiInstance } = require('./gui-instance');
const { GuiLifecycle } = require('./gui-lifecycle');

async function createGuiServer({ controller = new AppController({ logFile: path.join(data, 'runtime.log') }), token = randomBytes(24).toString('hex'), port = 0, testAPI = testConnection,
    identity = null, lifecycle = {} } = {}) {
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
        '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
    let address;
    let closing;
    const life = new GuiLifecycle({ ...lifecycle, onEmpty: () => { void close().catch(error => console.error(error.message)); } });
    function close() {
        return closing ||= (async () => {
            life.dispose();
            try { await controller.close(); }
            finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
        })();
    }
    const server = http.createServer(async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
        try {
            if (closing) { json(503, { error: '工作台正在退出，请重新启动程序。' }); return; }
            if (request.headers.host !== address.host) { json(403, { error: '本机地址不匹配' }); return; }
            const url = new URL(request.url, address.origin);
            if (url.pathname.startsWith('/api/')) {
                const provided = Buffer.from((request.headers.authorization || '').replace(/^Bearer /, ''));
                const expected = Buffer.from(token);
                if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { json(401, { error: '请从程序显示的地址重新打开界面' }); return; }
                if (request.headers.origin && request.headers.origin !== address.origin) { json(403, { error: '请求来源不匹配' }); return; }
                if (request.method === 'GET' && url.pathname === '/api/instance') { json(200, { ...(identity || { application: 'uooc-study', pid: process.pid }), activation: true, clients: life.clients.size }); return; }
                if (request.method === 'GET' && url.pathname === '/api/session') { life.connect(response); return; }
                if (request.method === 'GET' && url.pathname === '/api/state') { json(200, controller.snapshot()); return; }
                if (request.method !== 'POST') { json(405, { error: '请求方法不支持' }); return; }
                if (!request.headers['content-type']?.startsWith('application/json')) { json(415, { error: '请使用 JSON 请求' }); return; }
                let body = '';
                request.setEncoding('utf8');
                for await (const chunk of request) {
                    body += chunk;
                    if (Buffer.byteLength(body) > 1048576) throw new Error('内容超过 1 MB，请缩短后重试');
                }
                const input = JSON.parse(body || '{}');
                if (url.pathname === '/api/activate') { life.expectClient(undefined, true); json(200, { ok: true }); return; }
                if (url.pathname === '/api/settings') { json(200, controller.save(input)); return; }
                if (url.pathname === '/api/test-api') {
                    if ((input.provider || controller.config.provider) !== 'api') throw new Error('请在 API 答题方式中测试连接');
                    const result = await testAPI(controller.preview(input));
                    json(200, result); return;
                }
                if (url.pathname === '/api/command') { controller.command(input.action, input); json(200, { ok: true }); return; }
                if (url.pathname === '/api/answers/validate') { json(200, { answers: controller.validate(input.text, input.id) }); return; }
                if (url.pathname === '/api/answers/apply') { json(200, { answers: controller.answer(input.text, input.id) }); return; }
                if (url.pathname === '/api/answers/skip') { controller.skip(input.id); json(200, { ok: true }); return; }
                if (url.pathname === '/api/shutdown') {
                    json(200, { ok: true });
                    setTimeout(() => { void close().catch(error => console.error(error.message)); }, 100);
                    return;
                }
                json(404, { error: '操作不存在' }); return;
            }
            const file = files[url.pathname];
            if (request.method !== 'GET' || !file) { response.writeHead(404); response.end(); return; }
            // A reload keeps the same local service even if its new script takes
            // longer than the normal last-tab closing delay to reconnect.
            if (url.pathname === '/') life.expectClient();
            const content = fs.readFileSync(path.join(__dirname, '..', 'ui', file[0]));
            response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` });
            response.end(content);
        } catch (error) { json(400, { error: error.message }); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    address = new URL(`http://127.0.0.1:${server.address().port}`);
    server.once('close', () => life.dispose());
    return { server, controller, close, url: `${address.origin}/#token=${token}` };
}

async function startGUI({ open = true, directory = data, openURL = openWorkbench, create = createGuiServer } = {}) {
    const show = url => openURL === openWorkbench ? openWorkbench(url, { confirm: () => confirmWorkbench(url) }) : openURL(url);
    const instance = await claimGuiInstance(directory);
    if (instance.existing) {
        console.log(instance.legacy ? '已打开旧版工作台。请先在其中退出，再启动新版以应用更新。' : '已打开正在运行的工作台。');
        if (open) await show(instance.existing);
        return { reused: true, url: instance.existing };
    }
    try {
        const app = await create({ identity: instance.identity, lifecycle: { waitForFirst: open } });
        instance.publish(app.url);
        const interrupt = () => { void app.close(); };
        process.once('SIGINT', interrupt);
        app.server.once('close', () => { instance.release(); process.removeListener('SIGINT', interrupt); });
        console.log(`UOOC Study 界面已启动：\n${app.url}\n关闭最后一个工作台标签页后自动退出；也可在工作台按 F12 或点击“退出程序”。`);
        if (open) {
            try { await show(app.url); }
            catch (error) { await app.close(); throw error; }
        }
        return app;
    } catch (error) { instance.release(); throw error; }
}

module.exports = { createGuiServer, startGUI, openWorkbench };
