// test/lintNullDeref.test.js

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { checkNullDereference, maskReferences } = require('../lintNullDeref');
const { lintXml } = require('../xmlLint');

const SAFE = [
    '$V{v} != null && $V{v}.foo()',
    '$V{v} == null || $V{v}.foo()',
    '$V{v} != null ? $V{v}.foo() : ""',
    '!($V{v} == null) && $V{v}.foo()',
    'EQUALS($V{v}, null) ? "" : $V{v}.foo()',
    'EQUALS(null, $V{v}) ? "" : $V{v}.foo()',
    'null != $V{v} && $V{v}.foo()',
    'null == $V{v} || $V{v}.foo()',
    'Objects.nonNull($V{v}) && $V{v}.foo()',
    'Objects.equals($V{v}, null) ? "" : $V{v}.foo()',
    'Objects.isNull($V{v}) ? "" : $V{v}.foo()',
    'String.valueOf($V{v})',          // argument, not a receiver
    '"$V{v}.foo()"',                  // inside a literal
];

test('recognised null checks suppress the warning', () => {
    for (const expr of SAFE) {
        assert.deepStrictEqual(checkNullDereference(expr), [], expr);
    }
});

test('flags an unguarded receiver', () => {
    const warnings = checkNullDereference('$V{v}.foo()');
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].message,
        '$V{v} may be null when .foo(...) is called; check it for null first');
    assert.strictEqual(warnings[0].offset, 0);
    assert.strictEqual(warnings[0].length, '$V{v}'.length);
});

test('a check with the wrong outcome still warns', () => {
    assert.strictEqual(checkNullDereference('EQUALS($V{v}, null) && $V{v}.foo()').length, 1);
});

test('only the null branch of a ternary warns', () => {
    const warnings = checkNullDereference('$V{v} != null ? $V{v}.foo() : $V{v}.bar()');
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0].message, /\.bar\(\.\.\.\)/);
});

test('only the innermost receiver of a chain warns', () => {
    const warnings = checkNullDereference('$V{a}.b().c()');
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0].message, /\.b\(\.\.\.\)/);
});

test('qualifies the reference with its kind', () => {
    assert.match(checkNullDereference('$F{a}.foo()')[0].message, /^\$F\{a\}/);
    assert.match(checkNullDereference('$P{a}.foo()')[0].message, /^\$P\{a\}/);
    assert.match(checkNullDereference('$V{a}.foo()')[0].message, /^\$V\{a\}/);
});

test('unparseable or non-identifier references are skipped', () => {
    assert.deepStrictEqual(checkNullDereference('$P!{x}.foo()'), []);
    assert.deepStrictEqual(checkNullDereference('$V{a.b}.foo()'), []);
    assert.deepStrictEqual(checkNullDereference('(a'), []);
    assert.deepStrictEqual(checkNullDereference(''), []);
});

test('masking is length-preserving and skips literals', () => {
    assert.strictEqual(maskReferences('$V{v}.foo()'), '$V_v_.foo()');
    assert.strictEqual(maskReferences('$V{CityNumber}'), '$V_CityNumber_');
    assert.strictEqual(maskReferences('"$V{v}"'), '"$V{v}"');
    assert.strictEqual(maskReferences('$V{a.b}'), '$V{a.b}');
    assert.strictEqual(
        maskReferences('$V{v}').length,
        '$V{v}'.length
    );
});

test('golden: NullCheckReport reports exactly the unsafe expression', () => {
    const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'NullCheckReport.jrxml'), 'utf8');
    const { findings, error } = lintXml(text);

    assert.strictEqual(error, null);
    assert.strictEqual(findings.length, 1);

    const [finding] = findings;
    assert.strictEqual(finding.code, 'jrxml.lint.uncheckedNullDereference');
    assert.strictEqual(finding.message,
        '$V{CityNumber} may be null when .toString(...) is called; check it for null first');

    const line = text.slice(0, finding.offset).split('\n').length;
    assert.strictEqual(line, 4);
});

test('the rule can be switched off', () => {
    const text = '<jasperReport name="x"><expression><![CDATA[$V{v}.foo()]]></expression></jasperReport>';
    assert.strictEqual(lintXml(text).findings.length, 1);
    assert.strictEqual(lintXml(text, { uncheckedNullDereference: false }).findings.length, 0);
});
