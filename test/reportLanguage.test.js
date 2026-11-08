// test/reportLanguage.test.js
// Pure tests for the report's document expression language.

const test   = require('node:test');
const assert = require('node:assert');

const { reportLanguage, isJavaLanguage } = require('../reportLanguage');

test('reads the language attribute and its value span', () => {
    const text = '<jasperReport name="R" language="groovy"/>';
    const result = reportLanguage(text);

    assert.strictEqual(result.language, 'groovy');
    assert.strictEqual(result.declared, true);
    assert.strictEqual(text.slice(result.offset, result.offset + result.length), 'groovy');
});

test('normalizes the attribute value case', () => {
    assert.strictEqual(reportLanguage('<jasperReport language="JavaScript"/>').language, 'javascript');
    assert.strictEqual(reportLanguage('<jasperReport language="JAVA"/>').language, 'java');
});

test('defaults to Java when the attribute is absent or empty', () => {
    const absent = reportLanguage('<jasperReport name="R"/>');
    assert.strictEqual(absent.language, 'java');
    assert.strictEqual(absent.declared, false);
    assert.strictEqual(absent.offset, -1);

    const empty = reportLanguage('<jasperReport name="R" language=""/>');
    assert.strictEqual(empty.language, 'java');
    assert.strictEqual(empty.declared, false);
});

test('defaults to Java when the document cannot be scanned', () => {
    const result = reportLanguage('<jasperReport language="groovy">');
    assert.strictEqual(result.language, 'java');
    assert.strictEqual(result.declared, false);
});

test('isJavaLanguage accepts only java', () => {
    assert.strictEqual(isJavaLanguage('<jasperReport/>'), true);
    assert.strictEqual(isJavaLanguage('<jasperReport language="java"/>'), true);
    assert.strictEqual(isJavaLanguage('<jasperReport language="groovy"/>'), false);
});
