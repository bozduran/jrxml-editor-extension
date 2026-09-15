// test/expressionUtils.test.js
// expressionUtils lazily requires 'vscode' inside findExpressionAtCursor, so we
// install a tiny stub before loading the module.

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

class FakeRange {
    constructor(start, end) { this.start = start; this.end = end; }
}

// Keep the stub installed for the whole file: the module resolves 'vscode' at
// call time, not at require time.
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return { Range: FakeRange };
    return originalLoad.call(this, request, ...rest);
};

const {
    findExpressionAtCursor,
    stripCdata,
    wrapExpression,
    hasCdata,
    EXPRESSION_TAGS,
} = require('../expressionUtils');

function fakeDocument(text) {
    return {
        getText: () => text,
        offsetAt: offset => offset,
        positionAt: offset => offset,
    };
}

test('stripCdata removes the wrapper and trims', () => {
    assert.strictEqual(stripCdata('<![CDATA[$F{a}]]>'), '$F{a}');
    assert.strictEqual(stripCdata('  <![CDATA[ $F{a} ]]>  '), '$F{a}');
    assert.strictEqual(stripCdata('$F{a}'), '$F{a}');
});

test('hasCdata detects the wrapper', () => {
    // hasCdata only inspects the opening marker — it is used to decide whether
    // to re-wrap, not to validate the content.
    assert.strictEqual(hasCdata('<![CDATA[x]]>'), true);
    assert.strictEqual(hasCdata('  <![CDATA[x]]>'), true);
    assert.strictEqual(hasCdata('$F{a}'), false);
    assert.strictEqual(hasCdata('x'), false);
});

test('wrapExpression only wraps when asked', () => {
    assert.strictEqual(wrapExpression('$F{a}', true), '<![CDATA[$F{a}]]>');
    assert.strictEqual(wrapExpression('$F{a}', false), '$F{a}');
});

test('EXPRESSION_TAGS contains the common expression elements', () => {
    for (const tag of ['textFieldExpression', 'printWhenExpression', 'variableExpression', 'jr:expression']) {
        assert.ok(EXPRESSION_TAGS.includes(tag), `missing ${tag}`);
    }
});

test('findExpressionAtCursor returns the enclosing expression', () => {
    const text = '<jasperReport><textFieldExpression><![CDATA[$F{a} + 1]]></textFieldExpression></jasperReport>';
    const offset = text.indexOf('$F{a}') + 2;

    const result = findExpressionAtCursor(fakeDocument(text), offset);
    assert.ok(result, 'expected a match');
    assert.strictEqual(result.tagName, 'textFieldExpression');
    assert.strictEqual(result.expression, '$F{a} + 1');
    assert.ok(result.range instanceof FakeRange);
});

test('findExpressionAtCursor returns null outside expression tags', () => {
    const text = '<jasperReport><field name="a"/></jasperReport>';
    assert.strictEqual(findExpressionAtCursor(fakeDocument(text), 3), null);
});

test('findExpressionAtCursor matches jr:expression', () => {
    const text = '<jr:expression><![CDATA[$P{x}]]></jr:expression>';
    const result = findExpressionAtCursor(fakeDocument(text), 4);
    assert.ok(result);
    assert.strictEqual(result.tagName, 'jr:expression');
    assert.strictEqual(result.expression, '$P{x}');
});
