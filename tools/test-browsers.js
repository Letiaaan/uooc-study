// Integration acceptance against LOCAL fixtures, not UOOC or an AI service.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchLocalBrowser } = require('../lib/local-browser');
const { WebChat } = require('../lib/web-chat');
const { AnswerRouter } = require('../lib/answer-router');
const { saveAnswer } = require('../lib/answer-store');
const { processQuiz } = require('../lib/quiz');
const { Control } = require('../lib/control');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-e2e-'));
const reply = Array.from({ length: 30 }, (_, i) => i === 9 ? null : `${i + 1}.${i % 3 === 0 ? 'B' : i % 3 === 1 ? 'AC' : '["样例填空"]'}`).filter(Boolean).join('\n');
const expected = Array.from({ length: 30 }, (_, i) => i === 9 ? ['A'] : i % 3 === 0 ? ['B'] : i % 3 === 1 ? ['A', 'C'] : ['样例填空']);
const scripts = code => `<script>${code}</script>`;
const shell = body => `<!doctype html><meta charset="utf-8"><title>UOOC local acceptance fixture</title>${body}`;
let sends = 0, conversations = 0, submissions = 0, verificationClicks = 0;
const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/verify') { verificationClicks++; res.end('ok'); return; }
    if (url.pathname === '/send') {
        let body = ''; for await (const chunk of req) body += chunk;
        const prompt = JSON.parse(body).prompt;
        assert.match(prompt, /30\./); assert.match(prompt, /只输出题号和答案/);
        assert.doesNotMatch(prompt, /10\. \[单选\]/);
        sends++;
        res.end('ok'); return;
    }
    const editor = `<div data-testid="chat_input_input"><div data-slate-editor="true" contenteditable="true" style="border:1px solid;padding:20px"><p><span data-slate-zero-width="n">\uFEFF<br></span><span data-slate-placeholder="true" contenteditable="false">向千问提问</span></p></div></div>`;
    const chat = (fresh = false) => shell(`<div role="dialog" id="official-prompt">本地模拟用户须知：此提示由测试中的用户操作模拟器关闭</div><button data-session-switch-target="new-chat" onclick="location.href='/fresh'">新对话</button>${editor}<button data-testid="chat_input_send_button" data-session-switch-target="send-query" onclick="send()">发送</button>${scripts(`
        setTimeout(()=>document.querySelector('#official-prompt')?.remove(),1200);
        async function send(){ const prompt=document.querySelector('[contenteditable]').innerText;
        await fetch('/send',{method:'POST',body:JSON.stringify({prompt})});location.href='/reply'; }
        ${fresh ? "setTimeout(()=>location.replace('/ready'),50);" : ''}
    `)}`);
    if (url.pathname === '/chat' || url.pathname === '/ready') res.end(chat());
    else if (url.pathname === '/fresh') { conversations++; res.end(chat(true)); }
    else if (url.pathname === '/reply') {
        const content = sends % 2 ? `<pre>${reply}</pre>` : `<ol>${reply.split('\n').map(line => `<li value="${line.match(/^\d+/)[0]}">${line.replace(/^\d+\./, '')}</li>`).join('')}</ol>`;
        res.end(shell(`<article data-message-role="assistant" data-testid="receive_message">${content}${sends % 2 ? '<span class="copy-action" data-icon-type="copy">复制</span>' : ''}</article>${editor}`));
    }
    else if (url.pathname === '/quiz') {
        const blocks = expected.map((values, i) => `<section class="queContainer"><h3>${i + 1}. 本地样例题目</h3><img hidden src="/hidden.png"><button class="question-status"><img width="16" height="16" alt="正确" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3C/svg%3E"></button>${i === 9 ? '<img width="300" height="100" alt="题目曲线图" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'300\' height=\'100\'%3E%3C/svg%3E">' : ''}${i % 3 === 2
            ? '<textarea class="ue-container1"></textarea>'
            : ['甲', '乙', '丙', '丁'].map((text, j) => `<label class="ti-a" style="display:block"><input name="q${i}" type="${i % 3 ? 'checkbox' : 'radio'}" value="${String.fromCharCode(65 + j)}">${text}</label>`).join('')}</section>`).join('');
        const loaded = `${blocks}<button onclick="document.querySelector('#confirm').hidden=false">提交试卷</button><div id="confirm" hidden role="dialog"><div id="aliyunCaptcha-checkbox-wrapper"><button id="aliyunCaptcha-checkbox-icon" onclick="verify()">□</button><span id="verification-text">点击复选框开始智能验证</span></div><div class="btn btn-warning" role="button" onclick="submit()">提交</div></div>`;
        res.end(shell(`<main id="paper">测验加载中</main>${scripts(`
            setTimeout(()=>{const button=document.createElement('button');button.textContent='开始测验';button.onclick=()=>setTimeout(()=>document.querySelector('#paper').innerHTML=${JSON.stringify(loaded)},1200);document.querySelector('#paper').replaceChildren(button);},400);
            async function verify(){document.querySelector('#aliyunCaptcha-checkbox-icon').remove();document.querySelector('#verification-text').textContent='验证中';await fetch('/verify',{method:'POST'});setTimeout(()=>{document.querySelector('#verification-text').textContent='验证通过';${submissions % 2 ? 'submit();' : ''}},700);}
            async function submit(){const answers=[...document.querySelectorAll('.queContainer')].map(q=>q.querySelector('textarea')?[q.querySelector('textarea').value]:[...q.querySelectorAll('input:checked')].map(x=>x.value));
            const verified=document.querySelector('#verification-text').textContent==='验证通过';
            const res=await fetch('/submit',{method:'POST',body:JSON.stringify({answers,verified})}); if(res.ok)location.href='/passed'; }
        `)}`));
    } else if (url.pathname === '/submit') {
        let body = ''; for await (const chunk of req) body += chunk;
        try { assert.deepEqual(JSON.parse(body), { answers: expected, verified: true }); submissions++; res.end('ok'); }
        catch { res.statusCode = 400; res.end('incorrect selections'); }
    } else if (url.pathname === '/passed') res.end(shell('<div class="layui-layer-content">测验通过</div>'));
    else { res.statusCode = 404; res.end('missing'); }
});

