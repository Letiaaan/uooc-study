const { origin, settings } = require('./settings');
const { visibleAcrossFrames, navigate } = require('./browser');
const { credentials } = require('./console');
const { SimpleVerification } = require('./verification');
const { ensureRendered } = require('./window-rendering');

const center = `${origin}/home#/center/course/learn`;

async function ensureLogin(page, getCredentials = credentials, { control, onVerify = () => {} } = {}) {
    await navigate(page, center);
    const courseMenu = 'a[href="#/center/course/learn"]';
    if (await page.locator(courseMenu).isVisible().catch(() => false)) return;
    try {
        await page.locator(courseMenu).waitFor({ state: 'visible', timeout: 7000 });
        return;
    } catch {}

    await navigate(page, `${origin}/user/login`);
    await page.locator('.tp_f2 .tp_in2').waitFor({ state: 'visible', timeout: 15000 });
    const account = await getCredentials(settings());
    try {
        if (account.username) await page.locator('.tp_f2 .tp_in2').fill(account.username.trim());
        if (account.password) await page.locator('#password').fill(account.password);
    } catch { throw new Error('登录表单填写未完成，请在浏览器核对当前登录方式后重试'); }
    const remember = page.locator('input[name="remember"]');
    if (await remember.count()) await remember.uncheck();
    const verification = new SimpleVerification();
    let submitted = false;
    const configured = Boolean(account.username && account.password);
    console.log('将尝试一次智能验证复选框；出现挑战或失败时请在浏览器处理。已填写完整账号密码时，验证通过后自动点击登录一次。');
    console.log('等待登录，最长 5 分钟；Ctrl+C 可退出。');
    onVerify({ kind: 'login', message: configured
        ? '正在尝试一次官网智能验证；通过后自动登录。出现挑战、失败或账号提示时请在浏览器处理。'
        : '请在官网填写账号密码。程序会尝试一次智能验证；请确认表单后点击登录，完成后自动加载课程。' });
    try {
        for (let tick = 0; tick < 150; tick++) {
            await control?.checkpoint();
            if (page.isClosed()) throw new Error('登录页面已关闭');
            await ensureRendered(page);
            const atLogin = await visibleAcrossFrames(page, '.tp_f2 .tp_in2');
            if (atLogin) {
                const status = await verification.step(page);
                if (configured && !submitted && status === 'verified') {
                    const button = await visibleAcrossFrames(page, '.tp_f2 button[type="submit"]');
                    if (button && await button.isEnabled()) {
                        submitted = true;
                        await button.click();
                    }
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
