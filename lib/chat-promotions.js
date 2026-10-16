const promotionTitle = /下载豆包(?:电脑|桌面)版/;
const protectedPrompt = /用户协议|隐私政策|服务条款|首次使用|用户须知|登录|注册|验证|Sign in|Log in/i;
const closeLabel = /^(?:关闭|关闭弹窗|Close|Dismiss|×|✕)$/i;

// Runs in the page. Match the observed promotion and an explicitly named close
// button, without following its download link or removing DOM nodes directly.
function dismissDoubaoPromotion() {
    const visible = node => Boolean(node.getClientRects().length);
    for (const dialog of document.querySelectorAll('[role="dialog"],[aria-modal="true"],.semi-modal-content')) {
        const text = dialog.innerText || '';
        if (!visible(dialog) || !/下载豆包(?:电脑|桌面)版/.test(text.replace(/\s+/g, ''))
            || /用户协议|隐私政策|服务条款|首次使用|用户须知|登录|注册|验证|Sign in|Log in/i.test(text)) continue;
        const button = [...dialog.querySelectorAll('button,[role="button"]')].find(node => {
            const label = (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim();
            return visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
                && /^(?:关闭|关闭弹窗|Close|Dismiss|×|✕)$/i.test(label);
        });
        if (button) { button.click(); return true; }
    }
    return false;
}

function promotionOverlay(page) {
    return page.locator('[role="dialog"],[aria-modal="true"],.semi-modal-content')
        .filter({ hasText: promotionTitle }).filter({ hasNotText: protectedPrompt })
        .filter({ has: page.getByRole('button', { name: closeLabel }) }).first();
}

module.exports = { dismissDoubaoPromotion, promotionOverlay };
