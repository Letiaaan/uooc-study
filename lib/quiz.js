const { visibleAcrossFrames } = require('./browser');
const { solveQuestions } = require('./model');
const { readAfterNavigation, navigationInterrupted } = require('./page-ready');
const { SimpleVerification } = require('./verification');
const { watchSubmission } = require('./submission-receipt');
const { ensureRendered } = require('./window-rendering');

async function questionsOnPage(page) {
    for (const frame of page.frames()) {
        const blocks = frame.locator('.queContainer:visible');
        if (await blocks.count()) return blocks.all();
    }
    return [];
}

async function waitForPaper(page, { control, onVerify = () => {}, timeout = 30000 } = {}) {
    let started = false, stable = 0, previous = '';
    let deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        deadline += await control?.checkpoint() || 0;
        await ensureRendered(page);
        const state = await readAfterNavigation(page, async () => {
            const result = await resultOnPage(page);
            if (result === '页面确认通过') return { passed: true };
            if (result === '已提交待网站确认') return { submitted: true };
            const blocks = await questionsOnPage(page);
            const rows = [];
            for (const block of blocks) rows.push(await block.evaluate(node => ({
                text: node.innerText.trim(), options: node.querySelectorAll('.ti-a').length,
                editors: node.querySelectorAll('textarea.ue-container1,.ue-container iframe').length
            })));
            return { blocks, rows };
        }, { check: () => control?.checkpoint() });
        if (state.passed || state.submitted) return state;
        const ready = state.rows.length && state.rows.every(row => row.text && !/\{\{/.test(row.text) && (row.options || row.editors));
        const signature = JSON.stringify(state.rows);
        stable = ready && signature === previous ? stable + 1 : 0;
        previous = signature;
        if (ready && stable >= 2) { onVerify(null); return state; }
        if (!started) {
            const start = await visibleAcrossFrames(page, 'button:has-text("开始测验"), .btn:has-text("开始测验"), a:has-text("开始测验"), button:has-text("重新测验"), .btn:has-text("重新测验")');
            if (start && await start.isEnabled()) {
                started = true;
                try { await start.click(); } catch (error) { if (!navigationInterrupted(error)) throw error; }
            }
        }
        await page.waitForTimeout(300);
    }
    throw new Error('等待测验题目加载超时，请核对测验页面的登录、开始测验或验证提示后重新试跑；程序没有提交本次测验');
}

async function extractQuestions(blocks) {
    const questions = [];
    let ignoredImages = 0;
    for (let index = 0; index < blocks.length; index++) {
        const question = await blocks[index].evaluate(element => {
            const images = [...element.querySelectorAll('img,canvas')].map((node, index) => {
                const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
                const visible = Boolean(node.getClientRects().length && rect.width > 0 && rect.height > 0
                    && style.display !== 'none' && style.visibility !== 'hidden');
                const decorative = node.getAttribute('role') === 'presentation' || node.getAttribute('aria-hidden') === 'true'
                    || Boolean(node.closest('button,[role="button"],.edui-toolbar,.edui-button,.icon,[class*="icon-"],[class*="status"],[class*="score"]'))
                    || (rect.width <= 32 && rect.height <= 32 && /^(正确|错误|选中|未选中|收起|展开|对|错)$/.test(node.getAttribute('alt') || ''));
                let source = '';
                try { const url = new URL(node.getAttribute('src') || '', location.href); source = url.origin + url.pathname; } catch {}
                return { index, tag: node.tagName, alt: node.getAttribute('alt') || '', width: rect.width, height: rect.height,
                    visible, decorative, source };
            });
            const text = element.innerText.trim();
            const options = [...element.querySelectorAll('.ti-a')].map((option, index) => ({
                letter: String.fromCharCode(65 + index), text: option.innerText.trim()
            }));
            const blanks = element.querySelectorAll('textarea.ue-container1').length;
            const rich = element.querySelectorAll('.ue-container iframe').length;
            const kind = blanks || rich ? 'text' : element.querySelector('input[type="checkbox"]') ? 'multiple' : 'single';
            return { text, options: kind === 'text' ? [] : options, blanks, kind, images };
        });
        if (question.images.some(image => image.visible && !image.decorative)) {
            question.skipImage = true;
            console.log(`  第 ${index + 1} 题含图片，按当前策略${question.kind === 'text' ? '留空' : '暂选 A 占位'}，不交给文字 AI 推断。`);
            ignoredImages += question.images.filter(image => !image.visible || image.decorative).length;
        } else {
            ignoredImages += question.images.length;
        }
        delete question.images;
        if (!question.text || (question.kind !== 'text' && !question.options.length)) throw new Error('题干或选项文字不完整');
        questions.push({ number: index + 1, ...question });
    }
    if (ignoredImages) console.log(`  本卷已排除 ${ignoredImages} 个隐藏图片或界面图标，按可见题目提取。`);
    return questions;
}

async function writeAnswers(blocks, questions, answers) {
    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        const question = questions[index];
        const values = answers[index];
        if (question.skipImage && question.kind === 'text') continue;
        if (question.kind !== 'text') {
            const choices = block.locator('.ti-a');
            if (question.kind === 'multiple') {
                const checked = block.locator('input[type="checkbox"]:checked');
                while (await checked.count()) await checked.first().uncheck();
            }
            for (const letter of values) await choices.nth(letter.charCodeAt(0) - 65).click();
        } else if (question.blanks) {
            const inputs = block.locator('textarea.ue-container1');
            for (let blank = 0; blank < question.blanks; blank++) {
                await inputs.nth(blank).fill(values[blank]);
                await inputs.nth(blank).dispatchEvent('change');
                await inputs.nth(blank).dispatchEvent('mouseleave');
            }
        } else {
            const editors = await block.locator('.ue-container').all();
            if (!editors.length) throw new Error('未找到文字答案编辑器');
            for (let editorIndex = 0; editorIndex < editors.length; editorIndex++) {
                const editor = editors[editorIndex];
                const handle = await editor.locator('iframe').elementHandle();
                const frame = await handle?.contentFrame();
                if (!frame) throw new Error('文字编辑器尚未加载');
                const text = values[editorIndex] || values.join('\n');
                await frame.locator('body').fill(text);
                const hidden = editor.locator('xpath=following-sibling::textarea[1]');
                if (await hidden.count()) await hidden.evaluate((node, value) => {
                    node.value = value;
                    node.dispatchEvent(new Event('input', { bubbles: true }));
                    node.dispatchEvent(new Event('change', { bubbles: true }));
                }, text);
                await editor.dispatchEvent('mouseleave');
            }
        }
    }
}

