// test/textRules.test.js

const test   = require('node:test');
const assert = require('node:assert');

const {
    transformText,
    transformLiteral,
    transformExpression,
    applyUnrenderable,
    applyPeriodSpace,
    applyDoubleSpace,
    applyNewline,
} = require('../textRules');

test('unrenderable characters are replaced and reported once each', () => {
    const findings = [];
    const out = applyUnrenderable('a\u00A0b\u00A0c\u2014d\u2026', findings);

    assert.strictEqual(out, 'a b c-d...');
    assert.deepStrictEqual(findings, [
        'replace non-breaking space (U+00A0) with " "',
        'replace em dash (U+2014) with "-"',
        'replace ellipsis (U+2026) with "..."',
    ]);
});

test('zero-width space and soft hyphen are removed', () => {
    assert.strictEqual(applyUnrenderable('a\u200Bb\u00ADc', []), 'abc');
});

test('period space only before an uppercase letter', () => {
    const findings = [];
    assert.strictEqual(applyPeriodSpace('today.Swill and 3.14 and x. y', findings), 'today. Swill and 3.14 and x. y');
    assert.deepStrictEqual(findings, ["add space after '.' (1 occurrence)"]);
});

test('double space collapses and counts occurrences', () => {
    const findings = [];
    assert.strictEqual(applyDoubleSpace('a  b   c d', findings), 'a b c d');
    assert.deepStrictEqual(findings, ['remove double space (2 occurrences)']);
});

test('newline normalization follows the markup token', () => {
    assert.strictEqual(applyNewline('a<br/>b<br>c\\nd', 'styled'), 'a<br/>b<br/>c<br/>d');
    assert.strictEqual(applyNewline('a<br/>b<br>c\\nd', 'html'), 'a<br>b<br>c<br>d');
    assert.strictEqual(applyNewline('a<br/>b<br>c\\nd', ''), 'a\\nb\\nc\\nd');
    assert.strictEqual(applyNewline('a<br/>b<br>c\\nd', 'none'), 'a\\nb\\nc\\nd');
    assert.strictEqual(applyNewline('a<br/>b', 'rtf'), 'a<br/>b');
});

test('transformText runs the chain in the hook order', () => {
    // Recorded from `java -jar bin/myhooks.jar textcheck`.
    const findings = [];
    const out = transformText('A\u00A0B  C.Today<br/>D', 'styled', findings);

    assert.strictEqual(out, 'A B C. Today<br/>D');
    assert.deepStrictEqual(findings, [
        'replace non-breaking space (U+00A0) with " "',
        "add space after '.' (1 occurrence)",
        'remove double space (1 occurrence)',
    ]);
});

test('transformLiteral skips the period and newline rules', () => {
    const findings = [];
    const out = transformLiteral('x  y.Z\\n', findings);
    assert.strictEqual(out, 'x y.Z\\n');
    assert.deepStrictEqual(findings, ['remove double space (1 occurrence)']);
});

test('transformExpression rewrites only string/text-block literals', () => {
    // Recorded from `java -jar bin/myhooks.jar textcheck` (text context).
    const findings = [];
    const out = transformExpression('"x  y.Z" + $F{a}', true, '', findings);

    assert.strictEqual(out, '"x y. Z" + $F{a}');
    assert.deepStrictEqual(findings, [
        "add space after '.' (1 occurrence)",
        'remove double space (1 occurrence)',
    ]);
});

test('transformExpression leaves char literals and code untouched', () => {
    const out = transformExpression("'a' + x  .y", true, '', []);
    assert.strictEqual(out, "'a' + x  .y");
});

test('transformExpression honours non-text context (no period rule)', () => {
    const findings = [];
    const out = transformExpression('"a  b.C"', false, '', findings);
    assert.strictEqual(out, '"a b.C"');
    assert.deepStrictEqual(findings, ['remove double space (1 occurrence)']);
});

test('transformExpression preserves comments', () => {
    const out = transformExpression('// "a  b"\nx', true, '', []);
    assert.strictEqual(out, '// "a  b"\nx');
});

test('transformExpression is idempotent', () => {
    const once = transformExpression('"x  y.Z" + $F{a}', true, '', []);
    assert.strictEqual(transformExpression(once, true, '', []), once);
});
