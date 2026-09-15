// test/expressionFormatter.test.js

const test   = require('node:test');
const assert = require('node:assert');

const { formatExpression } = require('../expressionFormatter');

test('returns empty / whitespace-only input untouched', () => {
    assert.strictEqual(formatExpression(''), '');
    assert.strictEqual(formatExpression('   '), '   ');
});

test('collapses redundant whitespace outside strings', () => {
    assert.strictEqual(formatExpression('$F{a}   ==    $F{b}'), '$F{a} == $F{b}');
});

test('leaves whitespace inside string literals alone', () => {
    assert.strictEqual(formatExpression('$F{a}.equals("a   b")'), '$F{a}.equals("a   b")');
});

test('formats a ternary chain across lines', () => {
    const out = formatExpression('$F{a} == null ? "-" : $F{a}', 4);
    assert.strictEqual(out, '$F{a} == null\n    ? "-"\n    : $F{a}');
});

test('breaks a chain of three or more method calls', () => {
    const out = formatExpression('$F{a}.trim().toLowerCase().substring(0, 3)', 4);
    const lines = out.split('\n');
    assert.ok(lines.length >= 2, `expected a broken chain, got ${JSON.stringify(out)}`);
    assert.match(lines[1], /^\s+\./);
});

test('does not break plain field/package access', () => {
    const expr = 'net.sf.jasperreports.engine.JasperCompileManager';
    assert.strictEqual(formatExpression(expr, 4), expr);
});

test('expands a long argument list with a matching closing paren', () => {
    const expr = 'helper(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour)';
    const out  = formatExpression(expr, 4);

    assert.strictEqual(out,
        'helper(\n' +
        '    argumentNumberOne,\n' +
        '    argumentNumberTwo,\n' +
        '    argumentNumberThree,\n' +
        '    argumentNumberFour\n' +
        ')');
});

test('closing paren alignment follows indentSize (regression)', () => {
    const expr = 'helper(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour)';
    const out  = formatExpression(expr, 2);
    const lines = out.split('\n');

    assert.ok(lines[1].startsWith('  argumentNumberOne'), 'args use 2-space indent');
    assert.strictEqual(lines[lines.length - 1], ')', 'closing paren sits at the call indent');
});

test('breaks long && / || expressions at top level only', () => {
    // >100 chars, but fewer than three method calls so the chain formatter
    // does not claim it first.
    const expr = '$F{alphaValue} != null && $F{betaValue} != null && $F{gammaValue} != null && $F{deltaValue} != null && $F{epsilonValue} != null';
    const out  = formatExpression(expr, 4);
    assert.ok(out.includes('\n'), 'expected line breaks');
    assert.ok(out.includes('&&\n    $F{betaValue}'), `unexpected output: ${JSON.stringify(out)}`);
});

test('does not touch operators inside strings', () => {
    const expr = 'IF($F{a}, "x && y || z && really long padded string value here to exceed limits", "n")';
    const out  = formatExpression(expr, 4);
    assert.ok(out.includes('"x && y || z'), 'string content preserved');
});
