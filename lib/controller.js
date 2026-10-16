const { EventEmitter } = require('node:events');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { settings } = require('./settings');
const { parseAnswers } = require('./answer-format');
const { answerSignature } = require('./answer-router');

class AppController extends EventEmitter {
    constructor({ config = settings(), createWorker = fork, logFile = null } = {}) {
        super();
        this.config = { ...config };
        this.createWorker = createWorker;
        this.logFile = logFile;
        this.sequence = 0;
        this.secrets = new Set([config.password, config.key].filter(Boolean));
        this.state = { phase: '尚未连接', connected: false, busy: false, paused: false,
            operation: '', stopping: false, webConnecting: false, answer: null, verification: null,
            courses: [], progress: null, results: [], pending: null, web: {}, logs: [], error: '' };
    }
    snapshot() {
        const { username, browser, model, endpoint, provider, password, key, webPlatform, webLogin, webAutomation } = this.config;
        return { ...this.state, version: require('../package.json').version, settings: { username, browser, model, endpoint, provider, webPlatform, webLogin, webAutomation,
            hasPassword: Boolean(password), hasKey: Boolean(key) } };
    }
    log(text, level = 'info') {
        for (const secret of this.secrets) text = text.split(secret).join('[已隐藏]');
        this.state.logs.push({ id: ++this.sequence, time: new Date().toISOString(), text, level });
        if (this.logFile) {
            try {
                fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
                if (fs.existsSync(this.logFile) && fs.statSync(this.logFile).size > 1048576) fs.writeFileSync(this.logFile, '');
                fs.appendFileSync(this.logFile, JSON.stringify(this.state.logs.at(-1)) + '\n', 'utf8');
            } catch {} // Logging must not interrupt course operations.
        }
        if (this.state.logs.length > 400) this.state.logs.splice(0, this.state.logs.length - 400);
    }
    save(input = {}) {
        if (this.state.stopping) throw new Error('正在停止任务，请等待结束后修改设置');
        const values = {};
        for (const name of ['username', 'password', 'key', 'browser', 'model', 'endpoint', 'provider', 'webPlatform', 'webLogin', 'webAutomation']) {
            if (typeof input[name] !== 'string') continue;
            if (['password', 'key'].includes(name) && !input[name]) continue;
            values[name] = name === 'password' ? input[name] : input[name].trim();
        }
        if (input.clearPassword) values.password = '';
        if (input.clearKey) values.key = '';
        const changes = Object.fromEntries(Object.entries(values).filter(([name, value]) => this.config[name] !== value));
        if (this.state.busy && ['username', 'password', 'browser'].some(name => name in changes)) throw new Error('账号和学习浏览器需在停止任务后更改；答题设置可以运行中应用');
        if (this.state.connected && values.username !== undefined && values.username !== this.config.username) throw new Error('切换账号请先点击“退出账号”');
        if (values.browser !== undefined && !['auto', 'chrome', 'msedge', 'chromium'].includes(values.browser)) throw new Error('浏览器设置无效');
        if (values.provider !== undefined && !['api', 'web'].includes(values.provider)) throw new Error('答题方式无效');
        if (values.webPlatform !== undefined && !['doubao', 'qianwen', 'deepseek'].includes(values.webPlatform)) throw new Error('网页平台无效');
        if (values.webLogin !== undefined && !['guest', 'login'].includes(values.webLogin)) throw new Error('网页登录方式无效');
        if (values.webAutomation !== undefined && !['auto', 'manual'].includes(values.webAutomation)) throw new Error('网页操作方式无效');
        if (values.endpoint) {
            const address = new URL(values.endpoint);
            if (address.protocol !== 'https:' || address.username || address.password) throw new Error('接口地址请使用 HTTPS 地址');
            values.endpoint = values.endpoint.replace(/\/(?:chat\/completions)?\/?$/, '');
        }
        const previousAnswer = answerSignature(this.config);
        Object.assign(this.config, values);
        const answerChanged = previousAnswer !== answerSignature(this.config);
        for (const secret of [this.config.password, this.config.key].filter(Boolean)) this.secrets.add(secret);
        if ('browser' in changes && this.state.connected) Object.assign(this.state, { connected: false, courses: [], phase: '浏览器已更改，请重新连接' });
        if (Object.keys(changes).length && this.child) this.child.send({ type: 'configure', config: this.config });
        return { ...this.snapshot().settings, effect: answerChanged && this.state.answer ? '当前测验将按新设置重新取答；已发出的 API 请求仍可能计费。'
            : answerChanged && this.state.busy ? '答题设置已应用，从下一次获取测验答案时生效。' : '设置已应用到本次会话。' };
    }
    preview(input) {
        const draft = new AppController({ config: this.config });
        draft.save(input);
        return draft.config;
    }
    worker() {
        if (this.child) return this.child;
        const child = this.createWorker(path.join(__dirname, 'worker.js'), [], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true
        });
        this.child = child;
        for (const stream of [child.stdout, child.stderr]) {
            stream?.setEncoding?.('utf8');
            let tail = '';
            stream?.on('data', chunk => {
                const lines = (tail + chunk.toString('utf8')).split(/\r?\n/);
                tail = lines.pop();
                for (const line of lines) if (line.trim()) this.log(line);
            });
        }
        child.on('message', message => {
            if (message.type === 'state') Object.assign(this.state, message.value);
            if (message.type === 'progress') this.state.progress = ['course', 'unit'].includes(message.value.type)
                ? { ...message.value, position: 0, duration: 0, status: '' }
                : { ...this.state.progress, ...message.value };
            if (message.type === 'pending') this.state.pending = message.value;
            if (message.type === 'web-state') Object.assign(this.state.web, message.value);
            if (message.type === 'error') { this.state.error = message.message; this.log(message.message, 'error'); }
        });
        child.on('error', () => {
            this.state.busy = false;
            this.state.error = '运行进程启动失败，请重新启动程序';
            this.log(this.state.error, 'error');
        });
        child.on('exit', () => {
            if (this.child === child) this.child = null;
            Object.assign(this.state, { busy: false, operation: '', stopping: false, webConnecting: false,
                paused: false, connected: false, pending: null, answer: null, verification: null });
            Object.assign(this.state.web, { opened: false, approved: false });
        });
        return child;
    }
    command(type, input = {}) {
        if (this.state.stopping && type !== 'stop') throw new Error('正在停止任务，请等待结束后再操作');
        if (type === 'show-verification') {
            if (!this.state.verification || !this.child) throw new Error('当前没有等待处理的 UOOC 验证');
            this.child.send({ type });
            return;
        }
        if (type === 'web-connect') {
            if (this.state.webConnecting) throw new Error('AI 官网正在连接，请稍后再试');
            if (this.config.provider !== 'web') throw new Error('请先选择网页答题并应用设置');
            this.state.webConnecting = true;
            this.state.error = '';
            try { this.worker().send({ type, config: this.config }); }
            catch (error) { this.state.webConnecting = false; throw error; }
            return;
        }
        if (type === 'web-ready') {
            if (!this.state.web.opened || !this.child) throw new Error('请先打开并连接 AI 官网');
            this.state.error = '';
            this.child.send({ type });
            return;
        }
        if (['pause', 'resume', 'stop'].includes(type)) {
            if (!this.child) return;
            if (type !== 'stop' && (!this.state.busy || this.state.operation !== 'run')) throw new Error('开始课程任务后才能暂停或继续');
            if (type === 'stop') { this.state.phase = '正在停止'; this.state.stopping = true; }
            this.child.send({ type });
            return;
        }
        if (this.state.busy) throw new Error('当前操作尚未结束，请先停止任务，再连接账号、更改课程或退出账号');
        if (!['connect', 'run', 'logout'].includes(type)) throw new Error('未知操作');
        if (type === 'run') {
            if (!this.state.connected) throw new Error('请先连接 UOOC 并加载课程');
            if (!['video', 'quiz', 'quiz-one', 'inspect'].includes(input.mode)) throw new Error('请选择运行模式');
            if (!Array.isArray(input.ids) || !input.ids.length || input.ids.some(id => !this.state.courses.some(course => course.id === id))) throw new Error('请勾选当前课程列表中的课程');
            this.state.results = [];
            this.state.progress = null;
        }
        this.state.error = '';
        this.state.busy = true;
        this.state.operation = type;
        this.state.phase = type === 'run' ? '准备运行' : '正在连接浏览器';
        try { this.worker().send({ type, config: this.config, ids: input.ids, mode: input.mode }); }
        catch (error) { this.state.busy = false; throw error; }
    }
    validate(text, id) {
        const pending = this.state.pending;
        if (!pending || pending.id !== id) throw new Error('当前待答测验已变化，请刷新后重试');
        const answers = parseAnswers(text, pending.questions);
        return answers.map((values, index) => ({ number: pending.questions[index].number, values }));
    }
    answer(text, id) {
        const preview = this.validate(text, id);
        this.child.send({ type: 'answer', id, text });
        return preview;
    }
    skip(id) {
        if (!this.state.pending || this.state.pending.id !== id) throw new Error('当前待答测验已变化');
        this.child.send({ type: 'skip', id });
        this.state.pending = null;
    }
    async close() {
        if (!this.child) return;
        const child = this.child;
        await new Promise(resolve => {
            const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
            child.send({ type: 'stop' });
            child.disconnect();
        });
    }
}

module.exports = { AppController };
