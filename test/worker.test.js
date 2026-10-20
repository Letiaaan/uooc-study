const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
process.env.UOOC_STUDY_HOME = path.join(__dirname, '..', '.build', 'worker-fixture');
const { startWorker } = require('../lib/worker');

test('stop keeps the login context and cached courses, then runs a different selection without reconnecting', { timeout: 5000 }, async () => {
    const channel = new EventEmitter(), events = new EventEmitter();
    const messages = [], aggregate = {}, pages = [];
    let closes = 0, logins = 0, reads = 0, releaseRun;
    channel.connected = true;
    channel.send = message => { messages.push(message); if (message.type === 'state') Object.assign(aggregate, message.value); events.emit('output', message); };
    const wait = predicate => messages.find(predicate) || new Promise(resolve => {
        const receive = message => { if (predicate(message)) { events.off('output', receive); resolve(message); } };
        events.on('output', receive);
    });
    const makePage = () => {
        const page = Object.assign(new EventEmitter(), { closed: false, isClosed() { return this.closed; }, setDefaultTimeout() {},
            close: async () => { page.closed = true; if (releaseRun) { const release = releaseRun; releaseRun = null; release(); } },
            locator: () => ({ evaluateAll: async () => {} }) });
        pages.push(page); return page;
    };
    const original = makePage();
    const context = Object.assign(new EventEmitter(), { pages: () => pages.filter(page => !page.closed), newPage: async () => makePage(),
        close: async () => { closes++; context.emit('close'); } });
    const config = { browser: 'chrome', provider: 'web', webPlatform: 'doubao' };
    const runs = [];
    startWorker({ channel, open: async () => context, login: async () => { logins++; },
        readCourses: async () => { reads++; return [{ id: '1', title: 'First' }, { id: '2', title: 'Second' }]; },
        createWebChat: () => ({ close: async () => {} }), createNotice: () => ({ update() {} }),
        run: async (page, course, mode, { control }) => {
            runs.push({ page, id: course.id });
            if (course.id === '1') { await new Promise(resolve => { releaseRun = resolve; }); await control.checkpoint(); }
            return [];
        }
    });
    channel.emit('message', { type: 'connect', config });
    await wait(message => message.type === 'state' && message.value.busy === false);
    channel.emit('message', { type: 'run', config, ids: ['1'], mode: 'video' });
    await new Promise(resolve => setImmediate(resolve));
    channel.emit('message', { type: 'stop' });
    await wait(message => message.type === 'state' && message.value.phase === '已停止，可重新选课并开始');
    assert.equal(closes, 0);
    assert.equal(original.closed, true);
    assert.equal(aggregate.connected, true);
    assert.equal(aggregate.busy, false);
    assert.equal(aggregate.courses.length, 2);
    channel.emit('message', { type: 'run', config, ids: ['2'], mode: 'quiz' });
    await wait(message => message.type === 'state' && message.value.phase === '本轮处理结束');
    assert.equal(runs[1].id, '2');
    assert.notEqual(runs[1].page, original);
    assert.equal(logins, 1); assert.equal(reads, 1);
    channel.emit('disconnect');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closes, 1);
});

test('web collaboration carries a complete paper through IPC and resumes with validated selections', async () => {
    const channel = new EventEmitter();
    const events = new EventEmitter();
    const messages = [];
    channel.connected = true;
    channel.send = message => { messages.push(message); events.emit('output', message); };
    const next = predicate => {
        const existing = messages.find(predicate);
        if (existing) return Promise.resolve(existing);
        return new Promise(resolve => {
            const handle = message => { if (predicate(message)) { events.off('output', handle); resolve(message); } };
            events.on('output', handle);
        });
    };
    const context = Object.assign(new EventEmitter(), { pages: () => [page], close: async () => context.emit('close') });
    const page = { isClosed: () => false, setDefaultTimeout: () => {} };
    const config = { username: '', password: '', key: '', browser: 'auto', provider: 'web', webAutomation: 'manual', webPlatform: 'doubao' };
    const questions = [{ number: 1, text: '样例问题', kind: 'single', blanks: 0, options: [{ letter: 'A', text: '甲' }, { letter: 'B', text: '乙' }] }];
    let filled;
    startWorker({ channel, open: async () => context, login: async () => {}, readCourses: async () => [{ id: '1', title: '样例课程' }],
        solveAPI: async () => assert.fail('Web collaboration must not issue API request'),
        run: async (page, course, mode, { solve }) => {
            assert.equal(mode, 'quiz');
            filled = await solve(questions);
            return [{ title: '样例测验', status: '已填写' }];
        }
    });
    channel.emit('message', { type: 'connect', config });
    await next(message => message.type === 'state' && message.value.connected);
    await next(message => message.type === 'state' && message.value.busy === false);
    channel.emit('message', { type: 'run', config, ids: ['1'], mode: 'quiz' });
    const pending = await next(message => message.type === 'pending' && message.value);
    assert.match(pending.value.prompt, /只输出题号和答案/);
    channel.emit('message', { type: 'answer', id: pending.value.id, text: '1.C' });
    await next(message => message.type === 'error');
    assert.equal(filled, undefined);
    channel.emit('message', { type: 'answer', id: pending.value.id, text: '1.B' });
    await next(message => message.type === 'state' && message.value.phase === '本轮处理结束');
    assert.deepEqual(filled, [['B']]);
    const saved = messages.find(message => message.type === 'web-state' && message.value.lastFile);
    assert.equal(require('node:fs').readFileSync(saved.value.lastFile, 'utf8'), '1.B\n');
    channel.emit('disconnect');
});

