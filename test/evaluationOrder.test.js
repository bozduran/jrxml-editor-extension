// test/evaluationOrder.test.js
// Variables are evaluated in declaration order: a reference to a variable
// declared later is reported, a backward/self reference is not.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { checkVariableOrder, CODE } = require('../evaluationOrder');

function report(body) {
    return `<jasperReport name="R">\n${body}\n</jasperReport>`;
}

test('a forward reference to a later variable is reported', () => {
    const text = report([
        '  <variable name="A" class="java.lang.String"><expression><![CDATA[$V{B}]]></expression></variable>',
        '  <variable name="B" class="java.lang.String"><expression><![CDATA["x"]]></expression></variable>',
    ].join('\n'));

    const findings = checkVariableOrder(text);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].code, CODE);
    assert.strictEqual(findings[0].variable, 'A');
    assert.strictEqual(findings[0].referenced, 'B');
    assert.strictEqual(text.slice(findings[0].offset, findings[0].offset + findings[0].length), '$V{B}');
    assert.match(findings[0].message, /declared later/);
});

test('a backward reference is fine', () => {
    const text = report([
        '  <variable name="A" class="java.lang.String"><expression><![CDATA["x"]]></expression></variable>',
        '  <variable name="B" class="java.lang.String"><expression><![CDATA[$V{A}]]></expression></variable>',
    ].join('\n'));

    assert.deepStrictEqual(checkVariableOrder(text), []);
});

test('a self-reference (accumulator) is fine', () => {
    const text = report([
        '  <variable name="Count" class="java.lang.Integer">',
        '    <initialValueExpression><![CDATA[$V{Count} == null ? 1 : $V{Count} + 1]]></initialValueExpression>',
        '  </variable>',
    ].join('\n'));

    assert.deepStrictEqual(checkVariableOrder(text), []);
});

test('built-in and undeclared variables are ignored', () => {
    const text = report([
        '  <variable name="A" class="java.lang.String">',
        '    <expression><![CDATA[$V{PAGE_NUMBER} + $V{Missing}]]></expression>',
        '  </variable>',
    ].join('\n'));

    assert.deepStrictEqual(checkVariableOrder(text), []);
});

test('report and dataset scopes are independent', () => {
    const text = report([
        '  <variable name="A" class="java.lang.String"><expression><![CDATA[$V{B}]]></expression></variable>',
        '  <dataset name="DS">',
        '    <variable name="B" class="java.lang.String"><expression><![CDATA[$V{C}]]></expression></variable>',
        '    <variable name="C" class="java.lang.String"><expression><![CDATA["c"]]></expression></variable>',
        '  </dataset>',
    ].join('\n'));

    const findings = checkVariableOrder(text);
    // A -> B crosses scopes (ignored); B -> C is a dataset-scope forward ref.
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].variable, 'B');
    assert.strictEqual(findings[0].referenced, 'C');
});

test('the initialValueExpression of a forward reference is reported too', () => {
    const text = report([
        '  <variable name="A" class="java.lang.Integer">',
        '    <initialValueExpression><![CDATA[$V{B}]]></initialValueExpression>',
        '  </variable>',
        '  <variable name="B" class="java.lang.Integer"/>',
    ].join('\n'));

    const findings = checkVariableOrder(text);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].referenced, 'B');
});

test('golden: TextReport has no variable-order findings', () => {
    const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'TextReport.jrxml'), 'utf8');
    assert.deepStrictEqual(checkVariableOrder(text), []);
});
