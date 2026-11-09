// test/ifElseBuilder.test.js
// Pure model / generator / reverse parser tests for the If/Else builder.
// The expected strings are pinned by jaspersoft-expression-builder-spec.md
// (generation G1-G11, reverse R1-R8, round trip 9.3).

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('path');
const fs     = require('fs');

const builder = require('../out/ifElseBuilder');
const { parseDeclarations } = require('../out/jrxmlParser');
const { BUILTIN_VARIABLES, BUILTIN_PARAMETERS } = require('../out/jasperBuiltins');

// ── Helpers ──────────────────────────────────────────────────────────────────

const cond = overrides => builder.createCondition(overrides);

function oneBranch({ conditions, result, els, join = '&&' }) {
    return {
        branches: [{ join, conds: conditions, res: result }],
        els,
    };
}

function twoBranches(statusCondition, els) {
    return {
        branches: [
            { join: '&&', conds: [{ ...statusCondition, val: 'PAID' }], res: { kind: 'text', val: 'Paid' } },
            { join: '&&', conds: [{ ...statusCondition, val: 'PENDING' }], res: { kind: 'text', val: 'Pending' } },
        ],
        els,
    };
}

const TEXT = (val = '') => ({ kind: 'text', val });
const NUMBER = (val = '') => ({ kind: 'number', val });
const EXPR = (val = '') => ({ kind: 'expr', val });

let documentCounter = 0;
function fakeDocument(text) {
    documentCounter += 1;
    return {
        uri: { toString: () => `test://ifelse/${documentCounter}.jrxml` },
        version: 1,
        getText: () => text,
    };
}

// ── Generation (spec 9.1) ────────────────────────────────────────────────────

test('G1: String equals uses the JasperReports EQUALS function, null-safe', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' })],
        result: TEXT('Paid'),
        els: TEXT('Unknown'),
    });
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: true, multiline: false }),
        '(EQUALS($F{status}, "PAID") ? "Paid" : "Unknown")'
    );
});

test('G2: String equals uses EQUALS in both null-safe modes', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' })],
        result: TEXT('Paid'),
        els: TEXT('Unknown'),
    });
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: false, multiline: false }),
        '(EQUALS($F{status}, "PAID") ? "Paid" : "Unknown")'
    );
});

test('G3: String equals, functions style, single line', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' })],
        result: TEXT('Paid'),
        els: TEXT('Unknown'),
    });
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: true, multiline: false, style: 'functions' }),
        'IF(EQUALS($F{status}, "PAID"), "Paid", "Unknown")'
    );
});

test('String not-equals and Boolean conditions also use EQUALS', () => {
    const notEqual = oneBranch({
        conditions: [cond({ name: 'status', type: 'String', op: 'notEquals', val: 'PAID' })],
        result: TEXT('Paid'),
        els: TEXT('Unknown'),
    });
    assert.strictEqual(
        builder.buildExpression(notEqual, { nullSafe: true, multiline: false }),
        '(NOT(EQUALS($F{status}, "PAID")) ? "Paid" : "Unknown")'
    );

    for (const [op, expected] of [['isTrue', 'true'], ['isFalse', 'false']]) {
        const bool = oneBranch({
            conditions: [cond({ name: 'active', type: 'Boolean', op })],
            result: TEXT('Yes'),
            els: TEXT('No'),
        });
        assert.strictEqual(
            builder.buildExpression(bool, { nullSafe: true, multiline: false }),
            `(EQUALS($F{active}, ${expected}) ? "Yes" : "No")`
        );
    }
});

test('G4: Number comparison is guarded, single line', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'n', type: 'Number', op: '>', val: '5' })],
        result: TEXT('big'),
        els: TEXT('small'),
    });
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: true, multiline: false }),
        '($F{n} != null && $F{n} > 5 ? "big" : "small")'
    );
});

test('G5: Number comparison, functions style uses an inline ternary guard', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'n', type: 'Number', op: '>', val: '5' })],
        result: TEXT('big'),
        els: TEXT('small'),
    });
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: true, multiline: false, style: 'functions' }),
        'IF(($F{n} != null ? $F{n} > 5 : false), "big", "small")'
    );
});

