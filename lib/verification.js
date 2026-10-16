// Try the site's ordinary checkbox once. Challenges and failures stay with the user.
function inspectCheckbox(root) {
    const image = root.ownerDocument?.getElementById('aliyunCaptcha-img');
    if (image?.getClientRects().length) return 'manual';
    const text = root.innerText || '';
    if (/验证成功|验证通过|验证已通过/.test(text)) return 'verified';
    if (/失败|未通过|重试|刷新|频繁/.test(text)) return 'manual';
    if (/验证中|加载中/.test(text)) return 'checking';
    return /点击复选框/.test(text) ? 'ready' : 'manual';
}

class SimpleVerification {
    constructor() { this.attempted = false; this.ready = false; }

    async step(page) {
        const visible = [];
        for (const frame of page.frames()) {
            for (const root of await frame.locator('#aliyunCaptcha-checkbox-wrapper').all()) {
                if (await root.isVisible().catch(() => false)) visible.push(root);
            }
        }
        // Do not guess when multiple widgets or a different provider is present.
        if (visible.length !== 1) { this.ready = false; return 'unavailable'; }
        const root = visible[0];
        const status = await root.evaluate(inspectCheckbox);
        if (status !== 'ready') { this.ready = false; return status; }
        if (this.attempted) return 'manual';
        const icon = root.locator('#aliyunCaptcha-checkbox-icon');
        if (!await icon.isVisible().catch(() => false)) { this.ready = false; return 'unavailable'; }
        // The widget can render its label before its click handler is ready.
        // Observe it again on the next polling tick before the single attempt.
        if (!this.ready) { this.ready = true; return 'checking'; }
        this.attempted = true;
        console.log('  正在尝试一次官网智能验证复选框；若出现挑战或失败，将等待本人处理。');
        try { await icon.click({ timeout: 3000 }); }
        catch { return 'manual'; }
        return 'clicked';
    }
}

module.exports = { SimpleVerification, inspectCheckbox };
