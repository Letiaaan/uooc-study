// An open response stream survives background/minimized tabs without relying
// on throttled browser timers. Only the last tab's disconnect schedules exit.
class GuiLifecycle {
    constructor({ onEmpty, grace = 500, openingGrace = 5000, initialGrace = 120000, waitForFirst = false } = {}) {
        this.onEmpty = onEmpty;
        this.grace = grace;
        this.openingGrace = openingGrace;
        this.openingUntil = 0;
        this.clients = new Set();
        this.closed = false;
        if (waitForFirst) this.expectClient(initialGrace);
    }
    expectClient(grace = this.openingGrace, onlyWhenEmpty = false) {
        if (this.closed || onlyWhenEmpty && this.clients.size) return;
        this.openingUntil = Date.now() + grace;
        if (!this.clients.size) this.schedule(grace);
    }
    schedule(delay) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { if (!this.closed && !this.clients.size) this.onEmpty(); }, delay);
        this.timer.unref?.();
    }
    connect(response) {
        if (this.closed) { response.end(); return; }
        clearTimeout(this.timer);
        this.openingUntil = 0;
        this.clients.add(response);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        response.write(': workbench connected\n\n');
        const keepalive = setInterval(() => response.write(': keepalive\n\n'), 20000);
        keepalive.unref?.();
        response.once('close', () => {
            clearInterval(keepalive);
            this.clients.delete(response);
            if (!this.closed && !this.clients.size) this.schedule(Math.max(this.grace, this.openingUntil - Date.now()));
        });
    }
    dispose() {
        this.closed = true;
        clearTimeout(this.timer);
        for (const response of this.clients) response.end();
        this.clients.clear();
    }
}

module.exports = { GuiLifecycle };