test('G6: two conditions joined with AND, null-safe off', () => {
    const state = oneBranch({
        conditions: [
            cond({ name: 'a', type: 'Number', op: '>', val: '1' }),
            cond({ name: 'b', type: 'String', op: 'isNull' }),
        ],
        result: NUMBER('1'),
        els: NUMBER('2'),
    });
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: false, multiline: false }),
        '(($F{a} > 1 && $F{b} == null) ? 1 : 2)'
    );
});

test('G7: two conditions joined with OR, functions style, null-safe off', () => {
    const state = oneBranch({
        join: '||',
        conditions: [
            cond({ name: 'a', type: 'Number', op: '>', val: '1' }),
            cond({ name: 'b', type: 'String', op: 'isNull' }),
        ],
        result: NUMBER('1'),
        els: NUMBER('2'),
    });
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: false, multiline: false, style: 'functions' }),
        'IF(OR($F{a} > 1, $F{b} == null), 1, 2)'
    );
});

test('G8: two branches, multi-line ternary indentation', () => {
    const state = twoBranches(
        cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' }),
        TEXT('Unknown')
    );
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: true, multiline: true }),
        [
            '(EQUALS($F{status}, "PAID")',
            '  ? "Paid"',
            '  : (EQUALS($F{status}, "PENDING")',
            '      ? "Pending"',
            '      : "Unknown"))',
        ].join('\n')
    );
});

test('G9: quotes, backslashes and newlines are escaped in Java literals', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: 'say "hi"' })],
        result: TEXT('a\\b'),
        els: TEXT(''),
    });
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: true, multiline: false }),
        '(EQUALS($F{status}, "say \\"hi\\"") ? "a\\\\b" : "")'
    );
    assert.strictEqual(
        builder.escapeJavaString(String.raw`a\b"c` + '\n'),
        String.raw`"a\\b\"c\n"`
    );
});

test('G10: no branches emits only the else result', () => {
    assert.strictEqual(builder.buildExpression({ branches: [], els: TEXT('Unknown') }, {}), '"Unknown"');
    assert.strictEqual(builder.buildExpression({ branches: [], els: NUMBER('7') }, {}), '7');
});

test('G11: an empty Custom condition emits true', () => {
    const state = oneBranch({
        conditions: [cond({ type: 'Custom', op: '', val: '' })],
        result: TEXT('a'),
        els: TEXT('b'),
    });
    assert.strictEqual(
        builder.buildExpression(state, { multiline: false }),
        '(true ? "a" : "b")'
    );
});

test('defaults are null-safe, multi-line and ternary', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' })],
        result: TEXT('Paid'),
        els: TEXT('Unknown'),
    });
    const output = builder.buildExpression(state);
    assert.ok(output.includes('\n'), 'default output is multi-line');
    assert.ok(output.includes('EQUALS($F{status}, "PAID")'), 'default output uses the null-safe EQUALS function');
    assert.ok(output.startsWith('('), 'default style is ternary');
});

test('functions style never uses && or || for a null guard', () => {
    const guarded = [
        oneBranch({ conditions: [cond({ name: 'n', type: 'Number', op: '>', val: '5' })], result: TEXT('a'), els: TEXT('b') }),
        oneBranch({ conditions: [cond({ name: 'n', type: 'Number', op: '!=', val: '5' })], result: TEXT('a'), els: TEXT('b') }),
        oneBranch({ conditions: [cond({ name: 's', type: 'String', op: 'contains', val: 'x' })], result: TEXT('a'), els: TEXT('b') }),
        oneBranch({ conditions: [cond({ name: 's', type: 'String', op: 'isEmpty' })], result: TEXT('a'), els: TEXT('b') }),
        oneBranch({ conditions: [cond({ name: 'b', type: 'Boolean', op: 'isTrue' })], result: TEXT('a'), els: TEXT('b') }),
    ];
    for (const state of guarded) {
        const output = builder.buildExpression(state, { nullSafe: true, multiline: false, style: 'functions' });
        assert.ok(!output.includes(' && '), `no && in ${output}`);
        assert.ok(!output.includes(' || '), `no || in ${output}`);
    }
});

