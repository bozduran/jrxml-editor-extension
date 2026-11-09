// test/memberResolver.test.js
// Unit tests for the receiver resolver. The lookup is injected, so these tests
// exercise the expression walk without touching the JDK table.

const test   = require('node:test');
const assert = require('node:assert');

const {
    resolveReceiver,
    arityMatches,
    countArguments,
    matchingOpenParen,
    literalType,
} = require('../out/memberResolver');

// A tiny stand-in for jdkMemberIndex.getMembers.
const TYPES = {
    'java.lang.String': {
        methods: [
            { name: 'trim', params: [], returns: 'java.lang.String', static: false },
            { name: 'substring', params: ['int'], returns: 'java.lang.String', static: false },
            { name: 'substring', params: ['int', 'int'], returns: 'java.lang.String', static: false },
            { name: 'length', params: [], returns: 'int', static: false },
            { name: 'toUpperCase', params: [], returns: 'java.lang.String', static: false },
            { name: 'format', params: ['java.lang.String', 'java.lang.Object[]'], returns: 'java.lang.String', static: true, varargs: true },
        ],
        fields: [],
    },
    'java.math.BigDecimal': {
        methods: [
            { name: 'add', params: ['java.math.BigDecimal'], returns: 'java.math.BigDecimal', static: false },
            { name: 'intValue', params: [], returns: 'int', static: false },
        ],
        fields: [],
    },
    'java.util.List': {
        methods: [
            { name: 'get', params: ['int'], returns: 'E', static: false },
            { name: 'size', params: [], returns: 'int', static: false },
            { name: 'toArray', params: [], returns: 'java.lang.Object[]', static: false },
        ],
        fields: [],
    },
    'com.acme.Customer': {
        methods: [
            { name: 'getName', params: [], returns: 'java.lang.String', static: false },
            { name: 'getAddress', params: [], returns: 'com.acme.Address', static: false },
        ],
        fields: [],
    },
    'com.acme.Address': {
        methods: [{ name: 'getCity', params: [], returns: 'java.lang.String', static: false }],
        fields: [],
    },
};

function lookup(typeKey) {
    const type = TYPES[typeKey];
    if (!type) return { typeKey, resolved: false, reason: 'unknown-type', methods: [], fields: [] };
    return { typeKey, resolved: true, kind: 'class', methods: type.methods, fields: type.fields, ambiguous: false };
}

const DECLARATIONS = {
    fields: [
        { name: 'CustomerName', type: 'String', fullType: 'java.lang.String' },
        { name: 'Total', type: 'BigDecimal', fullType: 'java.math.BigDecimal' },
        { name: 'Items', type: 'List', fullType: 'java.util.List' },
        { name: 'Bean', type: 'Customer', fullType: 'com.acme.Customer' },
        { name: 'Unset', type: 'Object', fullType: 'java.lang.Object', typeSource: 'inferred' },
        { name: 'Custom', type: 'Customer', fullType: 'com.acme.Customer', typeSource: 'declared' },
    ],
    parameters: [
        { name: 'Who', type: 'String', fullType: 'java.lang.String' },
    ],
    variables: [
        { name: 'TotalVar', type: 'BigDecimal', fullType: 'java.math.BigDecimal' },
    ],
};

const context = { declarations: DECLARATIONS, lookup };

function resolve(text) {
    return resolveReceiver(text, context);
}

// ── References ────────────────────────────────────────────────────────────────

test('a field reference resolves to its declared class', () => {
    const result = resolve('$F{CustomerName}');
    assert.strictEqual(result.resolved, true);
    assert.strictEqual(result.typeKey, 'java.lang.String');
    assert.strictEqual(result.sigil, 'F');
    assert.strictEqual(result.name, 'CustomerName');
    assert.strictEqual(result.reference, '$F{CustomerName}');
});

