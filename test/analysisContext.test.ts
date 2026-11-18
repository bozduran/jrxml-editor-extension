// test/analysisContext.test.js
// The analysis pipeline must scan a document once and hand the tree to every
// rule. Scan counting is the observable behaviour; it is not an internal mock.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { createRequire } from 'node:module';

// The scan counter replaces the CommonJS export, so the module has to be loaded
// through require: an ES module namespace object is read-only.
const require = createRequire(import.meta.url);

interface MutableXmlspan {
    scanXml: typeof import('../out/xmlspan.js').scanXml;
}

const xmlspan = require('../out/xmlspan.js') as MutableXmlspan;
const originalScanXml = xmlspan.scanXml;
let scans = 0;
xmlspan.scanXml = (text: string) => {
    scans++;
    return originalScanXml(text);
};

import { collectFindings } from '../out/diagnostics.js';

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