test('array references are accepted as comparison values', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: '$P{expected}' })],
        result: TEXT('a'),
        els: TEXT('b'),
    });
    assert.strictEqual(
        builder.buildExpression(state, { nullSafe: true, multiline: false }),
        '(EQUALS($F{status}, $P{expected}) ? "a" : "b")'
    );
});

// ── Reverse conversion (spec 9.2) ───────────────────────────────────────────

test('R1: IF() chain with AND/OR groups', () => {
    const result = builder.fromExpression(
        'IF($F{status}.equals("PAID") && $F{a} > 5, "Paid", IF(OR($F{x} == null, $F{y}.isEmpty()), "E", "U"))'
    );

    assert.strictEqual(result.state.branches.length, 2);
    assert.strictEqual(result.state.branches[0].join, '&&');
    assert.deepStrictEqual(result.state.branches[0].conds, [
        { ref: 'F', name: 'status', type: 'String', op: 'equals', val: 'PAID' },
        { ref: 'F', name: 'a', type: 'Number', op: '>', val: '5' },
    ]);
    assert.deepStrictEqual(result.state.branches[0].res, { kind: 'text', val: 'Paid' });

    assert.strictEqual(result.state.branches[1].join, '||');
    assert.deepStrictEqual(result.state.branches[1].conds, [
        { ref: 'F', name: 'x', type: 'String', op: 'isNull', val: '' },
        { ref: 'F', name: 'y', type: 'String', op: 'isEmpty', val: '' },
    ]);
    assert.deepStrictEqual(result.state.branches[1].res, { kind: 'text', val: 'E' });
    assert.deepStrictEqual(result.state.els, { kind: 'text', val: 'U' });
    assert.strictEqual(result.style, 'functions');
    assert.strictEqual(result.nullSafe, false);
});

test('R2: guarded OR with a safe equals receiver', () => {
    const result = builder.fromExpression(
        '(("A".equals($F{s}) || ($F{n} != null && $F{n} > 3)) ? 1 : 2)'
    );

    assert.strictEqual(result.state.branches.length, 1);
    assert.strictEqual(result.state.branches[0].join, '||');
    assert.deepStrictEqual(result.state.branches[0].conds, [
        { ref: 'F', name: 's', type: 'String', op: 'equals', val: 'A' },
        { ref: 'F', name: 'n', type: 'Number', op: '>', val: '3' },
    ]);
    assert.deepStrictEqual(result.state.branches[0].res, { kind: 'number', val: '1' });
    assert.deepStrictEqual(result.state.els, { kind: 'number', val: '2' });
    assert.strictEqual(result.nullSafe, true);
    assert.strictEqual(result.style, 'ternary');
});

test('R3: inline ternary guard and an expression result', () => {
    const result = builder.fromExpression(
        '(($F{n} != null ? $F{n} > 3 : false) ? "a" : $P{p})'
    );

    assert.strictEqual(result.state.branches.length, 1);
    assert.deepStrictEqual(result.state.branches[0].conds, [
        { ref: 'F', name: 'n', type: 'Number', op: '>', val: '3' },
    ]);
    assert.deepStrictEqual(result.state.branches[0].res, { kind: 'text', val: 'a' });
    assert.deepStrictEqual(result.state.els, { kind: 'expr', val: '$P{p}' });
    assert.strictEqual(result.nullSafe, true);
});

test('R4: an unmappable comparison becomes a Custom condition with its source', () => {
    const result = builder.fromExpression('$F{x}.intValue() > 3 ? "a" : "b"');

    assert.strictEqual(result.state.branches.length, 1);
    assert.deepStrictEqual(result.state.branches[0].conds, [
        { ref: 'F', name: '', type: 'Custom', op: '', val: '$F{x}.intValue() > 3' },
    ]);
    assert.strictEqual(result.state.els.kind, 'text');
});

