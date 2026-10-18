const { randomUUID } = require('node:crypto');
const { buildPrompt } = require('./answer-format');
const { showPage } = require('./window-rendering');

function answerSignature(config) {
    const fields = config.provider === 'web'
        ? ['provider', 'webPlatform', 'webLogin', 'webAutomation', 'browser'] : ['provider', 'key', 'model', 'endpoint'];
    return JSON.stringify(fields.map(name => config[name]));
}

class AnswerRouter {
    constructor({ config, chat, solveAPI, storeAnswer, onPending = () => {}, onAnswer = () => {}, onWeb = () => {}, onError = () => {} }) {
        Object.assign(this, { config, chat, solveAPI, storeAnswer, onPending, onAnswer, onWeb, onError });
        this.webQueue = Promise.resolve();
        this.saved = new Map();
    }
    enqueue(action) {
        const result = this.webQueue.then(action);
        this.webQueue = result.catch(() => {});
        return result;
    }
    current(task, route) { return this.active === task && task.route === route && !route.abort.signal.aborted; }
    solve(questions, control, quizKey = randomUUID()) {
        return new Promise((resolve, reject) => {
            const task = { questions, control, quizKey, resolve, reject };
            task.cancel = () => this.finish(task, new Error('任务已停止'));
            this.active = task;
            control.abort.signal.addEventListener('abort', task.cancel, { once: true });
            if (control.stopped) task.cancel(); else this.start(task);
        });
    }
    start(task) {
        task.route?.abort.abort();
        const route = { id: randomUUID(), config: { ...this.config() }, abort: new AbortController(), autoBusy: false };
        task.route = route;
        this.pending = route.config.provider === 'web' ? route : null;
        this.onPending(this.pending ? { id: route.id, questions: task.questions, prompt: buildPrompt(task.questions), count: task.questions.length } : null);
        this.onAnswer({ id: route.id, provider: route.config.provider, count: task.questions.length });
        void this.continue();
    }
    update() {
        const task = this.active;
        if (task && answerSignature(task.route.config) !== answerSignature(this.config())) this.start(task);
    }
    async continue() {
        const task = this.active, route = task?.route;
        if (!task || route.autoBusy) return;
        route.autoBusy = true;
        if (route.config.provider === 'web') this.onWeb({ working: true, retryable: false, note: '' });
        try {
            if (route.config.provider === 'web') {
                await this.enqueue(async () => {
                    if (!this.current(task, route)) return;
                    await task.control.checkpoint();
                    if (!this.current(task, route)) return;
                    if (route.config.webAutomation === 'manual') {
                        await this.chat.connect?.(route.config, route.abort.signal);
                        await this.chat.waitForReady?.(route.config, task.control, route.abort.signal);
                        await this.chat.freshConversation?.(route.id, task.control, route.abort.signal);
                        if (this.current(task, route)) this.onWeb({ phase: '手动模式：新会话已开启，请复制题目并粘贴回复' });
                    } else {
                        const text = await this.chat.answer({ id: route.id, prompt: buildPrompt(task.questions), questions: task.questions,
                            config: route.config, control: task.control, signal: route.abort.signal });
                        if (text && this.current(task, route)) this.paste(text, route.id);
                    }
                });
            } else {
                await task.control.checkpoint();
                if (!this.current(task, route)) return;
                const answers = await this.solveAPI(task.questions, route.config, fetch,
                    AbortSignal.any([task.control.abort.signal, route.abort.signal]));
                if (this.current(task, route)) this.finish(task, null, answers);
            }
        } catch (error) {
            if (!this.current(task, route)) return;
            if (route.config.provider === 'web') {
                this.onWeb({ phase: '网页步骤中断，可以继续或粘贴答案', retryable: true,
                    sent: Boolean(this.chat.sent?.has(route.id)), note: error.message });
                this.onError(error.message);
            } else this.finish(task, error);
        } finally {
            route.autoBusy = false;
            if (!this.active || this.current(task, route)) this.onWeb({ working: false });
        }
    }
    paste(text, id) {
        const task = this.active, route = task?.route;
        if (!task || !this.pending || route.id !== id || !this.current(task, route)) throw new Error('当前待答测验已变化，请刷新后重试');
        const result = this.storeAnswer(text, task.questions, { platform: route.config.webPlatform, id, quizKey: task.quizKey });
        const records = this.saved.get(task.quizKey) || [];
        records.push(result); this.saved.set(task.quizKey, records);
        this.lastFile = result.file;
        this.onWeb({ lastFile: result.file, phase: '答案已保存，正在继续测验', note: '', retryable: false });
        this.finish(task, null, result.answers);
    }
    passed(quizKey) {
        const records = this.saved.get(quizKey) || [];
        const remaining = [];
        for (const record of records) {
            try {
                record.cleanup?.();
                this.onWeb({ ...(this.lastFile === record.file ? { lastFile: null } : {}), phase: '网站确认通过，已清理本次临时答案' });
            } catch (error) { remaining.push(record); this.onError(`测验已通过，但临时文件清理失败：${error.message}`); }
        }
        if (remaining.length) this.saved.set(quizKey, remaining); else this.saved.delete(quizKey);
    }
    skip(id) {
        if (this.pending?.id === id) this.finish(this.active, new Error('本次测验已跳过，可稍后重新处理'));
    }
    finish(task, error, answers) {
        if (!task || this.active !== task) return;
        task.route?.abort.abort();
        task.control.abort.signal.removeEventListener('abort', task.cancel);
        this.active = null; this.pending = null;
        this.onPending(null); this.onAnswer(null);
        if (error) task.reject(error); else task.resolve(answers);
    }
    async openWebsite() {
        const route = this.active?.route;
        if (route?.config.provider === 'web' && route.autoBusy) {
            if (this.chat.page && !this.chat.page.isClosed()) { await showPage(this.chat.page); return; }
            throw new Error('AI 官网正在连接，请稍后再试');
        }
        this.connectionAbort?.abort();
        const abort = this.connectionAbort = new AbortController();
        const config = { ...this.config() };
        await this.enqueue(async () => {
            if (abort.signal.aborted) return;
            await this.chat.connect(config, abort.signal);
            if (!abort.signal.aborted && this.chat.page && !this.chat.page.isClosed()) await showPage(this.chat.page);
        });
    }
    async close() {
        this.connectionAbort?.abort();
        if (this.active) this.finish(this.active, new Error('任务已停止'));
        await this.chat.close();
        await this.webQueue;
    }
}

module.exports = { AnswerRouter, answerSignature };
