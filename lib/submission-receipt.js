// Observe the website's own submission; never send or replay a request here.
function watchSubmission(page) {
    let active = true;
    const receipt = { value: null };
    const observe = async response => {
        try {
            const url = new URL(response.url());
            if (url.origin !== 'https://www.uooc.net.cn' || url.pathname !== '/exam/commit'
                || response.request().method() !== 'POST') return;
            const body = await response.json();
            if (!active) return;
            receipt.value = { code: Number(body.code), message: String(body.msg || '').slice(0, 200) };
        } catch {} // DOM and directory confirmation remain available.
    };
    page.on?.('response', observe);
    receipt.close = () => { active = false; page.off?.('response', observe); };
    return receipt;
}

module.exports = { watchSubmission };
