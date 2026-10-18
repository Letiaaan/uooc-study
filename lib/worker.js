const { openBrowser, backgroundPage } = require('./browser');
const { ensureLogin, listCourses, signOut } = require('./auth');
const { runCourse, pauseMedia } = require('./runner');
const { settings, setRuntimeSettings } = require('./settings');
const { solveQuestions } = require('./model');
const { AnswerRouter } = require('./answer-router');
const { saveAnswer } = require('./answer-store');
const { WebChat } = require('./web-chat');
const { Control } = require('./control');
const { randomUUID } = require('node:crypto');
const { VerificationNotice } = require('./window-attention');
const { ensureRendered, showPage } = require('./window-rendering');

function startWorker({ channel = process, open = openBrowser, login = ensureLogin, readCourses = listCourses,
    run = runCourse, solveAPI = solveQuestions, createWebChat = options => new WebChat(options), storeAnswer = saveAnswer,
    createNotice = options => new VerificationNotice(options) } = {}) {
    let context, page, control, browserSetting, verificationPage;
    let busy = false;
    let stopping = false;
    let courses = [];
    const send = (type, data) => { if (channel.connected) channel.send({ type, ...data }); };
    const state = value => send('state', { value });
    let webPhase;
    const webState = value => {
        if (value.phase && webPhase !== value.phase) { webPhase = value.phase; console.log(`AI 网页：${value.phase}`); }
        if (value.lastFile) console.log(`网页答案已保存：${value.lastFile}`);
        send('web-state', { value });
    };
    const chat = createWebChat({ onState: webState });
    let verificationValue;
    const showVerification = async (expected = verificationValue?.id) => {
        if (!verificationPage || verificationPage.isClosed()) throw new Error('当前验证页面已变化，请查看学习浏览器');
        const tab = verificationPage;
        await ensureRendered(tab);
        if (verificationValue?.id !== expected || verificationPage !== tab || tab.isClosed()) return;
        await showPage(tab);
    };
    const notice = createNotice({
        onOpen: id => { if (verificationValue?.id === id) void showVerification(id).catch(error => send('error', { message: error.message })); },
        onError: () => console.log('桌面提醒不可用，请在工作台“当前任务”查看提示并前往验证页面。')
    });
    const verify = (value, tab) => {
        verificationPage = value ? tab : null;
        verificationValue = value ? { ...value, id: randomUUID() } : null;
        state({ verification: verificationValue });
        notice.update(verificationValue, settings().verificationPopup !== false);
    };
    const answers = new AnswerRouter({ config: settings, chat, solveAPI, storeAnswer,
        onPending: value => send('pending', { value }), onWeb: webState,
        onError: message => send('error', { message }),
        onAnswer: value => state({ answer: value, error: '', ...(stopping ? {} : {
            phase: control?.paused ? '已暂停' : value ? value.provider === 'web' ? '等待网页答案' : '正在获取 API 答案' : '运行中'
        }) }) });

    async function browser() {
        if (context && browserSetting !== settings().browser) { await context.close(); context = null; }
        if (context && !page.isClosed()) return;
        if (context?.browser?.()?.isConnected()) {
            page = await backgroundPage(context);
            page.setDefaultTimeout(12000);
            return;
        }
        browserSetting = settings().browser;
        context = await open({ browser: browserSetting, background: true });
        page = await backgroundPage(context);
        page.setDefaultTimeout(12000);
        const ownedContext = context;
        context.on('close', () => {
            if (context === ownedContext) { context = null; page = null; state({ connected: false }); }
        });
        if (control?.stopped) { await context.close(); await control.checkpoint(); }
    }

    channel.on('message', async message => {
        if (message.type === 'show-verification') {
            try {
                await showVerification();
            } catch (error) { send('error', { message: error.message }); }
            return;
        }
        if (message.type === 'configure') {
            setRuntimeSettings(message.config || {});
            notice.update(verificationValue, settings().verificationPopup !== false);
            answers.update();
            if (!busy && context && browserSetting !== settings().browser) {
                await context.close().catch(() => {}); context = null;
                state({ connected: false, courses: [], phase: '浏览器已更改，请重新连接' });
            }
            return;
        }
        if (message.type === 'web-connect') {
            if (stopping) return;
            setRuntimeSettings(message.config || {});
            state({ webConnecting: true });
            try { await answers.openWebsite(); }
            catch (error) { if (!stopping) send('error', { message: error.message }); }
            finally { state({ webConnecting: false }); }
            return;
        }
        if (message.type === 'web-ready') {
            if (!chat.context || !chat.page || chat.page.isClosed()) { send('error', { message: '请先打开并连接 AI 官网' }); return; }
            chat.approve();
            void answers.continue();
            return;
        }
        if (message.type === 'pause' || message.type === 'resume') {
            if (!busy || !control) return;
            if (message.type === 'pause') {
                control.pause();
                if (context) for (const tab of context.pages()) await pauseMedia(tab);
            } else control.resume();
            state({ paused: control.paused, phase: control.paused ? '已暂停' : answers.pending ? '等待网页答案' : '运行中' });
            return;
        }
        if (message.type === 'stop') {
            if (stopping) return;
            stopping = true;
            state({ stopping: true, phase: '正在停止' });
            control?.stop();
            verify(null);
            if (context) await context.close().catch(() => {});
            await answers.close();
            context = null;
            stopping = false;
            state({ connected: false, paused: false, busy, stopping: false, phase: '已停止' });
            return;
        }
        if (message.type === 'skip') {
            answers.skip(message.id);
            return;
        }
        if (message.type === 'answer') {
            try {
                answers.paste(message.text, message.id);
            } catch (error) { send('error', { message: error.message }); }
            return;
        }
        if (busy || stopping) { send('error', { message: '当前操作尚未结束' }); return; }
        busy = true;
        control = new Control();
        setRuntimeSettings(message.config || {});
        state({ busy: true, operation: message.type, paused: false, phase: message.type === 'run' ? '运行中' : '正在连接浏览器' });
        try {
            await browser();
            if (message.type === 'logout') {
                await signOut(context, page);
                courses = [];
                state({ connected: false, courses, phase: '已退出账号' });
            } else {
                if (message.type === 'connect') {
                    state({ phase: '等待登录 / 读取课程' });
                    await login(page, async existing => existing, { control, onVerify: value => verify(value, page), onStatus: phase => state({ phase }) });
                    await control.checkpoint();
                    courses = await readCourses(page);
                    if (!courses.length) throw new Error('尚未找到课程，请在浏览器核对选课状态后刷新');
                    state({ courses, connected: true, phase: '已连接，等待开始' });
                } else if (message.type === 'run') {
                    const selected = courses.filter(course => message.ids.includes(course.id));
                    if (!selected.length) throw new Error('请先连接账号并勾选课程');
                    const results = [];
                    const solve = (questions, quizKey) => answers.solve(questions, control, quizKey);
                    for (const course of selected) {
                        await control.checkpoint();
                        const rows = await run(page, course, message.mode, {
                            control, solve, onProgress: value => send('progress', { value }), onVerify: verify,
                            onQuizPassed: quizKey => answers.passed(quizKey)
                        });
                        results.push({ course: course.title, rows });
                        state({ results });
                    }
                    state({ phase: '本轮处理结束' });
                } else throw new Error('未知操作');
            }
        } catch (error) {
            if (control.stopped) state({ phase: '已停止' });
            else { send('error', { message: error.message }); state({ phase: '需要处理' }); }
        } finally {
            verify(null);
            busy = false;
            state({ busy: stopping, operation: '', paused: false });
        }
    });
    channel.on('disconnect', () => {
        verify(null);
        control?.stop();
        Promise.allSettled([context?.close(), answers.close()]).finally(() => { if (channel === process) process.exit(); });
    });
}

if (require.main === module) startWorker();
module.exports = { startWorker };
