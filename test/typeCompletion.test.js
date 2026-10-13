// test/typeCompletion.test.js
// Unit tests for the candidate builder: ordering, snippets, labels and the
// explanation shown when a receiver cannot be typed.

const test   = require('node:test');
const assert = require('node:assert');

const {
    buildMemberCandidates,
    buildTypeHint,
    documentationFor,
    signatureOf,
    snippetFor,
    parameterName,
    shortType,
} = require('../typeCompletion');

function resolved(typeKey, methods, fields = []) {
    return { typeKey, resolved: true, kind: 'class', methods, fields, ambiguous: false };
}

function names(candidates) {
    return candidates.map(c => c.name);
}

// ── Candidates ────────────────────────────────────────────────────────────────

test('own members sort before inherited ones and Object comes last', () => {
    const candidates = buildMemberCandidates(resolved('java.lang.String', [
        { name: 'getClass', params: [], returns: 'java.lang.Class', declaringType: 'java.lang.Object' },
        { name: 'subSequence', params: ['int', 'int'], returns: 'java.lang.CharSequence', declaringType: 'java.lang.CharSequence' },
        { name: 'toUpperCase', params: [], returns: 'java.lang.String', declaringType: 'java.lang.String' },
        { name: 'length', params: [], returns: 'int', declaringType: 'java.lang.String' },
    ]));

    const tiers = candidates.map(c => c.tier);
    assert.deepStrictEqual(tiers, [...tiers].sort((a, b) => a - b), 'tiers must not go backwards');
    assert.strictEqual(candidates[0].declaringType, 'java.lang.String');
    assert.strictEqual(candidates[candidates.length - 1].name, 'getClass');
});

test('popular members are ranked above the alphabetical default', () => {
    const candidates = buildMemberCandidates(resolved('java.lang.String', [
        { name: 'codePointAt', params: ['int'], returns: 'int', declaringType: 'java.lang.String' },
        { name: 'length', params: [], returns: 'int', declaringType: 'java.lang.String' },
        { name: 'toUpperCase', params: [], returns: 'java.lang.String', declaringType: 'java.lang.String' },
    ]));
    assert.deepStrictEqual(names(candidates).slice(0, 2), ['length', 'toUpperCase']);
});

test('overloads become separate candidates with their arity in the label', () => {
    const candidates = buildMemberCandidates(resolved('java.lang.String', [
        { name: 'substring', params: ['int'], returns: 'java.lang.String', declaringType: 'java.lang.String' },
        { name: 'substring', params: ['int', 'int'], returns: 'java.lang.String', declaringType: 'java.lang.String' },
    ]));

    assert.strictEqual(candidates.length, 2);
    assert.deepStrictEqual(candidates.map(c => c.labelDetail), ['(int)', '(int, int)']);
    assert.deepStrictEqual(candidates.map(c => c.filterText), ['substring', 'substring'], 'both match the typed name');
});

test('methods become snippets with named placeholders', () => {
    const [candidate] = buildMemberCandidates(resolved('java.lang.String', [
        { name: 'substring', params: ['int', 'int'], returns: 'java.lang.String', declaringType: 'java.lang.String' },
    ]));
    assert.strictEqual(candidate.insertText, 'substring(${1:n}, ${2:n2})');
    assert.strictEqual(candidate.detail, 'substring(int, int) : String');
    assert.strictEqual(candidate.labelDescription, 'String');
});

test('fields carry their type and insert their own name', () => {
    const [candidate] = buildMemberCandidates(resolved('java.lang.Integer', [], [
        { name: 'MAX_VALUE', type: 'int', declaringType: 'java.lang.Integer' },
    ]));
    assert.strictEqual(candidate.kind, 'field');
    assert.strictEqual(candidate.insertText, 'MAX_VALUE');
    assert.strictEqual(candidate.detail, 'MAX_VALUE : int');
});

test('deprecated members are flagged', () => {
    const [candidate] = buildMemberCandidates(resolved('java.util.Date', [
        { name: 'getYear', params: [], returns: 'int', declaringType: 'java.util.Date', deprecated: true },
    ]));
    assert.strictEqual(candidate.deprecated, true);
});

test('an unresolved member list produces no candidates', () => {
    assert.deepStrictEqual(buildMemberCandidates({ resolved: false, methods: [], fields: [] }), []);
    assert.deepStrictEqual(buildMemberCandidates(null), []);
});

