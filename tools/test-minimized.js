// Opt-in native Windows regression. Uses only local synthetic media/questions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { launchLocalBrowser } = require('../lib/local-browser');
const { backgroundPage } = require('../lib/browser');
const { ensureRendered, showPage } = require('../lib/window-rendering');
const { playResource } = require('../lib/media');
const { Control } = require('../lib/control');

async function foreground() {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command',
        'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class UoocFocusProbe { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }\'; [UoocFocusProbe]::GetForegroundWindow().ToInt64()'], { windowsHide: true });
    return stdout.trim();
}

function silentWave() {
    const samples = 8000 * 6;
    const buffer = Buffer.alloc(44 + samples * 2);
    buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
    return buffer;
}

const lesson = `<!doctype html><meta charset="utf-8"><video src="/media.wav" width="400" height="200" muted></video>
<script>
window.framesCount=0; window.attempts=0; window.prompted=false; window.completed=false;
function tick(){framesCount++;requestAnimationFrame(tick)};tick();
const video=document.querySelector('video');
video.onended=()=>window.completed=true;
video.ontimeupdate=()=>{
 if(video.currentTime<0.5||window.prompted)return;
 window.prompted=true;video.pause();
 const root=document.createElement('div');root.id='quizLayer';
 root.innerHTML='<div class="smallTest-view"><div class="ti-q-c">本地演示题</div>'+[0,1,2,3].map(i=>'<label style="display:block"><input type="radio" name="demo" value="'+i+'">演示选项 '+i+'</label>').join('')+'</div><div class="mpopup-bottom"><span ng-if="wrongTip" class="fl_left"></span><button class="btn-success">确定</button></div>';
 root.querySelector('button').onclick=()=>{attempts++;if(root.querySelector('input:checked')?.value==='3')root.remove();else root.querySelector('span').textContent='回答错误，请重新选择';};
 document.body.append(root);
};
</script>`;

async function run(channel) {
    const relative = channel === 'chrome' ? 'Google/Chrome/Application/chrome.exe' : 'Microsoft/Edge/Application/msedge.exe';
    const executable = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
        .filter(Boolean).map(base => path.join(base, relative)).find(file => fs.existsSync(file));
    assert.ok(executable, `Install ${channel} to run this acceptance test`);
    const initialFocus = await foreground();
    const profile = path.resolve('.build', `minimized-${channel}-${Date.now()}`);
    const context = await launchLocalBrowser(executable, profile, { background: true, remember: false });
    let timer;
    try {
        const wave = silentWave();
        await context.route('http://minimized.test/**', route => route.fulfill({
            contentType: route.request().url().endsWith('.wav') ? 'audio/wav' : 'text/html; charset=utf-8',
            body: route.request().url().endsWith('.wav') ? wave : lesson
        }));
        const page = await backgroundPage(context);
        await page.goto('http://minimized.test/lesson#demo');
        const session = await context.newCDPSession(page);
        const { windowId } = await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
        const states = [];
        const sample = async () => states.push((await session.send('Browser.getWindowForTarget')).bounds.windowState);
        let failure;
        timer = setInterval(() => void sample().catch(error => { failure = error; }), 200);
        const start = await page.evaluate(() => framesCount);
        const positions = [];
        const outcome = await playResource({ page, confirmed: async () => page.evaluate(() => completed) },
            { id: 'demo', title: '本地最小化演示' }, { record() {} }, {
                control: new Control(), onProgress: state => { if (state.position) positions.push(state.position); },
                onVerify: value => { if (value) throw Error('Unexpected manual intervention'); }
            });
        assert.equal(outcome, '网站确认完成');
        assert.equal(await page.evaluate(() => attempts), 4);
        assert.ok(positions.at(-1) > 5);
        assert.ok(await page.evaluate(() => framesCount) > start + 20);
        // Navigation must retain the rendering session while still minimized.
        await page.goto('http://minimized.test/next#demo');
        await ensureRendered(page);
        await page.locator('video').evaluate(video => video.insertAdjacentHTML('afterend', '<button id="next" onclick="this.textContent=\'clicked\'">next</button>'));
        await page.locator('#next').click({ timeout: 3000 });
        assert.equal(await page.locator('#next').textContent(), 'clicked');
        await sample();
        clearInterval(timer); timer = null;
        if (failure) throw failure;
        assert.ok(states.length >= 10);
        assert.ok(states.every(state => state === 'minimized'), JSON.stringify(states));
        assert.equal(await foreground(), initialFocus, 'Automated playback changed the foreground window');
        // Explicit user action is allowed to restore the window.
        await showPage(page);
        for (let i = 0; i < 20 && (await session.send('Browser.getWindowForTarget')).bounds.windowState === 'minimized'; i++) await page.waitForTimeout(100);
        assert.notEqual((await session.send('Browser.getWindowForTarget')).bounds.windowState, 'minimized');
        await session.detach();
        return { channel, playback: 'completed', promptAttempts: 4, minimizedSamples: states.length, navigation: 'passed', foregroundUnchanged: true, explicitRestore: 'passed' };
    } finally { clearInterval(timer); await context.close(); }
}

(async () => {
    assert.equal(process.platform, 'win32', 'This opt-in test requires a Windows desktop');
    const results = [];
    for (const channel of ['chrome', 'msedge']) { results.push(await run(channel)); console.log(JSON.stringify(results.at(-1))); }
    fs.writeFileSync(path.resolve('.build/minimized-results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
