// test/hardening.test.js
// Guards against the two "one bad input breaks everything" failure modes:
// unbounded recursion, and a throwing section taking the rest down with it.

import test from 'node:test';
import assert from 'node:assert';

import { parseExpression } from '../out/javaParser.js';
import { checkNullDereference } from '../out/lintNullDeref.js';
import { scanXml } from '../out/xmlspan.js';
import { parse as parseSort } from '../out/xmlSort.js';
import { lintXml } from '../out/xmlLint.js';
import { collectTextCheckIssues } from '../out/textCheck.js';
import type { XmlDocument } from '../out/xmlspan.js';
import type { ParsedSort } from '../out/xmlSort.js';
import type { LintResult } from '../out/xmlLint.js';

const DEEP = 50000;

function deeplyNestedXml(depth: number): string {
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

    let doc: XmlDocument | null = null;
    let error: string | null = null;
    assert.doesNotThrow(() => ({ doc, error } = scanXml(text)));
    assert.strictEqual(error, null);
    assert.ok(doc, 'the deeply nested document must scan');
    // TypeScript cannot see the callback assignment above, so name the scanned
    // document for the closure that walks it.
    const scannedDoc: XmlDocument = doc;

    let count = 0;
    assert.doesNotThrow(() => { for (const _ of scannedDoc.walk()) count++; });
    assert.strictEqual(count, DEEP);
});

test('xmlSort parses deeply nested documents without overflowing', () => {
    const text = deeplyNestedXml(DEEP);

    let parsed: ParsedSort | null = null;
    assert.doesNotThrow(() => { parsed = parseSort(text); });
    assert.ok(parsed, 'the deeply nested document must sort-parse');
    const sortResult: ParsedSort = parsed;
    assert.deepStrictEqual(sortResult.containers, []);
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

    let result: LintResult | null = null;
    assert.doesNotThrow(() => { result = lintXml(text); });
    assert.ok(result, 'linting must produce a result');
    const lintResult: LintResult = result;
    assert.strictEqual(lintResult.error, null);
    assert.deepStrictEqual(lintResult.findings, []);
});

test('text check and lint survive malformed-but-scannable documents', () => {
    const text = '<jasperReport name="R"><element kind="textField"><expression><![CDATA["a  b"]]></expression></element></jasperReport>';

    assert.doesNotThrow(() => collectTextCheckIssues(text));
    assert.doesNotThrow(() => lintXml(text));
});
