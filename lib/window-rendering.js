const checks = new WeakMap();

// Background tabs remain in place. Minimized native windows stop animation
// frames, however, so Playwright cannot finish its ordinary stability checks.
async function ensureRendered(page) {
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
                await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
                console.log('程序浏览器已最小化，已恢复窗口以继续操作；可以用其他窗口遮挡浏览器。');
            }
        } finally { await session.detach().catch(() => {}); }
    })();
    checks.set(page, entry);
    try { await entry.pending; }
    finally { entry.pending = null; }
}

module.exports = { ensureRendered };
