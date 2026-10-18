const { optionSets, answerVideoPrompt } = require('./video-prompt');
const { ensureRendered } = require('./window-rendering');
const { frameIsVisible } = require('./browser');

async function findVideo(page) {
    const until = Date.now() + 15000;
    do {
        const visible = [];
        for (const frame of page.frames?.() || [page]) {
            if (!await frameIsVisible(frame)) continue;
            for (const video of await frame.locator('video').all()) {
                if (await video.isVisible().catch(() => false)) visible.push(video);
            }
        }
        if (visible.length === 1) return visible[0];
        if (visible.length > 1) throw new Error('页面存在多个可见视频，无法确认当前课程播放器');
        await page.waitForTimeout(200);
    } while (Date.now() < until);
    throw new Error('尚未找到可见课程视频，请核对播放器加载与 iframe 页面');
}

async function playResource(site, source, journal, { control, onProgress = () => {}, onVerify = () => {}, now = Date.now } = {}) {
    const page = site.page;
    let video = await findVideo(page);
    const assertResource = () => {
        if (!page.url().split('#')[1]?.split('/').includes(source.id)) throw new Error('当前视频资源发生变化，已保留续跑记录');
    };
    const handlePrompt = () => answerVideoPrompt(page, control, { onVerify, onProgress: value => onProgress({ title: source.title, ...value }), assertResource });
    let previous = -1;
    let advanced = now();
    let recorded = 0;
    while (true) {
        const checkingAt = now();
        await control?.checkpoint();
        await ensureRendered(page);
        await handlePrompt();
        advanced += now() - checkingAt;
        if (page.isClosed()) throw new Error('课程窗口已关闭');
        assertResource();
        if (!await video.isVisible().catch(() => false)) video = await findVideo(page);
        const state = await video.evaluate(async element => {
            if (element.error) return { problem: `播放器错误 ${element.error.code}` };
            element.muted = true;
            element.playbackRate = 2;
            let denied = '';
            const blocked = [...element.ownerDocument.querySelectorAll('#quizLayer,.quizLayer')]
                .some(prompt => prompt.getClientRects().length && getComputedStyle(prompt).visibility !== 'hidden');
            if (element.paused && !element.ended && !blocked) {
                try { await element.play(); } catch { denied = '浏览器暂未允许播放，请在浏览器点击播放'; }
            }
            return {
                time: element.currentTime, duration: Number.isFinite(element.duration) ? element.duration : 0,
                ended: element.ended, denied, blocked
            };
        });
        if (state.problem) throw new Error(state.problem);
        onProgress({ type: 'playback', title: source.title, status: state.blocked ? '等待视频弹题' : '播放中', position: state.time, duration: state.duration });
        if (state.time > previous + 0.1) { previous = state.time; advanced = now(); }
        if (now() - advanced > 60000) {
            const error = new Error(state.denied || '视频停滞超过一分钟，请核对网络或播放器提示');
            error.code = 'STALLED';
            throw error;
        }
        if (now() - recorded > 15000) {
            journal.record(source, '播放中', { position: state.time, url: page.url() });
            console.log(`  ${Math.floor(state.time)} / ${Math.floor(state.duration)} 秒`);
            recorded = now();
        }
        if (state.ended) {
            await page.waitForTimeout(750);
            await handlePrompt();
            break;
        }
        await page.waitForTimeout(1000);
    }
    for (let attempt = 0; attempt < 15; attempt++) {
        await handlePrompt();
        if (await site.confirmed(source)) return '网站确认完成';
        await page.waitForTimeout(1000);
    }
    return '播放结束待确认';
}

module.exports = { optionSets, answerVideoPrompt, playResource, findVideo };
