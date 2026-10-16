const { CourseSite, unitKey } = require('./site');
const { Journal } = require('./journal');
const { playResource } = require('./media');
const { processQuiz } = require('./quiz');
const { printReport } = require('./console');
const { Control } = require('./control');

async function pauseMedia(page) {
    if (!page.isClosed()) await page.locator('video').evaluateAll(videos => videos.forEach(video => video.pause())).catch(() => {});
}

function orderUnits(units, resume) {
    if (!resume) return units;
    const index = units.findIndex(unit => unitKey(unit) === unitKey(resume));
    return index < 0 ? units : [units[index], ...units.slice(0, index), ...units.slice(index + 1)];
}

async function runCourse(page, course, mode, { control = new Control(), onProgress = () => {}, solve, onVerify = () => {}, onQuizPassed = () => {},
    quizLimit = Infinity, onQuizAttempt = () => {}, handleQuiz = processQuiz } = {}) {
    const site = new CourseSite(page, course);
    const journal = new Journal(course);
    const prior = new Map(journal.latest);
    const rows = new Map();
    const blocked = new Map();
    const quizzes = new Map();
    let attempted = 0;
    const put = (source, status, reason) => {
        rows.set(`${unitKey(source.unit)}:${source.id}`, { title: source.title, status, reason });
        if (mode !== 'inspect') journal.record(source, status, reason ? { reason } : {});
        onProgress({ type: 'resource', course: course.title, title: source.title, status, rows: [...rows.values()] });
    };
    const pending = (unit, reason) => {
        blocked.set(unitKey(unit), unit);
        rows.set(`unit:${unitKey(unit)}`, { title: unit.title, status: '目录待处理', reason });
    };

    async function video(source) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await control.checkpoint();
                await site.openResource(source);
                const status = await playResource(site, source, journal, { control, onProgress });
                put(source, status);
                return;
            } catch (error) {
                if (control.stopped) throw error;
                if (error.code === 'STALLED' && !attempt) {
                    console.log('  播放停滞，重新加载当前资源一次。');
                    await site.refreshUnit(source.unit);
                    continue;
                }
                put(source, '视频待处理', error.message);
                return;
            } finally { await pauseMedia(page); }
        }
    }

    async function visit(unit) {
        try {
            await control.checkpoint();
            console.log(`\n${unit.title}`);
            onProgress({ type: 'unit', course: course.title, title: unit.title });
            const current = await site.visit(unit);
            await pauseMedia(page);
            if (current.reason) { pending(unit, current.reason); return; }
            blocked.delete(unitKey(unit));
            rows.delete(`unit:${unitKey(unit)}`);
            for (const source of current.sources) {
                if (attempted >= quizLimit) break;
                await control.checkpoint();
                if (source.finished) put(source, '网站确认完成');
                else if (mode === 'inspect') put(source, '尚未完成', source.type);
                else if (source.type === 'video' && mode === 'video') await video(source);
                else if (source.type === 'quiz' && !/期末|考试|exam/i.test(source.title)) {
                    const previous = prior.get(source.id);
                    put(source, /提交|通过|待本人确认/.test(previous?.status || '') ? previous.status : '测验待处理');
                    if (mode === 'quiz') await quiz(source);
                    else quizzes.set(`${unitKey(unit)}:${source.id}`, source);
                } else put(source, '待本人处理', source.type);
            }
        } catch (error) {
            if (page.isClosed() || control.stopped) throw error;
            pending(unit, error.message);
        } finally { await pauseMedia(page); }
    }

    async function quiz(source) {
        let opened;
        let submitted = false;
        let pagePassed = false;
        const quizKey = `${course.id}:${unitKey(source.unit)}:${source.id}`;
        let passNotified = false;
        const passed = async () => { if (!passNotified) { passNotified = true; await onQuizPassed(quizKey); } };
        try {
            await control.checkpoint();
            const previous = prior.get(source.id);
            if (mode === 'video' && /提交|通过|待本人确认/.test(previous?.status || '')) {
                put(source, '测验待本人确认', '上次测验已有处理记录，请在网站核对结果后选择测验模式');
                return;
            }
            put(source, '正在打开测验');
            opened = await site.openResource(source);
            put(source, '正在读取测验');
            const outcome = await handleQuiz(opened.page, () => {
                submitted = true;
                journal.record(source, '提交中');
            }, { solve: solve && (questions => solve(questions, quizKey)), control, onVerify: value => onVerify(value, opened.page) });
            put(source, outcome);
            if (outcome === '页面确认通过') { pagePassed = true; await passed(); }
            const current = await site.refreshUnit(source.unit);
            const updated = current.sources.find(item => item.id === source.id);
            if (updated?.finished && outcome !== '未通过') { pagePassed = true; put(source, '网站确认完成'); await passed(); }
        } catch (error) {
            if (control.stopped) throw error;
            if (error.details) console.log(`测验诊断：${JSON.stringify(error.details)}`);
            put(source, pagePassed ? '页面确认通过' : submitted ? '提交结果待确认' : '测验待处理', error.message);
        } finally {
            attempted++;
            onQuizAttempt();
            const retained = opened?.popup && !opened.page.isClosed() && !pagePassed && !control.stopped;
            if (retained) {
                console.log('本次测验未确认通过，测验窗口已保留，不会自动关闭。');
                onVerify({ kind: 'quiz-review', message: '测验未确认通过，已保留原页面。请查看运行记录中的原因及测验页面；程序没有自动重交。' }, opened.page);
            } else {
                onVerify(null);
                if (opened?.popup && !opened.page.isClosed()) await opened.page.close();
            }
            await pauseMedia(page);
        }
    }

    try {
        console.log(`\n课程：${course.title}`);
        onProgress({ type: 'course', course: course.title, title: '正在读取课程目录', position: 0, duration: 0 });
        const catalog = await site.open();
        const units = mode === 'video' ? orderUnits(catalog, journal.resumeUnit()) : catalog;
        await pauseMedia(page);
        for (const unit of units) {
            if (attempted >= quizLimit) break;
            await visit(unit);
        }
        if (mode === 'video' && blocked.size) {
            console.log('\n部分目录受阻，处理已发现的独立测验后重新检查。');
            for (const source of quizzes.values()) await quiz(source);
            const retryUnits = [...blocked.values()];
            for (const unit of retryUnits) await visit(unit);
        }
    } finally {
        await pauseMedia(page);
        site.close();
        printReport(course, [...rows.values()]);
    }
    return [...rows.values()];
}

module.exports = { runCourse, orderUnits, pauseMedia };
