const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assets, validateTag, prepare, releaseNotes } = require('../tools/release-metadata');
const { X509Certificate } = require('node:crypto');

test('release version gates reject mismatched, prerelease and injectable tags', () => {
    assert.equal(validateTag('v0.4.13','0.4.13'), 'v0.4.13');
    for (const tag of ['v0.4.12', 'main', 'v0.4.13-beta', 'v0.4.13\nother=value', 'v0.4.13;echo test']) {
        assert.throws(() => validateTag(tag,'0.4.13'));
    }
});

test('release notes distinguish self-signed builds from unsigned builds and reject ambiguous metadata', () => {
    const common = { tag:'v0.4.14',version:'0.4.14',commit:'b'.repeat(40),repository:'example/uooc-study',changelog:'## 0.4.14\n\n- Signing support\n' };
    const unsigned = releaseNotes(common);
    assert.match(unsigned,/启动器未签名/);
    assert.doesNotMatch(unsigned,/申请待审核/);
    const signed = releaseNotes({...common,signing:{type:'self-signed',certificateSha256:'a'.repeat(64)}});
    assert.match(signed,/未经公共 CA 认证/);
    assert.doesNotMatch(signed,/启动器未签名/);
    assert.throws(()=>releaseNotes({...common,signing:{type:'self-signed',certificateSha256:'invalid'}}));
    assert.throws(()=>releaseNotes({...common,signing:{type:'trusted'}}));
});

test('the distributed certificate is a self-signed public code-signing certificate with the published fingerprint', () => {
    const certificate = new X509Certificate(fs.readFileSync(path.join(__dirname,'..','CODE_SIGNING_CERT.cer')));
    assert.match(certificate.subject,/Letiaaan \(Self-signed code signing\)/);
    assert.equal(certificate.verify(certificate.publicKey),true);
    assert.equal(certificate.ca,false);
    assert.equal(certificate.publicKey.asymmetricKeyDetails.modulusLength,3072);
    assert.ok(certificate.keyUsage.includes('1.3.6.1.5.5.7.3.3'));
    assert.equal(certificate.fingerprint256.replace(/:/g,''),'117B412815FEEB22338A2DADBD0CF1C4273EEA2F794573B884124E36AB39FB01');
});

test('release notes bind the version and commit; checksums cover every attachment', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'uooc-release-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root,'dist'));
    fs.writeFileSync(path.join(root,'package.json'), JSON.stringify({version:'0.4.13'}));
    fs.writeFileSync(path.join(root,'CHANGELOG.md'), '# Changes\n\n## 0.4.13\n\n- Current change\n\n## 0.4.12\n\n- Old change\n');
    for (const asset of assets) fs.writeFileSync(path.join(root,'dist',asset), `fixture ${asset}`);
    const options = {root, tag:'v0.4.13', commit:'a'.repeat(40), repository:'example/uooc-study'};
    prepare(options);
    const notes = fs.readFileSync(path.join(root,'.build','release-notes.md'),'utf8');
    assert.match(notes, /Current change/);
    assert.doesNotMatch(notes, /Old change/);
    assert.ok(notes.includes(options.commit));
    assert.match(notes, /启动器未签名/);
    const expected = assets.map(asset => createHash('sha256').update(`fixture ${asset}`).digest('hex') + '  ' + asset).join('\n') + '\n';
    assert.equal(fs.readFileSync(path.join(root,'dist','SHA256SUMS.txt'),'utf8'), expected);
    fs.unlinkSync(path.join(root,'dist',assets[0]));
    assert.throws(() => prepare(options), /ENOENT/);
});
