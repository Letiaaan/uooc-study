const { setTimeout: delay } = require('node:timers/promises');

class Control {
    constructor() {
        this.paused = false;
        this.waited = 0;
        this.abort = new AbortController();
    }
    get stopped() { return this.abort.signal.aborted; }
    pause() { this.paused = true; }
    resume() { this.paused = false; }
    stop() { this.abort.abort(); this.paused = false; }
    async checkpoint() {
        const start = Date.now();
        while (this.paused && !this.stopped) await delay(200);
        if (this.stopped) { const error = new Error('任务已停止'); error.code = 'STOPPED'; throw error; }
        const elapsed = Date.now() - start;
        this.waited += elapsed;
        return elapsed;
    }
}

module.exports = { Control };
