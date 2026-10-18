const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const result = spawnSync(path.resolve(process.argv[2] || 'dist/UOOC-Study.exe'), ['--check'], {
    windowsHide: true, encoding: 'utf8', timeout: 60000
});
if (result.error) throw result.error;
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
assert.equal(result.status, 0, 'Packaged environment check failed');
assert.ok(result.stdout.includes(`UOOC Study ${require('../package.json').version}`), 'Launcher did not return the expected version');