test('R5: a number on the left flips the operator', () => {
    const result = builder.fromExpression('3 < $F{n} ? 1 : 2');

    assert.deepStrictEqual(result.state.branches[0].conds, [
        { ref: 'F', name: 'n', type: 'Number', op: '>', val: '3' },
    ]);
});

test('R6: a non-ternary expression fills the else and offers one empty branch', () => {
    const result = builder.fromExpression('"abc"');

    assert.strictEqual(result.state.branches.length, 1);
    assert.strictEqual(result.state.branches[0].conds.length, 1);
    assert.deepStrictEqual(result.state.els, { kind: 'text', val: 'abc' });
    assert.strictEqual(result.style, 'ternary');
});

test('R7: unbalanced parentheses throw a readable error', () => {
    assert.throws(
        () => builder.fromExpression('IF($F{a} > 1, "x"'),
        /Expected \)|Unexpected end of expression/
    );
    assert.throws(() => builder.fromExpression('   '), /Paste an expression first/);
});

test('R8: equals is not a guarded OR pattern', () => {
    const result = builder.fromExpression(
        '($F{a} == null || $F{a}.equals("x")) ? "t" : "f"'
    );

    assert.strictEqual(result.state.branches[0].join, '||');
    assert.deepStrictEqual(result.state.branches[0].conds, [
        { ref: 'F', name: 'a', type: 'String', op: 'isNull', val: '' },
        { ref: 'F', name: 'a', type: 'String', op: 'equals', val: 'x' },
    ]);
    assert.strictEqual(result.nullSafe, false);
});

test('reverse conversion also understands NOT, Boolean.TRUE.equals and string receivers', () => {
    const bool = builder.fromExpression('IF(Boolean.TRUE.equals($F{active}), "Y", "N")');
    assert.deepStrictEqual(bool.state.branches[0].conds, [
        { ref: 'F', name: 'active', type: 'Boolean', op: 'isTrue', val: '' },
    ]);
    assert.strictEqual(bool.nullSafe, true);

    const not = builder.fromExpression('IF(!$F{s}.equals("x"), "Y", "N")');
    assert.deepStrictEqual(not.state.branches[0].conds, [
        { ref: 'F', name: 's', type: 'String', op: 'notEquals', val: 'x' },
    ]);
});

test('reverse conversion understands the JasperReports EQUALS function', () => {
    const equal = builder.fromExpression('IF(EQUALS($F{status}, "PAID"), "Paid", "Unknown")');
    assert.deepStrictEqual(equal.state.branches[0].conds, [
        { ref: 'F', name: 'status', type: 'String', op: 'equals', val: 'PAID' },
    ]);

    const notEqual = builder.fromExpression('IF(NOT(EQUALS($F{status}, "PAID")), "Paid", "Unknown")');
    assert.deepStrictEqual(notEqual.state.branches[0].conds, [
        { ref: 'F', name: 'status', type: 'String', op: 'notEquals', val: 'PAID' },
    ]);

    const bool = builder.fromExpression('IF(EQUALS($F{active}, true), "Y", "N")');
    assert.deepStrictEqual(bool.state.branches[0].conds, [
        { ref: 'F', name: 'active', type: 'Boolean', op: 'isTrue', val: '' },
    ]);
    assert.strictEqual(bool.nullSafe, true);
});

test('Boolean EQUALS round-trips through reverse conversion', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'active', type: 'Boolean', op: 'isFalse' })],
        result: TEXT('Yes'),
        els: TEXT('No'),
    });
    const generated = builder.buildExpression(state, { nullSafe: true, multiline: false });

    assert.strictEqual(generated, '(EQUALS($F{active}, false) ? "Yes" : "No")');
    const recovered = builder.fromExpression(generated);
    assert.deepStrictEqual(recovered.state.branches[0].conds, [
        { ref: 'F', name: 'active', type: 'Boolean', op: 'isFalse', val: '' },
    ]);
    assert.strictEqual(recovered.nullSafe, true);
    assert.strictEqual(
        builder.buildExpression(recovered.state, {
            nullSafe: recovered.nullSafe, multiline: false, style: recovered.style,
        }),
        generated
    );
});

