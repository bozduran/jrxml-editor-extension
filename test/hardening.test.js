// test/hardening.test.js
// Guards against the two "one bad input breaks everything" failure modes:
// unbounded recursion, and a throwing section taking the rest down with it.

const test   = require('node:test');
const assert = require('node:assert');

const { parseExpression }   = require('../javaParser');
const { checkNullDereference } = require('../lintNullDeref');
const { scanXml }           = require('../xmlspan');
const { parse: parseSort }  = require('../xmlSort');
const { lintXml }           = require('../xmlLint');
const { collectTextCheckIssues } = require('../textCheck');

const DEEP = 50000;

function deeplyNestedXml(depth) {
    return '<a>'.repeat(depth) + '</a>'.repeat(depth);
}

// ── parser depth cap ──────────────────────────────────────────────────────────

test('the Java parser refuses input nested beyond its depth cap', () => {
    const nested = '('.repeat(500) + 'a' + ')'.repeat(500);
    assert.doesNotThrow(() => parseExpression(nested));
    assert.strictEqual(parseExpression(nested), null);

    const unary = '!'.repeat(500) + 'a';
    assert.doesNotThrow(() => parseExpression(unary));
    assert.strictEqual(parseExpression(unary), null);
});

test('nesting below the cap still parses', () => {
    const ok = '('.repeat(20) + 'a' + ')'.repeat(20);
    assert.ok(parseExpression(ok));
});

test('the null-dereference rule skips over-deep expressions instead of throwing', () => {
    const nested = '('.repeat(500) + '$V{v}' + ')'.repeat(500) + '.foo()';
    assert.doesNotThrow(() => checkNullDereference(nested));
    assert.deepStrictEqual(checkNullDereference(nested), []);
});

// ── XML walk depth ────────────────────────────────────────────────────────────

test('xmlspan walks deeply nested documents without overflowing', () => {
    const text = deeplyNestedXml(DEEP);

    let doc, error;
    assert.doesNotThrow(() => ({ doc, error } = scanXml(text)));
    assert.strictEqual(error, null);

    let count = 0;
    assert.doesNotThrow(() => { for (const _ of doc.walk()) count++; });
    assert.strictEqual(count, DEEP);
});

test('xmlSort parses deeply nested documents without overflowing', () => {
    const text = deeplyNestedXml(DEEP);

    let parsed;
    assert.doesNotThrow(() => { parsed = parseSort(text); });
    assert.deepStrictEqual(parsed.containers, []);
});

// ── section isolation ─────────────────────────────────────────────────────────

test('linting a document with an over-deep expression does not throw', () => {
    const text = [
        '<jasperReport name="R">',
        '  <variable name="V" class="java.lang.Object">',
        '    <expression><![CDATA[' + '('.repeat(500) + '$V{v}' + ')'.repeat(500) + '.foo()]]></expression>',
        '  </variable>',
        '</jasperReport>',
    ].join('\n');

    let result;
    assert.doesNotThrow(() => { result = lintXml(text); });
    assert.strictEqual(result.error, null);
    assert.deepStrictEqual(result.findings, []);
});

test('text check and lint survive malformed-but-scannable documents', () => {
    const text = '<jasperReport name="R"><element kind="textField"><expression><![CDATA["a  b"]]></expression></element></jasperReport>';

    assert.doesNotThrow(() => collectTextCheckIssues(text));
    assert.doesNotThrow(() => lintXml(text));
});
