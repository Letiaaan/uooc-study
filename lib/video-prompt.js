const { ensureRendered } = require('./window-rendering');
const { navigationInterrupted } = require('./page-ready');
const { frameIsVisible } = require('./browser');

function* optionSets(count, multiple) {
    if (!multiple) { for (let i = 0; i < count; i++) yield [i]; return; }
    function* combinations(size, start, selected) {
        if (!size) { yield selected; return; }
        for (let i = start; i <= count - size; i++) yield* combinations(size - 1, i + 1, [...selected, i]);
    }
    for (let size = 2; size <= count; size++) yield* combinations(size, 0, []);
    yield* combinations(1, 0, []);
}

// Only inspect the site's visible video-question UI; do not read Angular answer
// data, alter the model, or treat the independent exam page as a video prompt.
function promptState(root) {
    const shown = node => Boolean(node?.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden';
    const hiddenAbove = node => {
        for (; node && node !== root.parentElement; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return true;
        }
        return false;
    };
    const raw = [...root.querySelectorAll('input[type="radio"],input[type="checkbox"]')];
    const views = [...root.querySelectorAll('.smallTest-view')].filter(shown);
    const active = views.length === 1 ? views[0] : root;
    const options = raw.map((node, index) => ({ node, index })).filter(({ node }) => {
        if (!active.contains(node) || node.disabled || hiddenAbove(node.parentElement)) return false;
        return shown(node) || shown(node.closest('label'));
    }).map(({ node, index }) => ({ index, type: node.type, name: node.name, value: node.value, checked: node.checked,
        text: (node.closest('label')?.innerText || '').trim() }));
    const buttons = [...root.querySelectorAll('button')];
    const submit = buttons.filter(node => shown(node) && (node.getAttribute('ng-click')?.includes('sureAnswer(') || node.classList.contains('btn-success')));
    const title = (active.querySelector('.ti-q-c')?.innerText || root.querySelector('.ti-q-c')?.innerText || '').trim();
    const key = JSON.stringify([title, options.map(({ type, name, value, text }) => [type, name, value, text])]);
    const types = new Set(options.map(option => option.type));
    const groups = new Set(options.filter(option => option.type === 'radio').map(option => option.name));
    const unsupported = options.length > 8 || types.size > 1 || groups.size > 1 || views.length > 1;
    const pendingTemplate = /\{\{/.test(title) || options.some(option => /\{\{/.test(option.value + option.text));
    const button = submit.length === 1 ? submit[0] : null;
    const enabled = Boolean(button && !button.disabled && !button.classList.contains('disabled') && button.getAttribute('aria-disabled') !== 'true');
    const feedback = [...root.querySelectorAll('[ng-if="wrongTip"],.mpopup-bottom .fl_left')].filter(shown).map(node => node.innerText.trim()).filter(Boolean).join(' ');
    return { key, options, multiple: types.has('checkbox'), unsupported, ready: Boolean(options.length && !unsupported && !pendingTemplate && enabled),
        submitIndex: button ? buttons.indexOf(button) : -1, feedback };
}

async function visiblePrompt(page) {
    const found = [];
    for (const frame of page.frames?.() || [page]) {
        if (!await frameIsVisible(frame)) continue;
        for (const root of await frame.locator('#quizLayer,.quizLayer').all()) {
            if (await root.isVisible().catch(() => false)) found.push({ frame, root });
        }
    }
    if (!found.length) return null;
    if (found.length !== 1) return { ambiguous: true, key: 'ambiguous' };
    try { return { ...found[0], ...await found[0].root.evaluate(promptState) }; }
    catch (error) { if (navigationInterrupted(error)) return null; throw error; }
}

async function selectOption(prompt, option, desired) {
    const input = prompt.root.locator('input[type="radio"],input[type="checkbox"]').nth(option.index);
    if (await input.isChecked() === desired) return;
    if (await input.isVisible()) await input.setChecked(desired, { timeout: 4000 });
    else {
        const label = input.locator('xpath=ancestor::label[1]');
        if (!await label.isVisible()) throw new Error('选项控件及其标签均不可操作');
        await label.click({ timeout: 4000 });
    }
    if (await input.isChecked() !== desired) throw new Error('点击后选项状态没有生效');
}

async function answerVideoPrompt(page, control, { onVerify = () => {}, onProgress = () => {}, assertResource = () => {},
    loadTimeout = 12000, resultTimeout = 6000 } = {}) {
    let handled = 0;
    const check = async () => {
        await control?.checkpoint();
        if (page.isClosed()) throw new Error('课程窗口已关闭');
        assertResource();
    };
    const manual = async (current, reason, retryLoaded = false) => {
        console.log(`  视频弹题等待本人处理：${reason}。当前视频与题目保留。`);
        onProgress({ type: 'playback', status: '等待本人处理视频弹题' });
        onVerify({ kind: 'video-question', message: `视频内题目需要本人处理：${reason}。请前往当前视频页面作答，完成后自动继续；无需重新输入账号密码。` });
        try {
            while (true) {
                await check();
                const next = await visiblePrompt(page);
                if (!next || next.key !== current.key || retryLoaded && next.ready) return;
                await page.waitForTimeout(250);
            }
        } finally { onVerify(null); }
    };
    while (true) {
        await check();
        let prompt = await visiblePrompt(page);
        if (!prompt) return { handled };
        await ensureRendered(page);
        console.log('  检测到视频弹题，正在等待可操作的题目与选项。');
        onProgress({ type: 'playback', status: '正在读取视频弹题' });
        const started = Date.now();
        let stableKey = '', stable = 0;
        while (prompt && !prompt.ambiguous && !prompt.unsupported) {
            await check();
            if (prompt.ready) {
                stable = prompt.key === stableKey ? stable + 1 : 1;
                stableKey = prompt.key;
                if (stable >= 2) break;
            } else { stable = 0; stableKey = ''; }
            if (Date.now() - started >= loadTimeout) break;
            await page.waitForTimeout(120);
            prompt = await visiblePrompt(page);
        }
        if (!prompt) { handled++; continue; }
        if (prompt.ambiguous || prompt.unsupported || !prompt.ready) {
            if (!prompt.ambiguous) console.log(`  弹题诊断：${prompt.options.length} 个可操作选项，${prompt.submitIndex < 0 ? '尚未找到唯一确定按钮' : '已定位确定按钮'}。`);
            const reason = prompt.ambiguous ? '页面存在多处可见弹题，无法确认当前题目' : prompt.unsupported
                ? '当前选项数量或题型超出自动处理范围' : '题目、选项或确定按钮尚未加载完整';
            await manual(prompt, reason, true);
            continue;
        }
        const key = prompt.key, count = prompt.options.length;
        console.log(`  视频弹题：${count} 个可操作选项，${prompt.multiple ? '逐组' : '逐项'}尝试。`);
        let outcome = 'exhausted';
        for (const selected of optionSets(count, prompt.multiple)) {
            await check();
            const current = await visiblePrompt(page);
            if (!current || current.key !== key) { outcome = 'changed'; break; }
            try {
                if (current.multiple) {
                    for (let index = 0; index < count; index++) await selectOption(current, current.options[index], selected.includes(index));
                } else await selectOption(current, current.options[selected[0]], true);
                const selectedState = await visiblePrompt(page);
                if (!selectedState || selectedState.key !== key) { outcome = 'changed'; break; }
                const actual = selectedState.options.flatMap((option, index) => option.checked ? [index] : []);
                if (actual.join(',') !== selected.join(',')) throw new Error('选中状态与当前尝试不一致');
                await current.root.locator('button').nth(current.submitIndex).click({ timeout: 5000 });
                const sentAt = Date.now();
                outcome = 'uncertain';
                while (Date.now() - sentAt < resultTimeout) {
                    await check();
                    const after = await visiblePrompt(page);
                    if (!after) {
                        await page.waitForTimeout(150);
                        if (!await visiblePrompt(page)) { outcome = 'cleared'; break; }
                        outcome = 'changed'; break;
                    }
                    if (after.key !== key) { outcome = 'changed'; break; }
                    if (Date.now() - sentAt >= 300 && after.feedback && after.ready) { outcome = 'rejected'; break; }
                    await page.waitForTimeout(120);
                }
                if (outcome === 'rejected') continue;
                break;
            } catch (error) {
                if (control?.stopped) throw error;
                outcome = 'uncertain';
                break;
            }
        }
        if (outcome === 'cleared' || outcome === 'changed') {
            handled++;
            console.log('  视频弹题已关闭或切换，继续核对播放器。');
            continue;
        }
        await manual(prompt, outcome === 'uncertain' ? '无法确认选项点击或提交结果，已停止重复提交' : '所有选项尝试后页面仍要求作答');
    }
}

module.exports = { optionSets, promptState, visiblePrompt, answerVideoPrompt };
