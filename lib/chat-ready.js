// Inspect only visible official UI; never accept agreements or solve verification.
function inspectReadiness({ editor, requireLogin = false }) {
    const visible = node => Boolean(node.getClientRects().length);
    const dialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.ant-modal,.semi-modal,.el-dialog')].filter(visible);
    const text = document.body?.innerText || '';
    if (/请完成.{0,8}(?:安全|人机|智能)验证|拖动滑块|点击.{0,4}完成验证|请求过于频繁|访问过于频繁/.test(text)) {
        return { ready: false, kind: 'verification', note: '请在 AI 官网完成验证或处理访问限制，页面恢复后程序会自动继续。' };
    }
    if (dialogs.some(node => /用户协议|隐私政策|服务条款|首次使用|用户须知/.test(node.innerText || ''))) {
        return { ready: false, kind: 'consent', note: '官网显示首次使用或协议提示，请本人在官网处理；提示关闭后自动继续。' };
    }
    const login = [...document.querySelectorAll('button,a,[role="button"]')].filter(visible)
        .some(node => /^(?:登录|立即登录|登录\s*[/／]\s*注册|登录或注册|Log in|Sign in)$/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
    if (/\/(?:login|sign[-_]?in)(?:\/|$)/i.test(location.pathname) ||
        dialogs.some(node => /登录|Sign in|Log in/i.test(node.innerText || '')) || requireLogin && login) {
        return { ready: false, kind: 'login', openLogin: requireLogin && login
            && !/\/(?:login|sign[-_]?in)(?:\/|$)/i.test(location.pathname)
            && !dialogs.some(node => /登录|Sign in|Log in/i.test(node.innerText || '')),
            note: '请在 AI 官方网页完成登录，程序检测到聊天页面可用后会自动继续。' };
    }
    if (dialogs.length) {
        return { ready: false, kind: 'dialog', note: '官网仍有弹窗遮挡聊天页面，请在官网处理；弹窗关闭后自动继续。' };
    }
    const input = [...document.querySelectorAll(editor)].find(node => visible(node) && !node.disabled && !node.readOnly && !node.hasAttribute('readonly')
        && node.getAttribute('aria-disabled') !== 'true' && node.getAttribute('aria-readonly') !== 'true');
    return input ? { ready: true, kind: 'ready', note: '' }
        : { ready: false, kind: 'loading', note: '正在等待官网聊天输入框加载，无需复制题目或点击继续。' };
}

function readEditorText(node) {
    if (typeof node.value === 'string') return node.value;
    const copy = node.cloneNode(true);
    // Slate's placeholder is real text inside the editable element, but it is
    // not the user's input. Preserve paragraph boundaries for filled prompts.
    for (const placeholder of copy.querySelectorAll('[data-slate-placeholder],[data-slate-zero-width]')) placeholder.remove();
    for (const line of copy.querySelectorAll('br')) line.replaceWith('\n');
    for (const block of copy.querySelectorAll('p,div,li')) block.append('\n');
    return (copy.textContent || '').replace(/[\u200B\uFEFF]/g, '');
}

module.exports = { inspectReadiness, readEditorText };