async function main() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const results = [];
    try {
        for (const [browser, executable] of [
            ['chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
            ['msedge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
        ]) {
            if (!fs.existsSync(executable)) throw new Error(`Required installed browser missing: ${browser}`);
            for (const webPlatform of ['doubao', 'qianwen']) {
                const context = await launchLocalBrowser(executable, path.join(root, `${browser}-${webPlatform}`), { headless: !process.argv.includes('--headed') });
                // The product isolates UOOC and AI into separate browser profiles.
                // Sharing one context here hides the quiz tab when AI is opened,
                // which does not reproduce the product's window arrangement.
                const courseContext = await launchLocalBrowser(executable, path.join(root, `${browser}-${webPlatform}-course`), { headless: !process.argv.includes('--headed') });
                const events = [], files = [];
                const config = { browser, provider: 'web', webPlatform, webLogin: 'guest', webAutomation: 'auto' };
                const chat = new WebChat({ open: async options => { assert.equal(options.browser, browser); return context; },
                    go: page => page.goto(`${base}/chat`, { waitUntil: 'domcontentloaded' }),
                    onState: value => events.push(value) });
                const router = new AnswerRouter({ config: () => config, chat,
                    solveAPI: () => assert.fail('Unexpected API request'),
                    storeAnswer: (text, questions, info) => {
                        const result = saveAnswer(text, questions, { ...info, directory: path.join(root, 'answers') });
                        files.push(result.file); return result;
                    }, onError: message => console.error(`${browser}/${webPlatform}: ${message}`) });
                try {
                    // No connect/approve/IPC readiness action: the product must
                    // start the entire web flow from the quiz's solve request.
                    for (let n = 0; n < 2; n++) {
                        const page = await courseContext.newPage();
                        page.setDefaultTimeout(5000);
                        await page.goto(`${base}/quiz`);
                        const quizKey = `${browser}:${webPlatform}:${n}`;
                        const control = new Control();
                        const timeout = setTimeout(() => control.stop(), 45000);
                        try {
                            const outcome = await processQuiz(page, () => {}, { control,
                                solve: questions => router.solve(questions, control, quizKey) });
                            assert.equal(outcome, '页面确认通过');
                            assert.ok(fs.existsSync(files.at(-1)), 'Answers must survive until pass is confirmed');
                            router.passed(quizKey);
                            assert.ok(!fs.existsSync(path.dirname(files.at(-1))), 'Only the passed quiz directory is removed');
                        } catch (error) {
                            const diagnostics = { url: page.url(), visibility: await page.evaluate(() => ({
                                visibility: document.visibilityState, focus: document.hasFocus(),
                                rect: document.querySelector('.ti-a')?.getBoundingClientRect().toJSON()
                            })).catch(() => null) };
                            console.error(JSON.stringify({ browser, webPlatform, diagnostics }));
                            throw error;
                        } finally { clearTimeout(timeout); await page.close(); }
                    }
                    assert.equal(events.filter(event => event.phase === '新会话已开启').length, 2);
                    assert.ok(events.some(event => event.needsAction), 'Official prompts require user action, not an automatic click');
                    results.push({ browser, platform: webPlatform, quizzes: 2, questionsPerQuiz: 30, approvalClicks: 0, passed: true });
                    console.log(JSON.stringify(results.at(-1)));
                } finally { await router.close(); await courseContext.close(); }
            }
        }
        assert.equal(sends, 8); assert.equal(conversations, 8); assert.equal(submissions, 8);
        assert.equal(verificationClicks, 8);
        assert.equal(fs.readdirSync(path.join(root, 'answers')).length, 0);
        const report = { kind: 'local-fixtures-only', headless: !process.argv.includes('--headed'), time: new Date().toISOString(), results, sends, conversations, submissions, verificationClicks };
        fs.mkdirSync(path.join(__dirname, '..', '.build'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, '..', '.build', 'browser-acceptance.json'), JSON.stringify(report, null, 2));
        console.log('LOCAL fixture acceptance passed. Real UOOC/AI websites have not been verified by this test.');
    } finally { await new Promise(resolve => server.close(resolve)); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