// ── Expression results ───────────────────────────────────────────────────────
// Results are opaque Java/JasperReports source, not condition fragments.

test('loads arbitrary expression results verbatim', () => {
    const result = builder.fromExpression(
        '($F{status}.equals("PAID") ? $F{first} + " " + $F{last} : new java.util.Date())'
    );

    assert.deepStrictEqual(result.state.branches[0].res, EXPR('$F{first} + " " + $F{last}'));
    assert.deepStrictEqual(result.state.els, EXPR('new java.util.Date()'));
    assert.strictEqual(
        builder.buildExpression(result.state, {
            nullSafe: result.nullSafe, multiline: false, style: result.style,
        }),
        '(EQUALS($F{status}, "PAID") ? $F{first} + " " + $F{last} : new java.util.Date())'
    );
});

test('IF() results may contain commas, calls and nested conditionals', () => {
    const result = builder.fromExpression(
        'IF($F{status}.equals("PAID"), String.format("%s, %s", $F{first}, $F{last}), ' +
        'IF($F{x} != null, $F{x}, "none"))'
    );

    assert.strictEqual(result.state.branches.length, 2);
    assert.deepStrictEqual(result.state.branches[0].res,
        EXPR('String.format("%s, %s", $F{first}, $F{last})'));
    assert.deepStrictEqual(result.state.branches[1].res, EXPR('$F{x}'));
    assert.deepStrictEqual(result.state.els, TEXT('none'));
});

test('an unreadable condition becomes Custom and survives a load', () => {
    const result = builder.fromExpression('$F{amount} * 2 > 100 ? $F{label} : "small"');

    assert.deepStrictEqual(result.state.branches[0].conds, [
        { ref: 'F', name: '', type: 'Custom', op: '', val: '$F{amount} * 2 > 100' },
    ]);
    assert.deepStrictEqual(result.state.branches[0].res, EXPR('$F{label}'));
    assert.strictEqual(
        builder.buildExpression(result.state, { nullSafe: false, multiline: false, style: 'ternary' }),
        '($F{amount} * 2 > 100 ? $F{label} : "small")'
    );
});

test('char literals and method references do not confuse the ternary split', () => {
    const charResult = builder.fromExpression('($F{code} == \'?\' ? "yes" : "no")');
    assert.deepStrictEqual(charResult.state.branches[0].conds, [
        { ref: 'F', name: '', type: 'Custom', op: '', val: "$F{code} == '?'" },
    ]);
    assert.deepStrictEqual(charResult.state.els, TEXT('no'));

    const methodRef = builder.fromExpression('($F{ok} ? String::valueOf : null)');
    assert.strictEqual(methodRef.state.branches.length, 1);
    assert.deepStrictEqual(methodRef.state.branches[0].res, EXPR('String::valueOf'));
    assert.deepStrictEqual(methodRef.state.els, { kind: 'null', val: '' });
});

test('generic commas and wildcards stay inside expression results', () => {
    const generic = builder.fromExpression(
        'IF($F{a} > 0, new java.util.HashMap<String, Integer>(), "none")'
    );
    assert.strictEqual(generic.state.branches.length, 1);
    assert.deepStrictEqual(generic.state.branches[0].res,
        EXPR('new java.util.HashMap<String, Integer>()'));
    assert.deepStrictEqual(generic.state.els, TEXT('none'));

    const wildcard = builder.fromExpression('($F{ok} ? Class<? extends Number> : null)');
    assert.deepStrictEqual(wildcard.state.branches[0].res, EXPR('Class<? extends Number>'));

    // `<` in the condition and `>` in the result must not read as a generic.
    const comparison = builder.fromExpression('($F{x} < 5 ? $F{y} > 3 : 4)');
    assert.deepStrictEqual(comparison.state.branches[0].res, EXPR('$F{y} > 3'));
    assert.deepStrictEqual(comparison.state.els, NUMBER('4'));

    const comparisonIf = builder.fromExpression('IF($F{a} < $F{b}, $F{x} > 3, 4)');
    assert.deepStrictEqual(comparisonIf.state.branches[0].conds, [
        { ref: 'F', name: 'a', type: 'Number', op: '<', val: '$F{b}' },
    ]);
    assert.deepStrictEqual(comparisonIf.state.branches[0].res, EXPR('$F{x} > 3'));
});

