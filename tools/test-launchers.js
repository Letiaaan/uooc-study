// Windows integration checks after build; no course, AI, desktop browser or
// real credentials are used. GUI launchers run with --no-open in private fixtures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

if (process.platform !== 'win32') { console.log('Launcher integration requires Windows.'); process.exit(0); }
const { createGuiServer } = require('../lib/gui');
const repo = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const root = path.join(repo, '.build', 'launcher-test-' + randomUUID());
fs.mkdirSync(root, { recursive: true });

async function until(test, reason, timeout = 20000) {
    const deadline = Date.now() + timeout;
    do { const result = await test(); if (result) return result; await delay(75); } while (Date.now() < deadline);
    throw new Error(reason);
}
async function exited(child) {
    await until(() => child.exitCode !== null, 'Owned test launcher did not exit');
    assert.equal(child.exitCode, 0);
}
function folder(name) {
    const home = path.join(root, name);
    fs.mkdirSync(home);
    fs.copyFileSync(path.join(repo, 'dist/UOOC-Study.exe'), path.join(home, 'UOOC-Study.exe'));
    return home;
}
function launch(home) {
    return spawn(path.join(home, 'UOOC-Study.exe'), ['--no-open'], { cwd: home, stdio: 'ignore' });
}
async function record(home) {
    return until(() => { try { const value = JSON.parse(fs.readFileSync(path.join(home, 'data/gui-instance.json'))); return value.url && value; } catch { return null; } }, 'Workbench did not publish its address');
}
async function api(url, endpoint, body) {
    const response = await fetch(new URL('/api/' + endpoint, url), { method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${new URL(url).hash.slice(7)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(4000) });
    assert.equal(response.status, 200);
    return response.json();
}
async function simultaneous(mixed) {
    const home = folder(mixed ? 'mixed' : 'exe');
    const children = [];
    if (mixed) {
        for (const name of ['start.bat', 'start.vbs']) fs.copyFileSync(path.join(repo, name), path.join(home, name));
        fs.writeFileSync(path.join(home, 'app.js'), `require(${JSON.stringify(path.join(repo, 'lib/gui'))}).startGUI({open:false}).catch(error=>{console.error(error);process.exitCode=1})`);
        for (const name of ['playwright', '@inquirer/prompts']) {
            const dir = path.join(home, 'node_modules', name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        }
        for (let i = 0; i < 2; i++) children.push(spawn(path.join(process.env.SystemRoot, 'System32/wscript.exe'), [path.join(home, 'start.vbs')], {
            cwd: home, stdio: 'ignore', env: { ...process.env, UOOC_STUDY_HOME: home }
        }));
    } else children.push(launch(home));
    children.push(launch(home));
    let current;
    try {
        current = await record(home);
        await until(() => children.filter(child => child.exitCode === 0).length === children.length - 1, 'Duplicate launchers did not reuse the service');
        assert.equal((await api(current.url, 'state')).version, version);
        assert.equal((await api(current.url, 'instance')).instance, current.instance);
        if (mixed) assert.equal(fs.readdirSync(path.join(home, 'data')).filter(name => /^bootstrap-.*\.log$/.test(name)).length, 2);
        await api(current.url, 'shutdown', {});
        await Promise.all(children.map(exited));
        assert.equal(fs.existsSync(path.join(home, 'data/gui-instance.json')), false);
        console.log(`${mixed ? 'BAT + EXE' : 'EXE'} simultaneous launch: one backend, clean shutdown.`);
    } finally {
        if (current) try { await api(current.url, 'shutdown', {}); } catch {}
        for (const child of children) if (child.exitCode === null) child.kill();
    }
}

async function lockedLegacyLog() {
    const home = folder('legacy');
    fs.mkdirSync(path.join(home, 'data'));
    const app = await createGuiServer({ controller: { snapshot: () => ({ version: '0.4.18', settings: {}, courses: [] }), close: async () => {} } });
    const log = path.join(home, 'data/startup.log'), ready = path.join(home, 'ready'), release = path.join(home, 'release');
    fs.writeFileSync(log, 'UOOC Study\n' + app.url + '\n');
    const script = path.join(home, 'hold-log.ps1');
    fs.writeFileSync(script, `param($Log,$Ready,$Release)\n$stream=[IO.File]::Open($Log,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::Read)\ntry{[IO.File]::WriteAllText($Ready,'ready');while(-not [IO.File]::Exists($Release)){Start-Sleep -Milliseconds 100}}finally{$stream.Dispose()}`);
    const holder = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-Log', log, '-Ready', ready, '-Release', release], { windowsHide: true, stdio: 'ignore' });
    let child;
    try {
        await until(() => fs.existsSync(ready), 'Legacy log fixture did not start');
        child = launch(home);
        await exited(child);
        assert.equal((await api(app.url, 'state')).version, '0.4.18');
        assert.equal(fs.existsSync(path.join(home, 'data/gui-instance.json')), false);
        assert.ok(fs.readdirSync(path.join(home, 'data')).some(name => /^startup-\d+\.log$/.test(name)));
        console.log('Exclusive legacy startup.log: existing workbench recovered, no duplicate backend.');
    } finally {
        fs.writeFileSync(release, 'release');
        await exited(holder);
        if (child?.exitCode === null) child.kill();
        await app.close();
    }
}

(async () => { await simultaneous(false); await simultaneous(true); await lockedLegacyLog(); })()
    .catch(error => { console.error(error); process.exitCode = 1; });
