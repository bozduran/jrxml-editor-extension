// test/validateWorkspace.test.js
// The CI entry point: file discovery, aggregation and JSON output.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const {
    collectFiles,
    validateFiles,
    summarise,
    formatJson,
} = require('../tools/validate-workspace');

const VALID = '<jasperReport name="V"><expression><![CDATA["ok"]]></expression></jasperReport>';
const INVALID = '<jasperReport name="B"><expression><![CDATA[$F{missing}]]></expression></jasperReport>';

function fixtureTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-validate-'));

    fs.writeFileSync(path.join(dir, 'valid.jrxml'), VALID);
    fs.writeFileSync(path.join(dir, 'invalid.jrxml'), INVALID);
    fs.mkdirSync(path.join(dir, 'nested'));
    fs.writeFileSync(path.join(dir, 'nested', 'also-valid.jrxml'), VALID);
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'ignored.jrxml'), INVALID);

    return dir;
}

test('collectFiles finds .jrxml files recursively and skips excluded folders', () => {
    const files = collectFiles(fixtureTree());
    const names = files.map(file => path.basename(file)).sort();

    assert.deepStrictEqual(names, ['also-valid.jrxml', 'invalid.jrxml', 'valid.jrxml']);
});

test('validateFiles and summarise count errors across the workspace', () => {
    const results = validateFiles(collectFiles(fixtureTree()));
    const totals  = summarise(results);

    assert.strictEqual(totals.files, 3);
    assert.strictEqual(totals.errors, 1);
    assert.ok(totals.warnings >= 0);

    const invalid = results.find(result => result.file.endsWith('invalid.jrxml'));
    assert.ok(invalid.findings.some(finding => finding.code === 'jrxml.undeclaredReference'));
});

test('formatJson is machine-readable and carries line/column positions', () => {
    const dir = fixtureTree();
    const payload = JSON.parse(formatJson(validateFiles(collectFiles(dir))));

    assert.strictEqual(payload.summary.files, 3);
    assert.strictEqual(payload.summary.errors, 1);
    assert.strictEqual(payload.files.length, 3);

    const invalid = payload.files.find(file => file.file.endsWith('invalid.jrxml'));
    const finding = invalid.findings.find(item => item.code === 'jrxml.undeclaredReference');
    assert.strictEqual(finding.line, 1);
    assert.ok(finding.column > 1);
});