test('text results round-trip quotes and control characters', () => {
    const result = builder.fromExpression('$F{a} ? "a \\"quoted\\"\\tvalue" : "b"');

    assert.deepStrictEqual(result.state.branches[0].res, TEXT('a "quoted"\tvalue'));
    assert.strictEqual(
        builder.buildExpression(result.state, { nullSafe: false, multiline: false, style: 'ternary' }),
        '($F{a} ? "a \\"quoted\\"\\tvalue" : "b")'
    );
});

test('round trip preserves expression results in both styles', () => {
    const state = oneBranch({
        conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' })],
        result: EXPR('$F{first} + " " + $F{last}'),
        els: EXPR('new java.util.Date()'),
    });

    for (const style of ['ternary', 'functions']) {
        for (const multiline of [false, true]) {
            for (const nullSafe of [true, false]) {
                const generated = builder.buildExpression(state, { nullSafe, multiline, style });
                const recovered = builder.fromExpression(generated);
                assert.strictEqual(
                    builder.buildExpression(recovered.state, {
                        nullSafe: recovered.nullSafe, multiline, style: recovered.style,
                    }),
                    generated,
                    `${style} multiline=${multiline} nullSafe=${nullSafe}`
                );
            }
        }
    }
});

// ── Round trip (spec 9.3) ────────────────────────────────────────────────────

