const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { spawn } = require('node:child_process');
const { AppController } = require('./controller');
const { testConnection } = require('./model');
const { data } = require('./settings');

async function createGuiServer({ controller = new AppController({ logFile: path.join(data, 'runtime.log') }), token = randomBytes(24).toString('hex'), port = 0, testAPI = testConnection } = {}) {
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
        '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
    let address;
    const server = http.createServer(async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
        try {
            if (request.headers.host !== address.host) { json(403, { error: '本机地址不匹配' }); return; }
            const url = new URL(request.url, address.origin);
            if (url.pathname.startsWith('/api/')) {
                const provided = Buffer.from((request.headers.authorization || '').replace(/^Bearer /, ''));
                const expected = Buffer.from(token);
                if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { json(401, { error: '请从程序显示的地址重新打开界面' }); return; }
                if (request.headers.origin && request.headers.origin !== address.origin) { json(403, { error: '请求来源不匹配' }); return; }
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
                    setTimeout(async () => { await controller.close(); server.close(); }, 100);
                    return;
                }
                json(404, { error: '操作不存在' }); return;
            }
            const file = files[url.pathname];
            if (request.method !== 'GET' || !file) { response.writeHead(404); response.end(); return; }
            const content = fs.readFileSync(path.join(__dirname, '..', 'ui', file[0]));
            response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` });
            response.end(content);
        } catch (error) { json(400, { error: error.message }); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    address = new URL(`http://127.0.0.1:${server.address().port}`);
    return { server, controller, url: `${address.origin}/#token=${token}` };
}

async function startGUI({ open = true } = {}) {
    const app = await createGuiServer();
    console.log(`UOOC Study 界面已启动：\n${app.url}\n在工作台右上角选择“退出程序”结束运行；仅关闭浏览器标签页不会退出程序。`);
    if (open) {
        if (process.platform === 'win32') {
            const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', app.url], { stdio: 'ignore', windowsHide: true });
            child.on('error', () => console.log('请复制上方地址到浏览器打开。'));
            child.unref();
        } else console.log('请在浏览器打开上方地址。');
    }
    process.once('SIGINT', async () => { await app.controller.close(); app.server.close(); });
    return app;
}

module.exports = { createGuiServer, startGUI };
