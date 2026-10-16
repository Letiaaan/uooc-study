const { setTimeout: delay } = require('node:timers/promises');

function navigationInterrupted(error) {
    return /Execution context was destroyed|Cannot find context with specified id|most likely because of a navigation|frame was detached|Frame has been detached/i.test(error.message);
}

// Only repeat reads. Sending a message or submitting a paper must never be retried here.
async function readAfterNavigation(page, read, { check = async () => {}, pause = delay, attempts = 12 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        await check();
        if (page.isClosed()) throw new Error('网页已关闭，请重新连接');
        try { return await read(); }
        catch (error) {
            if (!navigationInterrupted(error) || attempt === attempts - 1) throw error;
            await pause(300);
        }
    }
}

module.exports = { navigationInterrupted, readAfterNavigation };