async function solvePaper(questions, solve) {
    const textQuestions = questions.filter(question => !question.skipImage);
    const answers = textQuestions.length ? await solve(textQuestions) : [];
    if (!Array.isArray(answers) || answers.length !== textQuestions.length) throw new Error('返回的文字题答案数量不完整');
    const byNumber = new Map(textQuestions.map((question, index) => [question.number, answers[index]]));
    return questions.map(question => question.skipImage
        ? question.kind === 'text' ? [] : [question.options[0].letter]
        : byNumber.get(question.number));
}

async function resultOnPage(page) {
    for (const frame of page.frames()) {
        const messages = await frame.locator('.layui-layer-content:visible').allTextContents();
        if (messages.some(text => /重新提交|未通过/.test(text) && !/验证(?:失败|未通过)/.test(text))) return '未通过';
        if (messages.some(text => /测验(?:已)?通过/.test(text))) return '页面确认通过';
        if (messages.some(text => /提交成功|交卷成功/.test(text))) return '已提交待网站确认';
        if (typeof frame.evaluate === 'function' && await frame.evaluate(() => /\/exam\/paper(?:\/|$)/.test(location.pathname)
            && /提交时间/.test(document.body.innerText) && /得分\s*[:：]/.test(document.body.innerText))) return '已提交待网站确认';
    }
    return null;
}

async function processQuiz(page, beforeSubmit = () => {}, { solve = solveQuestions, control, onVerify = () => {} } = {}) {
    await page.waitForLoadState('domcontentloaded');
    const paper = await waitForPaper(page, { control, onVerify });
    if (paper.passed) return '页面确认通过';
    if (paper.submitted) return '已提交待网站确认';
    const blocks = paper.blocks;
    const questions = await extractQuestions(blocks);
    const skipped = questions.filter(question => question.skipImage).length;
    console.log(`  已提取 ${questions.length} 道题，${skipped ? `${skipped} 道图片题按占位策略处理，其余 ` : ''}${questions.length - skipped} 道文字题正在准备答案。`);
    await control?.checkpoint();
    const answers = await solvePaper(questions, solve);
    await control?.checkpoint();
    await ensureRendered(page);
    // Stay on the background tab. The browser launcher disables occlusion
    // throttling so actions do not require bringing the quiz to the foreground.
    await writeAnswers(blocks, questions, answers);
    const submit = await visibleAcrossFrames(page, 'button:has-text("提交试卷")');
    if (!submit) throw new Error('未找到当前试卷提交按钮');
    await control?.checkpoint();
    beforeSubmit();
    await submit.click();
    await page.waitForTimeout(1000);
    return finishSubmission(page, { control, onVerify });
}

