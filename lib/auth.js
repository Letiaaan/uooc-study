const { origin, settings } = require('./settings');
const { visibleAcrossFrames, navigate } = require('./browser');
const { credentials } = require('./console');
const { SimpleVerification } = require('./verification');
const { ensureRendered } = require('./window-rendering');

const center = `${origin}/home#/center/course/learn`;

async function ensureLogin(page, getCredentials = credentials, { control, onVerify = () => {}, onStatus = () => {}, now = Date.now } = {}) {
    onStatus('正在检查 UOOC 登录状态');
    await navigate(page, center);
    const courseMenu = 'a[href="#/center/course/learn"]';
    if (await page.locator(courseMenu).isVisible().catch(() => false)) return;
    try {
        await page.locator(courseMenu).waitFor({ state: 'visible', timeout: 7000 });
        return;
    } catch {}

    await navigate(page, `${origin}/user/login`);
    await page.locator('.tp_f2 .tp_in2').waitFor({ state: 'visible', timeout: 15000 });
    await control?.checkpoint();
    const account = await getCredentials(settings());
    onStatus('正在自动填写账号密码，无需在官网重复输入');
    try {
        if (account.username) await page.locator('.tp_f2 .tp_in2').fill(account.username.trim());
        if (account.password) await page.locator('#password').fill(account.password);
    } catch { throw new Error('登录表单填写未完成，请在浏览器核对当前登录方式后重试'); }
    const remember = page.locator('input[name="remember"]');
    if (await remember.count()) await remember.uncheck();
    const verification = new SimpleVerification();
    let submitted = false;
    const configured = Boolean(account.username && account.password);
    let lastHelp = '', lastStatus = '', statusSince = now(), submittedAt = 0;
    const help = (reason, message) => {
        if (lastHelp === reason) return;
        lastHelp = reason;
        onStatus('等待本人处理 UOOC 登录');
        onVerify({ kind: 'login', reason, message });
    };
    console.log('将尝试一次智能验证复选框；出现挑战或失败时请在浏览器处理。已填写完整账号密码时，验证通过后自动点击登录一次。');
    console.log('等待登录，最长 5 分钟；Ctrl+C 可退出。');
    if (!configured) help('credentials', '工作台未提供完整账号密码，请点击“前往验证页面”在 UOOC 官网补充并登录，完成后自动加载课程。');
    else onStatus('账号密码已填写，正在尝试自动验证与登录');
    try {
        for (let tick = 0; tick < 150; tick++) {
            await control?.checkpoint();
            if (page.isClosed()) throw new Error('登录页面已关闭');
            await ensureRendered(page);
            const atLogin = await visibleAcrossFrames(page, '.tp_f2 .tp_in2');
            if (atLogin) {
                const status = await verification.step(page);
                if (status !== lastStatus) { lastStatus = status; statusSince = now(); }
                if (configured && (status === 'manual' || ['unavailable', 'checking', 'clicked'].includes(status) && now() - statusSince >= 15000)) {
                    help('verification', '账号密码已自动填写。官网验证需要人工处理，请点击“前往验证页面”；通过后程序会继续登录。');
                }
                if (configured && !submitted && status === 'verified') {
                    const button = await visibleAcrossFrames(page, '.tp_f2 button[type="submit"]');
                    if (button && await button.isEnabled()) {
                        submitted = true;
                        submittedAt = now();
                        onVerify(null);
                        onStatus('验证通过，正在登录并读取课程');
                        await button.click();
                    }
                }
                if (submitted && now() - submittedAt >= 15000) {
                    help('login-result', '账号密码已自动填写并提交，但网站尚未确认登录。请前往页面核对账号、密码或官网提示；程序不会重复提交。');
                }
            }
            if (!atLogin && !new URL(page.url()).pathname.startsWith('/user/login')) {
                await navigate(page, center);
                if (await page.locator(courseMenu).isVisible().catch(() => false)) return;
            }
            await page.waitForTimeout(2000);
        }
        throw new Error('等待登录超时，请重新运行并在浏览器核对登录提示');
    } finally { onVerify(null); }
}

async function listCourses(page) {
    await navigate(page, center);
    await page.locator('a[href="#/center/course/learn"]').waitFor({ state: 'visible', timeout: 15000 });
    try { await page.locator('a:has-text("继续学习"), a:has-text("开始学习")').first().waitFor({ timeout: 12000 }); } catch {}
    const rows = await page.locator('a:has-text("继续学习"), a:has-text("开始学习")').evaluateAll(links => links.map(link => {
        let card = link.parentElement;
        while (card?.parentElement && !card.querySelector('h3')) card = card.parentElement;
        return { url: link.href, title: card?.querySelector('h3')?.innerText.trim() || link.innerText.trim(), detail: card?.innerText.trim() || '' };
    }));
    const unique = new Map();
    for (const row of rows) {
        const address = new URL(row.url);
        if (address.origin !== origin) continue;
        const match = address.pathname.match(/^\/home\/(?:learn|course)(?:\/new)?\/(\d+)/)
            || (address.pathname === '/home/learn/index' && address.hash.match(/^#\/?(\d+)/));
        if (match) unique.set(match[1], { ...row, id: match[1] });
    }
    return [...unique.values()];
}

async function signOut(context, page) {
    for (const tab of context.pages()) {
        if (new URL(tab.url()).hostname.endsWith('uooc.net.cn')) {
            await tab.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
        }
    }
    await context.clearCookies();
    await navigate(page, `${origin}/league/union`);
    console.log('本机登录状态已退出。');
}

module.exports = { ensureLogin, listCourses, signOut };
