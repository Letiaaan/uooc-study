const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { openBrowser, navigate } = require('./browser');
const { platform } = require('./web-platforms');
const { parseAnswers } = require('./answer-format');
const { navigationInterrupted, readAfterNavigation } = require('./page-ready');
const { inspectReadiness, readEditorText } = require('./chat-ready');
const { dismissDoubaoPromotion, promotionOverlay } = require('./chat-promotions');
const { ensureRendered } = require('./window-rendering');

function inspectChat({ prompt = '' } = {}) {
    const visible = node => Boolean(node.getClientRects().length);
    const assistantSelector = '[data-message-author-role="assistant"],[data-message-role="assistant"],[data-testid="receive_message"],.chat-answers-card-wrap';
    const userSelector = '[data-message-author-role="user"],[data-message-role="user"],[data-testid="send_message"],.message-card-wrap.question,[class*="message-select-wrapper-question-"]';
    const assistantCandidates = [];
    const controls = [...document.querySelectorAll('button,[role="button"],[data-testid*="copy"],[class*="copy"],[aria-label*="复制"],[title*="复制"],[data-icon-type],[data-icon-name]')].filter(visible).map(node => ({
        node, label: [node.innerText, node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-testid'),
            node.getAttribute('class'), node.getAttribute('data-icon-type'), node.getAttribute('data-icon-name'),
            ...[...node.querySelectorAll('[data-icon-type],[data-icon-name],use')].map(icon => icon.getAttribute('data-icon-type') || icon.getAttribute('data-icon-name') || icon.getAttribute('href') || icon.getAttribute('xlink:href'))].join(' ')
    }));
    const copies = controls.filter(item => /复制|copy/i.test(item.label) && !item.node.disabled && item.node.getAttribute('aria-disabled') !== 'true').length;
    const streaming = controls.some(item => /停止生成|停止回答|停止输出|stop.?generat|stop.?respond|stop.?chat|(?:^|[\s_-])stop(?:[\s_-]|$)/i.test(item.label));
    const candidates = [];
    for (const node of document.querySelectorAll('p,pre,article,section,div,li')) {
        if (!visible(node) || node.closest(`nav,aside,textarea,[contenteditable="true"],${userSelector}`)
            || node.querySelector(`textarea,[contenteditable="true"],${userSelector}`)) continue;
        const text = node.innerText?.trim();
        if (!text || text.length > 40000 || text === prompt || prompt.includes(text)) continue;
        if (/^(?:\d+\s*[.、:：)）]|\{\s*"answers"|```)/.test(text)) {
            candidates.push(text);
            if (node.closest(assistantSelector)) assistantCandidates.push(text);
        }
    }
    // Markdown renders "1. A" as <ol><li>A</li></ol>; innerText omits
    // the displayed list markers. Reconstruct only visible ordered lists.
    for (const list of document.querySelectorAll('ol')) {
        if (!visible(list) || list.closest(`nav,aside,li,[contenteditable="true"],${userSelector}`)) continue;
        let number = Number(list.getAttribute('start')) || 1;
        const lines = [];
        for (const item of list.children) {
            if (item.tagName !== 'LI' || !visible(item)) continue;
            if (item.hasAttribute('value')) number = Number(item.getAttribute('value'));
            lines.push(`${number++}.${item.innerText.trim()}`);
        }
        if (lines.length) {
            candidates.push(lines.join('\n'));
            if (list.closest(assistantSelector)) assistantCandidates.push(lines.join('\n'));
        }
    }
    const replies = [...document.querySelectorAll(assistantSelector)].filter(node => visible(node) && node.innerText?.trim());
    const refusal = replies.map(node => node.innerText.trim()).find(text => /^(?:你好[，,！!。\s]*)?(?:很?抱歉[，,。\s]*)?(?:我(?:暂时)?(?:无法|不能)|(?:无法|不能))(?:回答|协助|提供)/.test(text));
    return { candidates: [...new Set(candidates)], assistantCandidates: [...new Set(assistantCandidates)],
        assistantReplies: replies.length, refusal,
        copies, streaming,
        blocked: /请完成.{0,8}(?:安全|人机|智能)验证|请求过于频繁|访问过于频繁|稍后再试/.test(document.body.innerText) };
}

function completeReply(snapshot, questions) {
    if (snapshot.streaming || snapshot.blocked) return null;
    const valid = new Map();
    // Doubao renders its copy toolbar only on hover. A complete response in an
    // explicitly marked assistant message must not depend on that toolbar.
    const candidates = snapshot.assistantReplies || snapshot.assistantCandidates?.length ? snapshot.assistantCandidates || []
        : snapshot.copies ? snapshot.candidates : [];
    for (const text of candidates) {
        try { valid.set(JSON.stringify(parseAnswers(text, questions)), text); } catch {}
    }
    return valid.size === 1 ? [...valid.values()][0] : null;
}

class WebChat {
    constructor({ open = openBrowser, go = navigate, pause = delay, onState = () => {} } = {}) {
        this.open = open; this.go = go; this.pause = pause; this.onState = onState;
        this.context = null; this.page = null; this.approved = false; this.sent = new Set();
        this.loginShown = new WeakSet();
    }
    async connect(config, signal) {
        await this.check(null, signal);
        const selected = platform(config.webPlatform || 'doubao');
        const login = selected.loginRequired || config.webLogin === 'login' ? 'login' : 'guest';
        const key = `${config.webPlatform || 'doubao'}:${login}:${config.browser}`;
        this.sessionConfig = { ...config, webLogin: login };
        if (this.context && key === this.key && this.page && !this.page.isClosed()) return;
        await this.close();
        this.key = key; this.selected = selected; this.approved = false;
        const session = login === 'login' ? 'account' : `guest-${randomUUID()}`;
        this.onState({ phase: '正在启动 AI 浏览器', note: '' });
        this.context = await this.open({ browser: config.browser, profileName: `ai-profiles/${config.webPlatform || 'doubao'}/${session}` });
        if (signal?.aborted) { await this.close(); await this.check(null, signal); }
        this.page = await this.context.newPage();
        await this.preparePage(this.page);
        this.onState({ phase: '正在打开 AI 官网', note: '' });
        await this.go(this.page, selected.url);
        if (signal?.aborted) { await this.close(); await this.check(null, signal); }
        this.onState({ opened: true, approved: false, platform: config.webPlatform || 'doubao', name: selected.name, url: selected.url,
            phase: '官网已打开，等待自动检测', note: selected.loginRequired ? `${selected.name}要求登录，请在官网登录；测验流程检测到页面可用后自动继续。`
                : config.webLogin === 'login' ? '请在官网完成登录；测验流程会自动检测并继续。'
                    : '访客聊天可用时会自动发送整卷并读取回复，无需复制或点击继续。官网要求登录、验证或处理协议时会等待本人操作。' });
    }
    approve() { this.onState({ phase: '正在重新检测官网页面', note: '' }); }
    async preparePage(page) {
        await ensureRendered(page);
        page.setDefaultTimeout(10000);
        if (this.sessionConfig.webPlatform === 'doubao') {
            // Covers a promotion appearing between readiness polling and an action.
            await page.addLocatorHandler(promotionOverlay(page), () => this.clearPromotions(page));
        }
    }
    async clearPromotions(page, control, signal) {
        if (this.sessionConfig.webPlatform !== 'doubao') return;
        await this.check(control, signal);
        const closed = await readAfterNavigation(page, () => page.evaluate(dismissDoubaoPromotion),
            { check: () => this.check(control, signal), pause: this.pause });
        if (closed) this.onState({ phase: '已关闭豆包电脑版推广弹窗', note: '' });
    }
    async promptLogin(page, control, signal) {
        if (this.loginShown.has(page)) return;
        const button = page.getByRole('button', { name: /^(登录|立即登录|Log in|Sign in)$/i }).first();
        if (!await button.isVisible().catch(() => false)) return;
        await this.check(control, signal);
        this.loginShown.add(page);
        try { await button.click(); } catch (error) { if (!navigationInterrupted(error)) throw error; }
        this.onState({ phase: '等待本人处理 AI 官网提示', needsAction: true,
            note: `${this.selected.name}登录入口已打开，请在官网完成登录；程序不会代填官网密码或接受协议。` });
    }
    async waitForReady(config, control, signal) {
        let deadline = Date.now() + 300000, previous = '';
        while (Date.now() < deadline) {
            deadline += await this.check(control, signal);
            await this.clearPromotions(this.page, control, signal);
            const state = await readAfterNavigation(this.page, () => this.page.evaluate(inspectReadiness, {
                editor: this.selected.editor, requireLogin: this.selected.loginRequired || config.webLogin === 'login'
            }), { check: () => this.check(control, signal), pause: this.pause });
            if (state.ready) {
                this.approved = true;
                this.onState({ approved: true, needsAction: false, phase: '聊天页面可用，自动继续', note: '' });
                return;
            }
            if (state.openLogin) await this.promptLogin(this.page, control, signal);
            this.approved = false;
            if (previous !== state.kind) {
                previous = state.kind;
                this.onState({ approved: false, needsAction: state.kind !== 'loading',
                    phase: state.kind === 'loading' ? '正在等待聊天页面加载' : '等待本人处理 AI 官网提示', note: state.note });
            }
            await this.pause(1000, undefined, signal ? { signal } : undefined);
        }
        throw new Error('等待 AI 聊天页面可用超时；请核对官网提示后重试，题目尚未发送');
    }
    async check(control, signal) {
        if (signal?.aborted) throw new Error('网页任务已取消');
        const waited = await control?.checkpoint() || 0;
        if (signal?.aborted) throw new Error('网页任务已取消');
        await ensureRendered(this.page);
        return waited;
    }
    async freshConversation(id, control, signal) {
        await this.check(control, signal);
        if (this.quizId === id && this.page && !this.page.isClosed()) return this.page;
        if (this.sent.has(id)) throw new Error('本测验已尝试发送，但原会话已关闭；请手动找回该会话的答案，避免重复发送');
        const previous = this.page;
        this.onState({ phase: '正在准备本次测验的新会话', note: '' });
        this.page = await this.context.newPage();
        await this.preparePage(this.page);
        await this.go(this.page, this.selected.url);
        await this.waitForReady(this.sessionConfig, control, signal);
        await this.check(control, signal);
        this.page.setDefaultTimeout(10000);
        const button = this.selected.newChat ? this.page.locator(this.selected.newChat).first()
            : this.page.getByRole('button', { name: this.selected.newChatName }).first();
        await button.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
        await this.check(control, signal);
        if (await button.isVisible().catch(() => false)) {
            try { await button.click(); } catch (error) { if (!navigationInterrupted(error)) throw error; }
        } else {
            const link = this.selected.newChatName && this.page.getByRole('link', { name: this.selected.newChatName }).first();
            if (link && await link.isVisible().catch(() => false)) await link.click();
            else {
                const text = this.page.getByText(this.selected.newChatName || /^新对话/, { exact: true }).first();
                if (await text.isVisible().catch(() => false)) await text.click();
                else throw new Error('尚未识别官网的新会话入口，请在官网手动开启新会话后复制题目作答');
            }
        }
        await this.waitForReady(this.sessionConfig, control, signal);
        await this.page.locator(this.selected.editor).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 10000 });
        await this.check(control, signal);
        // SPA routes and server redirects can occur after the editor first appears.
        // Observe an empty editor and conversation repeatedly before entering a paper.
        let empty = 0;
        for (let attempt = 0; attempt < 30 && empty < 3; attempt++) {
            await this.check(control, signal);
            const initial = await this.read(this.page, {}, control, signal);
            const editor = this.page.locator(this.selected.editor).filter({ visible: true }).first();
            const text = await readAfterNavigation(this.page, () => editor.evaluate(readEditorText),
                { check: () => this.check(control, signal), pause: this.pause });
            empty = !initial.copies && !initial.assistantReplies && !initial.streaming && !initial.blocked && !text.trim() ? empty + 1 : 0;
            if (empty < 3) await this.pause(300);
        }
        if (empty < 3) throw new Error('官网尚未进入空白新会话，请核对登录、验证或新会话入口后点击继续');
        this.quizId = id;
        if (previous && !previous.isClosed()) await previous.close();
        this.onState({ phase: '新会话已开启', quizId: id, sent: false, note: '' });
        return this.page;
    }
    async read(page, args, control, signal) {
        await this.clearPromotions(page, control, signal);
        return readAfterNavigation(page, () => page.evaluate(inspectChat, args),
            { check: () => this.check(control, signal), pause: this.pause });
    }
    async answer({ id, prompt, questions, config, control, signal }) {
        await this.check(control, signal);
        if (this.sent.has(id) && (!this.page || this.page.isClosed())) throw new Error('本测验已尝试发送，但原会话已关闭；请手动找回答案，避免重复发送');
        await this.connect(config, signal);
        if (signal?.aborted || control?.stopped) { await this.close(); await this.check(control, signal); }
        await this.waitForReady(config, control, signal);
        const page = await this.freshConversation(id, control, signal);
        await this.waitForReady(config, control, signal);
        if (!this.sent.has(id)) {
            await this.check(control, signal);
            const editor = page.locator(this.selected.editor).filter({ visible: true }).first();
            const existing = await readAfterNavigation(page, () => editor.evaluate(readEditorText),
                { check: () => this.check(control, signal), pause: this.pause });
            if (existing.trim() && existing.trim() !== prompt.trim()) throw new Error('聊天输入框已有其他文字，请在官网核对本次题目');
            await editor.fill(prompt);
            await this.check(control, signal);
            if (this.selected.send) {
                const send = page.locator(this.selected.send).first();
                if (!await send.isEnabled() || await send.getAttribute('aria-disabled') === 'true') throw new Error('官网发送按钮尚未启用，请核对页面加载、登录或验证提示');
                this.sent.add(id);
                try { await send.click(); } catch (error) { if (!navigationInterrupted(error)) throw error; }
            } else {
                const send = page.getByRole('button', { name: this.selected.sendName }).first();
                this.sent.add(id);
                try {
                    if (await send.isVisible().catch(() => false)) await send.click();
                    else await editor.press('Enter');
                } catch (error) { if (!navigationInterrupted(error)) throw error; }
            }
            this.onState({ phase: '正在等待网页回复', sent: true });
        }
        let previous = '', stable = 0, lastStatus = '', blockedSince = 0;
        let deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
            deadline += await this.check(control, signal);
            if (page.isClosed()) throw new Error('聊天网页已关闭，请将答案手动粘贴回工作台');
            const snapshot = await this.read(page, { prompt }, control, signal);
            if (snapshot.refusal && !snapshot.streaming) throw new Error(`${this.selected.name}未提供答案：${snapshot.refusal.slice(0,100)}。请更换答题方式或在官网核对，不会自动重发。`);
            if (snapshot.blocked) {
                blockedSince ||= Date.now();
                if (Date.now() - blockedSince > 300000) throw new Error('等待官网验证恢复超时，处理后可继续读取本次回复');
                if (lastStatus !== 'blocked') {
                    lastStatus = 'blocked';
                    this.onState({ phase: '等待本人处理 AI 官网提示', needsAction: true,
                        note: '请在官网完成验证或处理访问限制，恢复后自动继续读取，不会重复发送。' });
                }
                stable = 0; previous = '';
                await this.pause(1000, undefined, signal ? { signal } : undefined);
                deadline += 1000;
                continue;
            }
            blockedSince = 0;
            const text = completeReply(snapshot, questions);
            const status = snapshot.streaming ? 'AI 正在生成回复' : text ? '已读到整卷答案，正在确认回复结束'
                : snapshot.candidates.length ? `等待 ${questions.length} 道题的完整答案及回复结束标记` : '题目已发送，等待 AI 回复';
            if (status !== lastStatus) { lastStatus = status; this.onState({ phase: status, sent: true, needsAction: false, note: '' }); }
            stable = text && text === previous ? stable + 1 : 0;
            previous = text;
            if (text && stable >= (snapshot.copies ? 3 : 7)) { this.onState({ phase: '已读取完整网页答案' }); return text; }
            await this.pause(1000, undefined, signal ? { signal } : undefined);
        }
        throw new Error('等待网页答案超时，请使用官网复制按钮，将完整答案粘贴回工作台');
    }
    async close() {
        const context = this.context;
        this.context = null; this.page = null; this.quizId = null; this.approved = false;
        this.sent.clear();
        if (context) await context.close().catch(() => {});
        this.onState({ opened: false, approved: false, needsAction: false, phase: '等待连接 AI 官网', note: '' });
    }
}

module.exports = { WebChat, inspectChat, completeReply };
