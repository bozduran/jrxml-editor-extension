// test/validateWorkspace.test.js
// The CI entry point: file discovery, aggregation and JSON output.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    collectFiles,
    validateFiles,
    summarise,
    formatJson,
} from '../out/tools/validate-workspace.js';

const VALID = '<jasperReport name="V"><expression><![CDATA["ok"]]></expression></jasperReport>';
const INVALID = '<jasperReport name="B"><expression><![CDATA[$F{missing}]]></expression></jasperReport>';

/** The slice of the `formatJson` payload the test reads. */
interface JsonFinding {
    code: string;
    line: number;
    column: number;
}

interface JsonFile {
    file: string;
    findings: JsonFinding[];
}

interface JsonPayload {
    summary: {
        files: number;
        errors: number;
        warnings: number;
    };
    files: JsonFile[];
}

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
    assert.ok(invalid, 'invalid.jrxml must be among the results');
    assert.ok(invalid.findings.some(finding => finding.code === 'jrxml.undeclaredReference'));
});

test('formatJson is machine-readable and carries line/column positions', () => {
    const dir = fixtureTree();
    const payload = JSON.parse(formatJson(validateFiles(collectFiles(dir)))) as JsonPayload;

    assert.strictEqual(payload.summary.files, 3);
    assert.strictEqual(payload.summary.errors, 1);
    assert.strictEqual(payload.files.length, 3);

    const invalid = payload.files.find(file => file.file.endsWith('invalid.jrxml'));
    assert.ok(invalid, 'invalid.jrxml must be in the payload');
    const finding = invalid.findings.find(item => item.code === 'jrxml.undeclaredReference');
    assert.ok(finding, 'expected an undeclared-reference finding');
    assert.strictEqual(finding.line, 1);
    assert.ok(finding.column > 1);
});