test('the candidate limit is respected', () => {
    const methods = Array.from({ length: 20 }, (_, i) => ({
        name: `m${i}`, params: [], returns: 'void', declaringType: 'java.lang.String',
    }));
    assert.strictEqual(buildMemberCandidates(resolved('java.lang.String', methods), { limit: 5 }).length, 5);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

test('shortType trims packages, nested classes and arrays', () => {
    assert.strictEqual(shortType('java.lang.String'), 'String');
    assert.strictEqual(shortType('java.util.Map$Entry'), 'Map.Entry');
    assert.strictEqual(shortType('byte[]'), 'byte[]');
    assert.strictEqual(shortType('java.util.List<java.lang.String>'), 'List');
    assert.strictEqual(shortType(''), '');
});

test('parameterName produces unique, readable placeholders', () => {
    const used = new Set();
    assert.strictEqual(parameterName('int', 0, used), 'n');
    assert.strictEqual(parameterName('int', 1, used), 'n2');
    assert.strictEqual(parameterName('java.lang.String', 2, used), 'str');
    assert.strictEqual(parameterName('java.util.Date', 3, used), 'date');
    assert.strictEqual(parameterName('java.util.List', 4, used), 'values');
    assert.strictEqual(parameterName('com.acme.Thing', 5, used), 'thing');
});

test('snippetFor and signatureOf describe the same call', () => {
    const member = { name: 'setScale', params: ['int', 'java.math.RoundingMode'], returns: 'java.math.BigDecimal' };
    assert.strictEqual(snippetFor(member), 'setScale(${1:n}, ${2:roundingmode})');
    assert.strictEqual(signatureOf(member), 'setScale(int, RoundingMode)');
    assert.strictEqual(signatureOf({ name: 'length', params: [], returns: 'int' }), 'length()');
});

test('documentation names the declaring type and warns about deprecation', () => {
    const doc = documentationFor({
        signature: 'getYear()',
        declaringType: 'java.util.Date',
        deprecated: true,
    }, 'java.util.Date');
    assert.match(doc, /getYear\(\)/);
    assert.match(doc, /java\.util\.Date/);
    assert.match(doc, /Deprecated/);

    const inherited = documentationFor({
        signature: 'equals(Object)',
        declaringType: 'java.lang.Object',
        deprecated: false,
    }, 'java.lang.String');
    assert.match(inherited, /Inherited for `java.lang.String`/);
});

// ── Type hints ────────────────────────────────────────────────────────────────

test('a field without a class gets an actionable hint that inserts nothing', () => {
    const hint = buildTypeHint({ resolved: false, reason: 'no-class', sigil: 'F', name: 'CustomerName', reference: '$F{CustomerName}' });
    assert.ok(hint, 'expected a hint');
    assert.match(hint.label, /\$F\{CustomerName\}/);
    assert.match(hint.documentation, /class="java\.lang\.String"/);
    assert.strictEqual(hint.insertText, '$0', 'accepting the hint must not insert text');
});

test('an unindexed class explains what is covered instead', () => {
    const hint = buildTypeHint({ resolved: false, reason: 'unknown-type', declaredType: 'com.acme.Customer' });
    assert.ok(hint);
    assert.match(hint.label, /com\.acme\.Customer/);
    assert.match(hint.documentation, /JDK types/);
});

test('an ambiguous short name lists the candidates', () => {
    const hint = buildTypeHint({
        resolved: false,
        reason: 'ambiguous',
        name: 'Date',
        ambiguity: { name: 'Date', candidates: ['java.util.Date', 'java.sql.Date'] },
    });
    assert.ok(hint);
    assert.match(hint.label, /java\.util\.Date and java\.sql\.Date/);
    assert.match(hint.documentation, /java\.sql\.Date/);
});

test('reasons the user cannot act on stay silent', () => {
    for (const reason of ['unknown-ref', 'type-variable', 'unknown-method', 'not-a-receiver', 'unknown-return-type', 'too-deep', 'no-type']) {
        assert.strictEqual(buildTypeHint({ resolved: false, reason }), null, `${reason} must not produce a hint`);
    }
    assert.strictEqual(buildTypeHint({ resolved: true, typeKey: 'java.lang.String' }), null);
    assert.strictEqual(buildTypeHint(null), null);
});
