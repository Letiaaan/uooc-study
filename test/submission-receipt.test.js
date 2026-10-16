const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { watchSubmission } = require('../lib/submission-receipt');

test('submission observes only the actual website POST, retains its business result and detaches', async () => {
    const page = new EventEmitter(), receipt = watchSubmission(page);
    const response = (url, method, body) => ({ url: () => url, request: () => ({ method: () => method }), json: async () => body });
    page.emit('response', response('https://www.uooc.net.cn/exam/commit', 'GET', { code: 1 }));
    page.emit('response', response('https://example.org/exam/commit', 'POST', { code: 1 }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(receipt.value, null);
    page.emit('response', response('https://www.uooc.net.cn/exam/commit', 'POST', { code: 0, msg: '验证结果已过期', data: { private: 'must not retain' } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(receipt.value, { code: 0, message: '验证结果已过期' });
    receipt.close();
    assert.equal(page.listenerCount('response'), 0);
});
