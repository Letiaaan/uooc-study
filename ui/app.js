'use strict';
const $ = id => document.getElementById(id);
const selected = new Set();
const webPlatforms = {
    doubao: { name: '豆包', url: 'https://www.doubao.com/chat/' },
    qianwen: { name: '千问', url: 'https://www.qianwen.com/', loginRequired: true },
    deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', loginRequired: true }
};
function providerFields() {
    const web = document.querySelector('input[name=provider]:checked').value === 'web';
    for (const id of ['api-fields', 'test-api', 'api-result', 'api-note']) $(id).hidden = web;
    $('web-fields').hidden = !web;
    const platform = webPlatforms[$('web-platform').value];
    $('web-official').href = platform.url;
    const guest = $('web-login').querySelector('option[value="guest"]');
    guest.disabled = Boolean(platform.loginRequired);
    if (platform.loginRequired) $('web-login').value = 'login';
    $('web-login-notice').hidden = !web || !platform.loginRequired && $('web-login').value !== 'login';
    $('web-login-notice-title').textContent = `${platform.name}需要先在官网登录`;
    $('web-platform-note').textContent = platform.loginRequired
        ? `${platform.name}请先登录再解答。请在官方网页输入账号密码或扫码，登录后程序自动继续；登录会话保存在本机。`
        : `${platform.name}提供访客对话入口；如当前官网要求登录或验证，请在官网处理。`;
}
for (const input of document.querySelectorAll('input[name=provider],#web-platform,#web-login')) input.addEventListener('change', providerFields);
let state, initialized = false, courseSignature = '', lastLog = 0, pendingId = '', lastError = '', offline = false, testing = false, savingReminder = false;
let token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('uooc-token') || '';
if (token) { sessionStorage.setItem('uooc-token', token); history.replaceState(null, '', location.pathname); }
let quitting = false, sessionAbort, sessionGeneration = 0;
async function connectSession() {
    const generation = ++sessionGeneration;
    sessionAbort?.abort();
    while (!quitting && generation === sessionGeneration) {
        sessionAbort = new AbortController();
        try {
            const response = await fetch('/api/session', { headers: { Authorization: `Bearer ${token}` }, signal: sessionAbort.signal });
            if (!response.ok) return;
            const reader = response.body.getReader();
            while (!quitting && generation === sessionGeneration && !(await reader.read()).done) {}
        } catch {}
        if (!quitting && generation === sessionGeneration) await new Promise(resolve => setTimeout(resolve, 500));
    }
}
window.addEventListener('pagehide', () => { quitting = true; sessionGeneration++; sessionAbort?.abort(); });
window.addEventListener('pageshow', event => { if (event.persisted) { quitting = false; void connectSession(); } });
if (token) void connectSession();
async function quitProgram() {
    if (quitting) return;
    quitting = true;
    try {
        await api('shutdown', {});
        stopped = true;
        sessionAbort?.abort();
        notice('程序已退出，可以关闭此页面。');
        for (const button of document.querySelectorAll('button')) button.disabled = true;
    } catch (error) { quitting = false; report(error); }
}
document.addEventListener('keydown', event => {
    if (event.key === 'F12') { event.preventDefault(); event.stopImmediatePropagation(); void quitProgram(); }
}, true);
const theme = localStorage.getItem('uooc-theme') || 'system';
$('theme').value = ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
document.documentElement.dataset.theme = $('theme').value;
$('theme').addEventListener('change', () => { document.documentElement.dataset.theme = $('theme').value; localStorage.setItem('uooc-theme', $('theme').value); });