test('parameters and variables resolve through the same table', () => {
    assert.strictEqual(resolve('$P{Who}').typeKey, 'java.lang.String');
    assert.strictEqual(resolve('$V{TotalVar}').typeKey, 'java.math.BigDecimal');
});

test('the reference is recognised with surrounding expression text', () => {
    assert.strictEqual(resolve('$F{Who} == null ? "" : $F{CustomerName}').typeKey, 'java.lang.String');
    assert.strictEqual(resolve('1 + $V{TotalVar}').typeKey, 'java.math.BigDecimal');
    assert.strictEqual(resolve('  $F{CustomerName}  ').typeKey, 'java.lang.String');
});

test('an undeclared reference is reported, not guessed', () => {
    const result = resolve('$F{Nope}');
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.reason, 'unknown-ref');
    assert.strictEqual(result.name, 'Nope');
});

test('a field without a declared class is reported as such', () => {
    const result = resolve('$F{Unset}');
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.reason, 'no-class');
    assert.strictEqual(result.name, 'Unset');
});

test('a class the index does not know is reported as unknown-type', () => {
    const result = resolveReceiver('$P{Missing}', {
        declarations: { fields: [], parameters: [{ name: 'Missing', type: 'Thing', fullType: 'com.acme.Thing' }], variables: [] },
        lookup,
    });
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.reason, 'unknown-type');
    assert.strictEqual(result.declaredType, 'com.acme.Thing');
});

test('an ambiguous short name is reported with its candidates', () => {
    const result = resolveReceiver('$F{D}', {
        declarations: { fields: [{ name: 'D', type: 'Date', fullType: 'Date' }], parameters: [], variables: [] },
        lookup: () => ({ typeKey: 'java.util.Date', resolved: true, methods: [], fields: [], ambiguous: true, ambiguity: { name: 'Date', candidates: ['java.util.Date', 'java.sql.Date'] } }),
    });
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.reason, 'ambiguous');
    assert.deepStrictEqual(result.ambiguity.candidates, ['java.util.Date', 'java.sql.Date']);
});

// ── Chains ────────────────────────────────────────────────────────────────────

test('a method call resolves through its return type', () => {
    const result = resolve('$F{CustomerName}.trim()');
    assert.strictEqual(result.resolved, true);
    assert.strictEqual(result.typeKey, 'java.lang.String');
    assert.deepStrictEqual(result.chain, ['trim']);
    // The root reference is preserved so the hint can name the field.
    assert.strictEqual(result.name, 'CustomerName');
    assert.strictEqual(result.sigil, 'F');
});

test('chains of several calls keep resolving', () => {
    const result = resolve('$F{Bean}.getAddress().getCity()');
    assert.strictEqual(result.resolved, true);
    assert.strictEqual(result.typeKey, 'java.lang.String');
    assert.deepStrictEqual(result.chain, ['getAddress', 'getCity']);
});

test('arguments are counted, including nested calls, generics and strings', () => {
    assert.strictEqual(resolve('$F{CustomerName}.substring(1)').resolved, true);
    assert.strictEqual(resolve('$F{CustomerName}.substring(1, 3)').resolved, true);
    assert.strictEqual(resolve('$F{CustomerName}.format("a,b", x)').resolved, true, 'varargs with two args');
    assert.strictEqual(resolve('$F{CustomerName}.format("a,b")').resolved, true, 'varargs with one arg');
});

test('an unknown method stops the chain with a specific reason', () => {
    const result = resolve('$F{CustomerName}.nope()');
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.reason, 'unknown-method');
    assert.strictEqual(result.methodName, 'nope');
});

test('a generic return type is not treated as an error', () => {
    const result = resolve('$F{Items}.get(0)');
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.reason, 'type-variable');
});

test('a primitive return type cannot be a receiver', () => {
    const result = resolve('$V{TotalVar}.intValue()');
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.reason, 'unknown-return-type');
    assert.strictEqual(result.typeKey, 'int');
});

// ── Literals and constructors ─────────────────────────────────────────────────

