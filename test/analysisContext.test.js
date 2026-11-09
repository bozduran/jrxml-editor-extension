// test/analysisContext.test.js
// The analysis pipeline must scan a document once and hand the tree to every
// rule. Scan counting is the observable behaviour; it is not an internal mock.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const xmlspan = require('../out/xmlspan');
const originalScanXml = xmlspan.scanXml;
let scans = 0;
xmlspan.scanXml = function (text) {
    scans++;
    return originalScanXml(text);
};

const { collectFindings } = require('../out/diagnostics');

test('a diagnostics pass scans the document exactly once', () => {
    const fileName = path.resolve('test/fixtures/TextReport.jrxml');
    const text = fs.readFileSync(fileName, 'utf8');

    scans = 0;
    collectFindings({ text, fileName, workspaceRoots: [] });

    assert.strictEqual(scans, 1);
});

test('malformed XML still crosses one scan and keeps the pipeline isolated', () => {
    scans = 0;
    const findings = collectFindings({
        text: '<jasperReport name="Broken"><field name="x"',
        fileName: '/test/Broken.jrxml',
        workspaceRoots: [],
    });

    assert.strictEqual(scans, 1);
    assert.ok(Array.isArray(findings));
});