test('automatic web answers save each paper with no web-ready IPC or API call', async () => {
    const channel = new EventEmitter();
    const messages = [], events = new EventEmitter();
    channel.connected = true;
    channel.send = message => { messages.push(message); events.emit('output', message); };
    const next = predicate => messages.some(predicate) ? Promise.resolve(messages.find(predicate)) : new Promise(resolve => {
        const handle = message => { if (predicate(message)) { events.off('output', handle); resolve(message); } };
        events.on('output', handle);
    });
    const page = { isClosed: () => false, setDefaultTimeout() {} };
    const context = Object.assign(new EventEmitter(), { pages: () => [page], close: async () => {} });
    const questions = [{ number: 1, text: '样例', kind: 'single', blanks: 0, options: [{ letter: 'A', text: '甲' }] }];
    const config = { provider: 'web', webPlatform: 'qianwen', webLogin: 'guest', webAutomation: 'auto', browser: 'auto' };
    const filled = [], ids = [];
    startWorker({ channel, open: async () => context, login: async () => {}, readCourses: async () => [{ id: '1', title: '样例' }],
        solveAPI: async () => assert.fail('Web mode must not call the API'),
        createWebChat: ({ onState }) => ({
            context, page, approved: false, approve() { this.approved = true; }, close: async () => {},
            async answer(task) {
                assert.equal(task.config.webPlatform, 'qianwen');
                onState({ opened: true });
                ids.push(task.id);
                return '1.A';
            }
        }),
        run: async (page, course, mode, { solve }) => {
            filled.push(await solve(questions));
            filled.push(await solve(questions));
            return [];
        }
    });
    channel.emit('message', { type: 'connect', config });
    await next(message => message.type === 'state' && message.value.busy === false);
    channel.emit('message', { type: 'run', config, ids: ['1'], mode: 'quiz' });
    await next(message => message.type === 'state' && message.value.phase === '本轮处理结束');
    assert.deepEqual(filled, [[['A']], [['A']]]);
    assert.equal(new Set(ids).size, 2);
    const files = messages.filter(message => message.type === 'web-state' && message.value.lastFile).map(message => message.value.lastFile);
    assert.equal(new Set(files).size, 2);
    channel.emit('disconnect');
});

test('worker starts UOOC in the background, applies live reminder settings and ignores resolved notice links', { timeout: 5000 }, async () => {
    const channel = new EventEmitter(), events = new EventEmitter();
    const messages = [], updates = [];
    let callbacks, finishLogin, shown = 0;
    channel.connected = true;
    channel.send = message => { messages.push(message); events.emit('output', message); };
    const next = predicate => messages.find(predicate) || new Promise(resolve => {
        const handle = message => { if (predicate(message)) { events.off('output',handle); resolve(message); } };
        events.on('output',handle);
    });
    const gate = new Promise(resolve => { finishLogin = resolve; });
    const page = { isClosed: () => false, setDefaultTimeout() {}, bringToFront: async () => { shown++; } };
    const context = Object.assign(new EventEmitter(), {pages: () => [page], close: async () => {}});
    const config = {browser:'chrome',provider:'web',verificationPopup:true};
    startWorker({channel, open: async options => { assert.equal(options.background,true); return context; },
        createNotice: options => { callbacks=options; return {update: (value,enabled) => updates.push({value,enabled})}; },
        login: async (tab,get,{onVerify}) => { onVerify({kind:'login',message:'fixture challenge'}); await gate; },
        readCourses: async () => [{id:'1',title:'fixture'}]
    });
    channel.emit('message',{type:'connect',config});
    const pending = await next(message => message.type==='state' && message.value.verification);
    const id = pending.value.verification.id;
    assert.equal(shown,0);
    callbacks.onOpen(id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(shown,1);
    channel.emit('message',{type:'configure',config:{...config,verificationPopup:false}});
    assert.equal(updates.at(-1).enabled,false);
    assert.equal(updates.at(-1).value.id,id);
    channel.emit('message',{type:'show-verification'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(shown,2);
    finishLogin();
    await next(message => message.type==='state' && message.value.busy===false);
    assert.equal(updates.at(-1).value,null);
    callbacks.onOpen(id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(shown,2);
    channel.emit('disconnect');
});