test('round trip preserves the generated string for G1-G7 with null-safe on and off', () => {
    const cases = [
        ['G1', oneBranch({
            conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' })],
            result: TEXT('Paid'), els: TEXT('Unknown'),
        }), 'ternary'],
        ['G2', oneBranch({
            conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' })],
            result: TEXT('Paid'), els: TEXT('Unknown'),
        }), 'ternary'],
        ['G3', oneBranch({
            conditions: [cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' })],
            result: TEXT('Paid'), els: TEXT('Unknown'),
        }), 'functions'],
        ['G4', oneBranch({
            conditions: [cond({ name: 'n', type: 'Number', op: '>', val: '5' })],
            result: TEXT('big'), els: TEXT('small'),
        }), 'ternary'],
        ['G5', oneBranch({
            conditions: [cond({ name: 'n', type: 'Number', op: '>', val: '5' })],
            result: TEXT('big'), els: TEXT('small'),
        }), 'functions'],
        ['G6', oneBranch({
            conditions: [
                cond({ name: 'a', type: 'Number', op: '>', val: '1' }),
                cond({ name: 'b', type: 'String', op: 'isNull' }),
            ],
            result: NUMBER('1'), els: NUMBER('2'),
        }), 'ternary'],
        ['G7', oneBranch({
            join: '||',
            conditions: [
                cond({ name: 'a', type: 'Number', op: '>', val: '1' }),
                cond({ name: 'b', type: 'String', op: 'isNull' }),
            ],
            result: NUMBER('1'), els: NUMBER('2'),
        }), 'functions'],
    ];

    for (const [name, state, style] of cases) {
        for (const nullSafe of [true, false]) {
            const options = { nullSafe, multiline: false, style };
            const generated = builder.buildExpression(state, options);
            const recovered = builder.fromExpression(generated);
            const regenerated = builder.buildExpression(recovered.state, {
                nullSafe: recovered.nullSafe,
                multiline: false,
                style: recovered.style,
            });
            assert.strictEqual(regenerated, generated, `${name} nullSafe=${nullSafe}`);
        }
    }
});

test('round trip preserves a multi-line two-branch expression', () => {
    const state = twoBranches(
        cond({ name: 'status', type: 'String', op: 'equals', val: 'PAID' }),
        TEXT('Unknown')
    );
    const generated = builder.buildExpression(state, { multiline: true });
    const recovered = builder.fromExpression(generated);
    assert.strictEqual(
        builder.buildExpression(recovered.state, { multiline: true, nullSafe: recovered.nullSafe, style: recovered.style }),
        generated
    );
});

// ── Schema and type mapping (spec 6) ────────────────────────────────────────

test('makeSchema maps simple class names and appends the built-ins', () => {
    const schema = builder.makeSchema({
        fields: [
            { name: 'Amount', type: 'java.math.BigDecimal' },
            { name: 'Untyped', type: 'Object' },
        ],
        parameters: [{ name: 'Limit', type: 'java.lang.Integer' }],
        variables: [{ name: 'Total', type: 'java.lang.Double' }],
        builtinVariables: BUILTIN_VARIABLES,
        builtinParameters: BUILTIN_PARAMETERS,
    });

    assert.deepStrictEqual(schema.F, [
        { name: 'Amount', cls: 'BigDecimal' },
        { name: 'Untyped', cls: 'Object' },
    ]);
    assert.ok(schema.P.some(item => item.name === 'Limit' && item.cls === 'Integer'));
    assert.ok(schema.P.some(item => item.name === 'REPORT_LOCALE' && item.cls === 'Locale'));
    assert.ok(schema.V.some(item => item.name === 'Total' && item.cls === 'Double'));
    assert.ok(schema.V.some(item => item.name === 'PAGE_NUMBER' && item.cls === 'Integer'));
});

test('makeSchema dedupes built-ins and lets declared names win', () => {
    const schema = builder.makeSchema({
        parameters: [{ name: 'REPORT_LOCALE', type: 'java.lang.String' }],
        builtinParameters: [{ name: 'REPORT_LOCALE', type: 'java.util.Locale' }, { name: 'IS_IGNORE_PAGINATION', type: 'Boolean' }],
        builtinVariables: [{ name: 'PAGE_NUMBER', type: 'Integer' }],
    });

    const locale = schema.P.filter(item => item.name === 'REPORT_LOCALE');
    assert.strictEqual(locale.length, 1);
    assert.strictEqual(locale[0].cls, 'String');
    assert.ok(schema.P.some(item => item.name === 'IS_IGNORE_PAGINATION'));
    assert.ok(schema.V.some(item => item.name === 'PAGE_NUMBER'));
});

test('schema is read from direct report declarations only, with built-ins added', () => {
    const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'Blank_A4_1.jrxml'), 'utf8');
    const parsed = parseDeclarations(fakeDocument(text));
    const schema = builder.makeSchema({
        ...parsed,
        builtinVariables: BUILTIN_VARIABLES,
        builtinParameters: BUILTIN_PARAMETERS,
    });

    assert.ok(schema.F.some(item => item.name === 'Field_4' && item.cls === 'String'));
    assert.ok(schema.V.some(item => item.name === 'Variable_1'));
    assert.ok(schema.V.some(item => item.name === 'PAGE_NUMBER'));
    assert.ok(schema.P.some(item => item.name === 'REPORT_CONNECTION'));
});

test('typeOfClass maps JasperReports classes to builder types', () => {
    assert.strictEqual(builder.typeOfClass('java.math.BigDecimal'), 'Number');
    assert.strictEqual(builder.typeOfClass('Integer'), 'Number');
    assert.strictEqual(builder.typeOfClass('java.lang.Boolean'), 'Boolean');
    assert.strictEqual(builder.typeOfClass('java.util.Date'), 'String');
    assert.strictEqual(builder.typeOfClass(''), 'String');
});

test('emptyState starts with one empty branch and a text else', () => {
    const state = builder.emptyState();
    assert.strictEqual(state.branches.length, 1);
    assert.deepStrictEqual(state.branches[0].conds, [
        { ref: 'F', name: '', type: 'String', op: 'equals', val: '' },
    ]);
    assert.deepStrictEqual(state.els, { kind: 'text', val: '' });
    assert.strictEqual(builder.buildExpression(state, { multiline: false }), '(EQUALS($F{name}, "") ? "" : "")');
});