function showView(view) {
    for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${view}`;
    for (const button of document.querySelectorAll('[data-view]')) {
        const active = button.dataset.view === view;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
}
for (const button of document.querySelectorAll('[data-view],[data-go]')) button.addEventListener('click', () => showView(button.dataset.view || button.dataset.go));
let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); $('notice').hidden = !text; }
function explain(text) {
    $('action-dialog-text').textContent = text;
    if (!$('action-dialog').open) $('action-dialog').showModal();
}
function report(error) { notice(error.message, true); explain(error.message); }
function gate(target, reason = '') {
    const node = typeof target === 'string' ? $(target) : target;
    node.disabled = false;
    node.setAttribute('aria-disabled', String(Boolean(reason)));
    if (reason) { node.dataset.unavailable = reason; node.title = reason; }
    else { delete node.dataset.unavailable; node.removeAttribute('title'); }
}
function blockedAction(event) {
    if (event.type === 'keydown' && (['Tab', 'Escape'].includes(event.key) || (event.ctrlKey && ['c', 'a'].includes(event.key.toLowerCase())))) return;
    const node = event.target.closest('[data-unavailable]');
    if (!node) return;
    event.preventDefault(); event.stopImmediatePropagation();
    explain(node.dataset.unavailable);
}
document.addEventListener('click', blockedAction, true);
document.addEventListener('keydown', blockedAction, true);
async function api(route, body) {
    const response = await fetch(`/api/${route}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '操作未完成');
    return result;
}
function config(scope = 'all') {
    const provider = document.querySelector('input[name=provider]:checked').value;
    return { ...(scope === 'ai' ? {} : { username: $('username').value.trim(), password: $('password').value, browser: $('browser').value,
        verificationPopup: $('verification-popup').checked }), provider,
        ...(provider === 'api' ? { key: $('api-key').value.trim(), model: $('model').value.trim(), endpoint: $('endpoint').value.trim() }
            : { webPlatform: $('web-platform').value, webLogin: $('web-login').value, webAutomation: $('web-automation').value }) };
}
async function save(scope = 'all') {
    const input = config(scope);
    const saved = await api('settings', input);
    if ('password' in input) $('password').value = '';
    if ('key' in input) $('api-key').value = '';
    $('password').placeholder = saved.hasPassword ? '已配置，留空沿用' : '输入密码';
    $('api-key').placeholder = saved.hasKey ? '已配置，留空沿用' : '输入 DeepSeek API Key';
    return saved;
}
async function action(name, body = {}) {
    try { await api('command', { action: name, ...body }); await refresh(); }
    catch (error) { report(error); }
}
function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const value = Math.floor(seconds);
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function updateSelection() {
    for (const box of document.querySelectorAll('.course-row input')) box.closest('label').classList.toggle('selected', selected.has(box.value));
    $('selected-count').textContent = selected.size ? `(${selected.size})` : '';
    gate('run', offline ? '工作台已断开连接，请重新启动程序。' : state?.busy ? '当前任务正在运行，请先停止，再更改课程或重新开始。'
        : !state?.connected ? '请先连接 UOOC 并加载课程。' : !selected.size ? '请先勾选要处理的课程。' : '');
    const total = state?.courses.length || 0;
    $('select-all').checked = Boolean(total && selected.size === total);
    $('select-all').indeterminate = selected.size > 0 && selected.size < total;
}
function renderCourses(courses) {
    const signature = JSON.stringify(courses);
    if (signature === courseSignature) return;
    courseSignature = signature;
    for (const id of selected) if (!courses.some(course => course.id === id)) selected.delete(id);
    if (!courses.length) {
        $('courses').replaceChildren();
        const empty = document.createElement('div'); empty.className = 'empty';
        const icon = document.createElement('div'); icon.className = 'empty-book'; icon.textContent = '▤'; icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('h3'); title.textContent = '从连接账号开始';
        const text = document.createElement('p'); text.textContent = '完成浏览器中的登录与验证后，你的课程会显示在这里。';
        empty.append(icon, title, text); $('courses').append(empty);
    } else {
        const fragment = document.createDocumentFragment();
        courses.forEach((course, index) => {
            const row = document.createElement('label'); row.className = 'course-row';
            const box = document.createElement('input'); box.type = 'checkbox'; box.value = course.id; box.checked = selected.has(course.id);
            box.addEventListener('change', () => { if (box.checked) selected.add(course.id); else selected.delete(course.id); updateSelection(); });
            const description = document.createElement('span'); description.className = 'course-description';
            const name = document.createElement('span'); name.className = 'course-name'; name.textContent = course.title;
            const detail = document.createElement('span'); detail.className = 'course-detail';
            detail.textContent = (course.detail || '').split(/\r?\n/).map(line => line.trim()).filter(line => line && line !== course.title && !/^(开始学习|继续学习)$/.test(line)).join('　').slice(0, 160);
            description.append(name, detail);
            const number = document.createElement('span'); number.className = 'course-index'; number.textContent = `${index + 1}`;
            row.append(box, description, number); fragment.append(row);
        });
        $('courses').replaceChildren(fragment);
    }
    $('course-count').textContent = courses.length ? `共 ${courses.length} 门` : '连接后显示课程列表';
}
function renderLogs(logs) {
    if (!logs.length || logs.at(-1).id === lastLog) return;
    lastLog = logs.at(-1).id;
    const fragment = document.createDocumentFragment();
    for (const entry of logs) {
        const line = document.createElement('div'); line.className = `log-line ${entry.level === 'error' ? 'error' : ''}`;
        const time = document.createElement('time'); time.textContent = new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false });
        const text = document.createElement('span'); text.textContent = entry.text;
        line.append(time, text); fragment.append(line);
    }
    $('log-lines').replaceChildren(fragment);
    if ($('follow-log').checked) $('log-lines').scrollTop = $('log-lines').scrollHeight;
    $('recent-log').textContent = logs.slice(-3).map(log => `${new Date(log.time).toLocaleTimeString('zh-CN', { hour12: false })}  ${log.text}`).join('\n');
}
let resultSignature = '';
function renderResults(results) {
    const signature = JSON.stringify(results);
    if (signature === resultSignature) return;
    resultSignature = signature;
    $('results').replaceChildren();
    for (const result of results) {
        const block = document.createElement('section'); block.className = 'result-course';
        const title = document.createElement('h2'); title.textContent = result.course; block.append(title);
        for (const row of result.rows) {
            const line = document.createElement('div'); line.className = 'result-row';
            const text = document.createElement('div'); text.textContent = row.title;
            if (row.reason) { const reason = document.createElement('p'); reason.className = 'result-reason'; reason.textContent = row.reason; text.append(reason); }
            const status = document.createElement('span'); status.textContent = row.status;
            line.append(text, status); block.append(line);
        }
        $('results').append(block);
    }
}
function render(next) {
    state = next;
    document.title = `UOOC Study ${next.version || ''}`.trim();
    if (!initialized) {
        $('username').value = next.settings.username || '';
        $('browser').value = next.settings.browser || 'auto';
        $('model').value = next.settings.model || 'deepseek-chat';
        $('endpoint').value = next.settings.endpoint || 'https://api.deepseek.com';
        document.querySelector(`input[name=provider][value=${next.settings.provider === 'api' ? 'api' : 'web'}]`).checked = true;
        $('web-platform').value = next.settings.webPlatform || 'doubao';
        $('web-login').value = next.settings.webLogin || 'guest';
        $('web-automation').value = next.settings.webAutomation || 'auto';
        providerFields();
        initialized = true;
    }
    $('password').placeholder = next.settings.hasPassword ? '已配置，留空沿用' : '输入密码';
    $('api-key').placeholder = next.settings.hasKey ? '已配置，留空沿用' : '输入 DeepSeek API Key';
    $('phase').textContent = next.phase;
    $('connection-label').textContent = next.connected ? '已连接 UOOC' : next.busy ? '正在处理连接' : '尚未连接 UOOC';
    $('connection-dot').classList.toggle('connected', next.connected);
    $('connect').textContent = next.connected ? '刷新课程' : '连接并加载课程';
    const stopReason = next.stopping ? '正在停止任务，请等待结束后再操作。' : '';
    if (!savingReminder) $('verification-popup').checked = next.settings.verificationPopup !== false;
    gate('verification-popup', stopReason || (savingReminder ? '正在保存提醒设置。' : ''));
    const accountReason = next.busy ? '请先停止当前任务，再修改 UOOC 账号或学习浏览器。' : stopReason;
    for (const id of ['username', 'password', 'browser']) gate(id, accountReason);
    $('username').readOnly = $('password').readOnly = Boolean(accountReason);
    gate('connect', next.busy ? '连接或刷新课程需要先停止当前任务。' : stopReason);
    gate('mode', next.busy ? '运行模式在开始时确定，请先停止任务，再切换模式并重新开始。' : stopReason);
    for (const id of ['save-ai', 'model', 'endpoint', 'api-key', 'clear-key', 'web-platform', 'web-login', 'web-automation']) gate(id, stopReason);
    gate('test-api', stopReason || (testing ? 'API 连接测试正在进行，请等待结果。' : ''));
    gate('web-connect', stopReason || (next.webConnecting ? 'AI 官网正在连接，请稍后再试。' : ''));
    for (const radio of document.querySelectorAll('input[name=provider]')) gate(radio, stopReason);
    gate('logout', next.busy ? '退出 UOOC 账号会中断任务，请先停止任务。' : stopReason || (!next.connected ? '连接 UOOC 后可以在这里退出账号。' : ''));
    const courseReason = next.busy ? '当前任务使用开始时勾选的课程，请先停止任务，再更改课程范围。' : stopReason || (!next.courses.length ? '请先连接 UOOC 并加载课程。' : '');
    gate('select-all', courseReason);
    renderCourses(next.courses);
    for (const box of document.querySelectorAll('.course-row input')) gate(box.closest('label'), courseReason);
    updateSelection();
    gate('pause', stopReason || (!next.busy || next.operation !== 'run' ? '开始课程任务后可以暂停或继续。' : ''));
    $('pause').textContent = next.paused ? '继续' : '暂停';
    gate('stop', stopReason || (!next.busy && !next.connected && !next.web?.opened && !next.webConnecting ? '当前没有运行中的任务或已连接的浏览器。' : ''));
    $('ai-runtime-note').textContent = next.answer ? '可以运行中切换。点击“应用设置”后，当前测验重新取答，旧回复将忽略；已发出的 API 请求仍可能计费。'
        : next.busy ? '可以运行中修改答题设置。当前已进入填写或提交的测验继续处理，新设置从下一次取答时生效。'
            : '选择后点击“应用设置”生效；API 连接测试仅测试输入的设置。';
    $('live-dot').classList.toggle('running', next.busy && !next.paused);
    $('verification').hidden = !next.verification;
    $('verification-text').textContent = next.verification?.message || '';
    const videoQuestion = next.verification?.kind === 'video-question';
    $('verification-title').textContent = videoQuestion ? '视频题目等待处理' : next.verification?.kind === 'quiz-review' ? '测验结果等待核对' : '等待官网验证';
    $('show-verification').textContent = videoQuestion ? '前往视频题目' : '前往验证页面';
    const platform = webPlatforms[next.settings.webPlatform] || webPlatforms.doubao;
    const waitingLogin = Boolean(next.settings.provider === 'web' && next.web?.needsAction && /完成登录|请.*登录|登录入口已打开/.test(next.web?.note || ''));
    $('ai-login-alert').hidden = !waitingLogin;
    const waitingPlatform = webPlatforms[next.web?.platform] || platform;
    $('ai-login-alert-title').textContent = `请先在${waitingPlatform.name}官网登录`;
    $('ai-login-alert-text').textContent = '请切换到程序打开的 AI 官网窗口，输入账号密码或扫码。登录后自动继续，当前试卷会保留。';
    $('provider-label').textContent = next.settings.provider === 'web' ? `${platform.name}网页答题` : 'DeepSeek API';
    $('web-chat-link').href = platform.url;
    $('web-chat-link').textContent = `打开${platform.name}`;
    $('web-phase').textContent = next.web?.phase || '等待连接 AI 官网';
    const automatic = next.settings.webAutomation !== 'manual';
    $('web-note').textContent = next.web?.note || (automatic
        ? '自动发送整卷、读取并校验回复，再填写提交；无需手动复制或点击继续。官网要求登录、验证或处理协议时会等待，完成后自动恢复。'
        : '当前为手动模式，需要复制题目并粘贴回复；可在答题设置中切换为自动方式。');
    $('web-ready').hidden = automatic && !next.web?.retryable;
    gate('web-ready', stopReason || (!next.web?.opened ? '请先在答题设置中打开并连接 AI 官网。'
        : next.web?.working ? '正在处理官网步骤，请等待；需要时也可以手动粘贴完整答案。'
            : next.web?.approved && !next.pending ? '官网已就绪，等待下一份测验。' : ''));
    $('web-ready').textContent = next.pending
        ? next.web?.sent ? '继续读取本次回复' : '继续发送本次题目' : '已在官网完成操作，继续';
    $('web-file').textContent = next.web?.lastFile ? `最近保存：${next.web.lastFile}` : '';
    if (next.progress) {
        $('current-course').textContent = next.progress.course || '当前课程';
        $('current-title').textContent = next.progress.title || '正在运行';
        const duration = next.progress.duration || 0, position = next.progress.position || 0;
        $('progress-fill').style.width = `${duration ? Math.min(100, 100 * position / duration) : 0}%`;
        $('progress-time').textContent = duration ? `${formatTime(position)} / ${formatTime(duration)}` : '正在处理目录或测验';
    }
    $('progress-status').textContent = next.paused ? '已暂停' : next.progress?.status || next.phase;
    $('web-badge').hidden = !next.pending;
    $('web-empty').hidden = Boolean(next.pending);
    $('web-work').hidden = !next.pending;
    if (next.pending && pendingId !== next.pending.id) {
        pendingId = next.pending.id;
        $('prompt').value = next.pending.prompt;
        $('answer').value = '';
        $('answer-preview').textContent = '';
        $('web-summary').textContent = `已提取 ${next.pending.count} 道题，${automatic ? '正在自动处理' : '等待手动带回答案'}`;
        $('manual-tools').open = !automatic;
        showView('web');
        toast(`已提取测验题目，使用${platform.name}网页答题`);
    }
    if (!next.pending) pendingId = '';
    if (!automatic || next.web?.retryable) $('manual-tools').open = true;
    renderLogs(next.logs);
    const results = [...next.results];
    if (next.progress?.rows && !results.some(result => result.course === next.progress.course)) results.push({ course: next.progress.course, rows: next.progress.rows });
    renderResults(results);
    if (next.error && next.error !== lastError) { lastError = next.error; notice(next.error, true); }
    else if (!next.error && lastError) { lastError = ''; notice(''); }
}
async function refresh() {
    try { const next = await api('state'); if (offline) { offline = false; notice(''); } render(next); }
    catch (error) { offline = true; notice(`连接已断开：${error.message}。请保留程序窗口，或重新启动 EXE。`, true); gate('run', '工作台已断开连接，请重新启动程序。'); }
}
$('account-form').addEventListener('submit', async event => { event.preventDefault(); try { await save(); await action('connect'); } catch (error) { report(error); } });
$('ai-form').addEventListener('submit', async event => { event.preventDefault(); try { const saved = await save('ai'); toast(saved.effect); await refresh(); } catch (error) { report(error); } });
$('web-connect').addEventListener('click', async () => {
    try { await save('ai'); await action('web-connect'); showView('web'); } catch (error) { report(error); }
});
$('web-ready').addEventListener('click', () => action('web-ready'));
$('test-api').addEventListener('click', async () => {
    testing = true; gate('test-api', 'API 连接测试正在进行，请等待结果。'); $('api-result').textContent = '正在测试…';
    try { const result = await api('test-api', config('ai')); $('api-result').textContent = `${result.message}（${result.latency} ms），点击“应用设置”使用。`; }
    catch (error) { $('api-result').textContent = error.message; }
    finally { testing = false; await refresh(); }
});
$('clear-key').addEventListener('click', async () => { try { await api('settings', { clearKey: true }); $('api-key').value = ''; toast('本次会话的密钥已清除'); await refresh(); } catch (error) { report(error); } });
$('run').addEventListener('click', async () => { try { await save(); await action('run', { ids: [...selected], mode: $('mode').value }); } catch (error) { report(error); } });
$('pause').addEventListener('click', () => action(state?.paused ? 'resume' : 'pause'));
$('stop').addEventListener('click', () => action('stop'));
$('logout').addEventListener('click', () => action('logout'));
$('show-verification').addEventListener('click', () => action('show-verification'));
$('verification-popup').addEventListener('change', async () => {
    savingReminder = true;
    gate('verification-popup', '正在保存提醒设置。');
    try {
        await api('settings', { verificationPopup: $('verification-popup').checked });
        toast($('verification-popup').checked ? '需要人工处理时会弹出提醒' : '已关闭弹窗，待处理事项仍在工作台显示');
    } catch (error) { report(error); }
    finally { savingReminder = false; await refresh(); }
});
$('select-all').addEventListener('change', () => { selected.clear(); if ($('select-all').checked) for (const course of state.courses) selected.add(course.id); for (const box of document.querySelectorAll('.course-row input')) box.checked = selected.has(box.value); updateSelection(); });
$('copy-prompt').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('prompt').value); toast('整卷题目已复制，请在所选官网的新会话中粘贴并发送'); }
    catch { $('prompt').focus(); $('prompt').select(); toast('请按 Ctrl+C 复制已选中的题目'); }
});
async function answerRoute(apply) {
    const button = $(apply ? 'apply-answer' : 'validate-answer'); gate(button, '正在校验或保存答案，请等待结果。');
    try {
        const result = await api(`answers/${apply ? 'apply' : 'validate'}`, { id: pendingId, text: $('answer').value });
        $('answer-preview').textContent = result.answers.map(answer => `${answer.number}. ${answer.values.join('、')}`).join('\n');
        if (apply) { toast('答案校验通过，程序将继续测验'); await refresh(); }
    } catch (error) { $('answer-preview').textContent = error.message; }
    finally { gate(button); }
}
$('validate-answer').addEventListener('click', () => answerRoute(false));
$('apply-answer').addEventListener('click', () => answerRoute(true));
$('skip-answer').addEventListener('click', async () => {
    try { await api('answers/skip', { id: pendingId }); toast('已跳过本次测验，将继续处理后续任务'); await refresh(); }
    catch (error) { notice(error.message, true); }
});
$('download-log').addEventListener('click', () => {
    const text = (state?.logs || []).map(entry => `${entry.time}  ${entry.text}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'UOOC-Study-运行记录.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let stopped = false;
$('shutdown').addEventListener('click', () => { void quitProgram(); });
async function poll() { if (stopped) return; await refresh(); if (!stopped) setTimeout(poll, 1000); }
poll();
