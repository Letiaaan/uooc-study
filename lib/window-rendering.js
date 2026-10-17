const checks = new WeakMap();
const { restoreBackground } = require('./window-attention');

// Background tabs remain in place. Minimized native windows stop animation
// frames, however, so Playwright cannot finish its ordinary stability checks.
async function ensureRendered(page, { restore = restoreBackground } = {}) {
    if (!page?.context || !page.context().newCDPSession || page.isClosed()) return;
    const previous = checks.get(page);
    if (previous?.pending) return previous.pending;
    if (previous && Date.now() - previous.at < 1000) return;
    const entry = { at: Date.now() };
    entry.pending = (async () => {
        const session = await page.context().newCDPSession(page);
        try {
            const { targetInfo } = await session.send('Target.getTargetInfo');
            const { windowId, bounds } = await session.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
            if (bounds.windowState === 'minimized') {
                if (await restore(page)) {
                    console.log('程序浏览器已在后台恢复绘制，不切换当前前台窗口。');
                } else if (process.platform !== 'win32') {
                    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
                } else {
                    throw new Error('无法在后台恢复程序浏览器，请手动取消最小化后重试；可以用其他窗口遮挡浏览器。');
                }
            }
        } finally { await session.detach().catch(() => {}); }
    })();
    checks.set(page, entry);
    try { await entry.pending; }
    finally { entry.pending = null; }
}

module.exports = { ensureRendered };