function submissionState(node) {
    const container = node.closest('.layui-layer-content,[role="dialog"],.modal-content') || node.parentElement;
    const text = container?.innerText || '';
    let callbackReady = null;
    // UOOC binds this DIV's disabled state to its success callback. The success
    // label can appear before that callback has provided the submission value.
    if (node.getAttribute('ng-disabled')?.replace(/\s/g, '') === '!vcode_params.captchaVerifyParam') {
        const scope = window.angular?.element(node).scope();
        if (scope) callbackReady = Boolean(scope.vcode_params?.captchaVerifyParam);
    }
    return { enabled: !node.classList.contains('disabled') && !node.disabled && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true',
        verificationPending: callbackReady === false || /智能验证|人机验证|点击复选框|完成验证|验证中|验证失败|验证未通过/.test(text) && !/验证成功|验证通过|验证已通过/.test(text) };
}

async function finishSubmission(page, { control, onVerify = () => {}, timeout = 300000 } = {}) {
    const receipt = watchSubmission(page);
    try { return await waitForSubmission(page, { control, onVerify, timeout }, receipt); }
    finally { receipt.close(); onVerify(null); }
}

async function waitForSubmission(page, { control, onVerify, timeout }, receipt) {
    const read = action => readAfterNavigation(page, action, { check: () => control?.checkpoint() });
    const verification = new SimpleVerification();
    let finalClicked = 0;
    let acknowledged = 0;
    let notified = false;
    let verificationWait = 0;
    let deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        deadline += await control?.checkpoint() || 0;
        await ensureRendered(page);
        if (receipt.value) {
            const { code, message } = receipt.value;
            if (code === 110) { console.log(`  网站返回测验未通过：${message}`); return '未通过'; }
            if (code !== 1) throw new Error(`网站拒绝交卷（${code}）：${message || '请在测验页核对提示'}`);
            acknowledged ||= Date.now();
        }
        const result = await read(() => resultOnPage(page));
        if (result === '页面确认通过' || result === '未通过') return result;
        // A submission toast may precede the actual result. Keep the page alive
        // to observe a later pass rather than closing it at the first toast.
        if (result === '已提交待网站确认') acknowledged ||= Date.now();
        if (acknowledged && Date.now() - acknowledged > 15000) return '已提交待网站确认';
        const final = await visibleAcrossFrames(page, 'div.btn.btn-warning:has-text("提交")');
        let verificationPending = false;
        if (final && !acknowledged) {
            verificationWait ||= Date.now();
            const verificationStatus = await read(() => verification.step(page));
            if ((verificationStatus === 'clicked' || verificationStatus === 'checking') && Date.now() - verificationWait < 15000) {
                // Some UOOC dialogs submit in the verification callback. Observe
                // the next page before touching the old confirmation button.
                await page.waitForTimeout(1500);
                continue;
            }
            const state = await final.evaluate(submissionState);
            verificationPending = state.verificationPending;
            if (verificationPending || !state.enabled) verificationWait ||= Date.now();
            else verificationWait = 0;
            if (state.enabled && !verificationPending && !finalClicked) {
                onVerify(null);
                console.log('  验证结果已就绪，正在点击最终“提交”。');
                finalClicked = Date.now();
                try { await final.click(); } catch (error) { if (!navigationInterrupted(error)) throw error; }
            }
            else if ((verificationPending || !state.enabled) && !notified
                && (verificationStatus === 'manual' || Date.now() - verificationWait >= 15000)) {
                console.log('  若智能验证未自动通过，请在测验页面处理，程序将等待后继续。');
                notified = true;
                onVerify({ kind: 'quiz', message: '测验验证需要人工处理，请点击“前往验证页面”；完成后程序会自动继续提交。' });
            }
        }
        if (finalClicked && !verificationPending && Date.now() - finalClicked > 30000) return '提交结果待确认';
        await page.waitForTimeout(1500);
    }
    return '待本人验证或确认提交结果';
}

module.exports = { extractQuestions, processQuiz, resultOnPage, waitForPaper, solvePaper, finishSubmission, submissionState };
