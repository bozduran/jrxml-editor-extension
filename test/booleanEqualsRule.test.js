// test/booleanEqualsRule.test.js
// The Boolean-comparison rule that replaced the Best Practices view.

const test   = require('node:test');
const assert = require('node:assert');

const { CODE, MESSAGE, checkBooleanEquals } = require('../booleanEqualsRule');

function declarations(overrides = {}) {
    return {
        allFields:     [{ name: 'active', type: 'java.lang.Boolean' }],
        allParameters: [],
        allVariables:  [],
        ...overrides,
    };
}

function check(expression, decls = declarations()) {
    return checkBooleanEquals(expression, decls);
}

test('exposes a stable diagnostic code and message', () => {
    assert.strictEqual(CODE, 'jrxml.booleanEquals');
    assert.match(MESSAGE, /EQUALS/);
});

test('rewrites Boolean.TRUE/FALSE.equals in both directions', () => {
    assert.deepStrictEqual(check('Boolean.FALSE.equals($F{active})'), [{
        start: 0,
        end: 32,
        label: 'Replace with EQUALS($F{active}, false)',
        replacement: 'EQUALS($F{active}, false)',
    }]);

    assert.deepStrictEqual(check('$F{active}.equals(Boolean.TRUE)'), [{
        start: 0,
        end: 31,
        label: 'Replace with EQUALS($F{active}, true)',
        replacement: 'EQUALS($F{active}, true)',
    }]);
});

test('rewrites == and != comparisons against true/false', () => {
    assert.strictEqual(check('$F{active} == true')[0].replacement, 'EQUALS($F{active}, true)');
    assert.strictEqual(check('$F{active} != false')[0].replacement, 'NOT(EQUALS($F{active}, false))');
});

test('rewrites a bare Boolean reference used as a condition', () => {
    assert.strictEqual(check('$F{active}')[0].replacement, 'EQUALS($F{active}, true)');
});

test('does not rewrite non-Boolean declarations', () => {
    const decls = declarations({
        allFields: [{ name: 'name', type: 'java.lang.String' }],
    });
    assert.deepStrictEqual(check('$F{name} == true', decls), []);
});

test('does not rewrite an existing EQUALS call', () => {
    assert.deepStrictEqual(check('EQUALS($F{active}, true)'), []);
});

test('does not rewrite member access on a Boolean reference', () => {
    assert.deepStrictEqual(check('$F{active}.booleanValue()'), []);
});

test('works with parameter and variable declarations', () => {
    const decls = declarations({
        allFields: [],
        allParameters: [{ name: 'flag', type: 'Boolean' }],
        allVariables: [{ name: 'ready', fullType: 'java.lang.Boolean' }],
    });

    assert.strictEqual(check('$P{flag} == false', decls)[0].replacement, 'EQUALS($P{flag}, false)');
    assert.strictEqual(check('$V{ready}', decls)[0].replacement, 'EQUALS($V{ready}, true)');
});

test('reports ranges that point at the matched comparison', () => {
    const expression = '($F{active} != true) && $F{name}.isEmpty()';
    const decls = declarations({
        allFields: [
            { name: 'active', type: 'java.lang.Boolean' },
            { name: 'name', type: 'java.lang.String' },
        ],
    });

    const [hit] = check(expression, decls);
    assert.strictEqual(expression.slice(hit.start, hit.end), '$F{active} != true');
});