test('literals resolve to their boxed types', () => {
    assert.strictEqual(resolve('"text"').typeKey, 'java.lang.String');
    assert.strictEqual(resolve("'c'").typeKey, 'java.lang.Character');
    assert.strictEqual(resolve('true').typeKey, 'java.lang.Boolean');
    assert.strictEqual(resolve('42').typeKey, 'int');
    assert.strictEqual(resolve('42L').typeKey, 'long');
    assert.strictEqual(resolve('1.5').typeKey, 'double');
    assert.strictEqual(resolve('1.5f').typeKey, 'float');
});

test('a constructor call resolves to the constructed type', () => {
    const result = resolveReceiver('new com.acme.Customer()', {
        declarations: { fields: [], parameters: [], variables: [] },
        lookup,
    });
    assert.strictEqual(result.resolved, true);
    assert.strictEqual(result.typeKey, 'com.acme.Customer');
});

// ── Non-receivers ─────────────────────────────────────────────────────────────

test('things that are not receivers are reported so the caller can fall back', () => {
    for (const text of ['', '   ', 'Math', 'java.lang', 'null', '$F{', 'a +', '.', 'foo(']) {
        assert.strictEqual(resolve(text).resolved, false, `"${text}" must not resolve`);
        assert.ok(
            ['not-a-receiver', 'too-deep', 'unknown-ref'].includes(resolve(text).reason),
            `"${text}" reported as ${resolve(text).reason}`
        );
    }
});

test('a decimal point is not a member access', () => {
    // `1.5` is a literal, not a receiver; the provider is what refuses to enter
    // member mode after a digit (see completionProvider tests).
    assert.strictEqual(literalType('1.5'), 'double');
    assert.strictEqual(literalType('1.'), null);
    assert.strictEqual(resolveReceiver('1.5', context).typeKey, 'double');
});

test('deeply nested expressions stop instead of recursing forever', () => {
    const deep = '$F{CustomerName}' + '.trim()'.repeat(20);
    const result = resolve(deep);
    assert.strictEqual(result.resolved, false);
    assert.ok(['too-deep', 'unknown-method'].includes(result.reason), result.reason);
});

test('unterminated literals do not shift the receiver', () => {
    assert.strictEqual(resolveReceiver('"unterminated', context).reason, 'not-a-receiver');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

test('arityMatches accepts exact counts and lets varargs absorb the rest', () => {
    assert.ok(arityMatches({ params: ['int'] }, 1));
    assert.ok(!arityMatches({ params: ['int'] }, 0));
    assert.ok(arityMatches({ params: ['java.lang.String', 'java.lang.Object[]'], varargs: true }, 1));
    assert.ok(arityMatches({ params: ['java.lang.String', 'java.lang.Object[]'], varargs: true }, 4));
    assert.ok(!arityMatches({ params: ['java.lang.String', 'java.lang.Object[]'], varargs: true }, 0));
    // A method whose only parameter is varargs accepts any count, including none.
    assert.ok(arityMatches({ params: [], varargs: true }, 0));
    assert.ok(arityMatches({ params: [], varargs: true }, 3));
});

test('countArguments ignores commas inside calls, generics and strings', () => {
    assert.strictEqual(countArguments(''), 0);
    assert.strictEqual(countArguments('a'), 1);
    assert.strictEqual(countArguments('a, b'), 2);
    assert.strictEqual(countArguments('f(a, b), c'), 2);
    assert.strictEqual(countArguments('"x,y", z'), 2);
    assert.strictEqual(countArguments('new java.util.HashMap<String, String>()'), 1);
});

test('matchingOpenParen skips parentheses inside string literals', () => {
    assert.strictEqual(matchingOpenParen('f(a)'), 1);
    assert.strictEqual(matchingOpenParen('f(g(x), "),(")'), 1);
    assert.strictEqual(matchingOpenParen('no parens at all)'), -1);
});
