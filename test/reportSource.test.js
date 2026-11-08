// test/reportSource.test.js
// The parser seam: a report source is text plus a stable identity and version,
// not a VS Code TextDocument. Headless callers should not impersonate one.

const test   = require('node:test');
const assert = require('node:assert');

const { parseReport } = require('../jrxmlParser');
const { textSource, documentSource } = require('../reportSource');

test('parses a plain report source without a TextDocument', () => {
    const text = `<jasperReport name="R"><field name="amount" class="java.math.BigDecimal"/></jasperReport>`;
    const parsed = parseReport(textSource(text, 'memory://report', 1));

    assert.deepStrictEqual(parsed.fields.map(field => field.name), ['amount']);
    assert.strictEqual(parsed.fields[0].fullType, 'java.math.BigDecimal');
});

test('adapts a document to the same source shape', () => {
    const text = `<jasperReport name="R"><field name="name" class="java.lang.String"/></jasperReport>`;
    const document = {
        version: 7,
        uri: { toString: () => 'file:///report.jrxml' },
        getText: () => text,
    };

    const source = documentSource(document);

    assert.strictEqual(source.text, text);
    assert.strictEqual(source.id, 'file:///report.jrxml');
    assert.strictEqual(source.version, 7);
});

test('caches by source identity and version, not by object shape', () => {
    const first = parseReport(textSource('<jasperReport name="R"><field name="a" class="java.lang.String"/></jasperReport>', 'memory://cache', 1));
    const second = parseReport(textSource('<jasperReport name="R"><field name="b" class="java.lang.String"/></jasperReport>', 'memory://cache', 2));

    assert.deepStrictEqual(first.fields.map(field => field.name), ['a']);
    assert.deepStrictEqual(second.fields.map(field => field.name), ['b']);
});
