const rendering = new WeakMap();
const { restoreBackground } = require('./window-attention');

// Chromium suspends animation frames in minimized windows, including the
// stability checks used by Playwright. This session keeps the page rendering
// without changing the native window state or the user's foreground window.
// The override disappears when its CDP session is detached.
async function ensureRendered(page) {
    if (!page?.context || !page.context().newCDPSession || page.isClosed()) return;
    if (rendering.has(page)) return rendering.get(page);
    const pending = (async () => {
        const session = await page.context().newCDPSession(page);
        try {
            await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        } catch (error) {
            await session.detach().catch(() => {});
            throw new Error('浏览器无法保持最小化绘制，请更新 Chrome / Edge 后重试，或手动取消最小化。', { cause: error });
        }
        const disconnected = () => { rendering.delete(page); page.off?.('close', closed); };
        const closed = () => { rendering.delete(page); void session.detach().catch(() => {}); };
        session.once?.('close', disconnected);
        page.once?.('close', closed);
        if (page.isClosed()) closed();
    })();
    rendering.set(page, pending);
    try { await pending; }
    catch (error) { rendering.delete(page); throw error; }
}

// Restoring a native window is reserved for an explicit user action.
async function showPage(page) {
    await ensureRendered(page);
    if (page?.context?.().newCDPSession && !page.isClosed()) {
        if (process.platform === 'win32') await restoreBackground(page);
        else {
            const session = await page.context().newCDPSession(page);
            try {
                const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
                if (bounds.windowState === 'minimized') await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
            } finally { await session.detach().catch(() => {}); }
        }
    }
    await page.bringToFront();
}

module.exports = { ensureRendered, showPage };
