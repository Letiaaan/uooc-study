function* optionSets(count, multiple) {
    if (!multiple) {
        for (let i = 0; i < count; i++) yield [i];
        return;
    }
    function* combinations(size, start, selected) {
        if (!size) { yield selected; return; }
        for (let i = start; i <= count - size; i++) yield* combinations(size - 1, i + 1, [...selected, i]);
    }
    for (let size = 2; size <= count; size++) yield* combinations(size, 0, []);
    yield* combinations(1, 0, []);
}

async function answerVideoPrompt(page, control) {
    const dialog = page.locator('#quizLayer');
    if (!await dialog.isVisible().catch(() => false)) return;
    const options = dialog.locator('input[type="radio"],input[type="checkbox"]');
    const count = await options.count();
    if (!count || count > 8) throw new Error('视频弹题选项需要本人处理');
    const multiple = await options.first().getAttribute('type') === 'checkbox';
    console.log(`  视频弹题：${count} 个选项，${multiple ? '逐组' : '逐项'}尝试。`);
    for (const selected of optionSets(count, multiple)) {
        await control?.checkpoint();
        if (!await dialog.isVisible()) return;
        if (multiple) {
            for (let index = 0; index < count; index++) await options.nth(index).setChecked(selected.includes(index));
        } else await options.nth(selected[0]).check();
        await dialog.locator('button.btn-success').click();
        await page.waitForTimeout(700);
        if (!await dialog.isVisible()) return;
    }
    throw new Error('视频弹题尝试结束，页面仍要求作答，请本人处理');
}

async function playResource(site, source, journal, { control, onProgress = () => {} } = {}) {
    const page = site.page;
    const video = page.locator('video').first();
    await video.waitFor({ state: 'visible', timeout: 15000 });
    let previous = -1;
    let advanced = Date.now();
    let recorded = 0;
    while (true) {
        const waited = control?.waited || 0;
        await control?.checkpoint();
        await answerVideoPrompt(page, control);
        advanced += (control?.waited || 0) - waited;
        if (page.isClosed()) throw new Error('课程窗口已关闭');
        if (!page.url().split('#')[1]?.split('/').includes(source.id)) throw new Error('当前视频资源发生变化，已保留续跑记录');
        const state = await video.evaluate(async element => {
            if (element.error) return { problem: `播放器错误 ${element.error.code}` };
            element.muted = true;
            element.playbackRate = 2;
            let denied = '';
            if (element.paused && !element.ended) {
                try { await element.play(); } catch { denied = '浏览器暂未允许播放，请在浏览器点击播放'; }
            }
            return {
                time: element.currentTime, duration: Number.isFinite(element.duration) ? element.duration : 0,
                ended: element.ended, denied
            };
        });
        if (state.problem) throw new Error(state.problem);
        onProgress({ type: 'playback', title: source.title, status: '播放中', position: state.time, duration: state.duration });
        if (state.time > previous + 0.1) { previous = state.time; advanced = Date.now(); }
        if (Date.now() - advanced > 60000) {
            const error = new Error(state.denied || '视频停滞超过一分钟，请核对网络或播放器提示');
            error.code = 'STALLED';
            throw error;
        }
        if (Date.now() - recorded > 15000) {
            journal.record(source, '播放中', { position: state.time, url: page.url() });
            console.log(`  ${Math.floor(state.time)} / ${Math.floor(state.duration)} 秒`);
            recorded = Date.now();
        }
        if (state.ended) break;
        await page.waitForTimeout(1000);
    }
    for (let attempt = 0; attempt < 15; attempt++) {
        if (await site.confirmed(source)) return '网站确认完成';
        await page.waitForTimeout(1000);
    }
    return '播放结束待确认';
}

module.exports = { optionSets, answerVideoPrompt, playResource };
