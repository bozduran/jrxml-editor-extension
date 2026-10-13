// test/jdkMemberIndex.test.js
// Unit tests for the member lookup behind typed completion. The module is
// vscode-free, so this runs with plain `npm test`.

const test   = require('node:test');
const assert = require('node:assert');

const {
    buildIndex,
    getMembers,
    normalizeTypeKey,
    isIndexed,
    ambiguityOf,
    stats,
    clearCache,
} = require('../jdkMemberIndex');

function names(result) {
    return result.methods.map(m => m.name);
}

// ── Data loaded ───────────────────────────────────────────────────────────────

test('the generated index is loaded, not the fallback', () => {
    const info = stats();
    assert.strictEqual(info.usingFallback, false, 'data/jdk-members.json must be readable');
    assert.ok(info.types > 50, `expected the full table, got ${info.types} types`);
    assert.ok(info.members > 1000, `expected the full table, got ${info.members} members`);
    assert.strictEqual(info.baseline, 8);
});

test('a missing or corrupt table falls back to a minimal one instead of failing', () => {
    const fallback = buildIndex(null, null);
    assert.strictEqual(fallback.usingFallback, true);
    assert.ok(fallback.types['java.lang.String'], 'fallback must still complete String');

    const broken = buildIndex({ schemaVersion: 1 }, null);
    assert.strictEqual(broken.usingFallback, true);
});

// ── Type keys ─────────────────────────────────────────────────────────────────

test('normalizeTypeKey resolves full names, short names, generics and arrays', () => {
    assert.strictEqual(normalizeTypeKey('java.lang.String'), 'java.lang.String');
    assert.strictEqual(normalizeTypeKey('String'), 'java.lang.String');
    assert.strictEqual(normalizeTypeKey('BigDecimal'), 'java.math.BigDecimal');
    assert.strictEqual(normalizeTypeKey('java.util.List<java.lang.String>'), 'java.util.List');
    assert.strictEqual(normalizeTypeKey('java.util.Map<java.lang.String, java.util.List<java.lang.Integer>>'), 'java.util.Map');
    assert.strictEqual(normalizeTypeKey('java.lang.String...'), 'java.lang.String[]');
    assert.strictEqual(normalizeTypeKey('byte[]'), 'byte[]');
    assert.strictEqual(normalizeTypeKey('  String  '), 'java.lang.String');
    assert.strictEqual(normalizeTypeKey(''), null);
    assert.strictEqual(normalizeTypeKey(null), null);
});

test('normalizeTypeKey keeps primitives as-is and unknown classes verbatim', () => {
    assert.strictEqual(normalizeTypeKey('int'), 'int');
    assert.strictEqual(normalizeTypeKey('com.acme.Customer'), 'com.acme.Customer');
});

test('JasperReports built-in parameter types resolve to the curated entries', () => {
    assert.strictEqual(normalizeTypeKey('JRDataSource'), 'net.sf.jasperreports.engine.JRDataSource');
    assert.strictEqual(isIndexed('JRDataSource'), true);
    assert.strictEqual(isIndexed('net.sf.jasperreports.engine.JRRewindableDataSource'), true);
});

test('a short name matching several types is resolved deterministically and reported', () => {
    // `Date` is both java.util.Date and java.sql.Date in the table.
    assert.strictEqual(normalizeTypeKey('Date'), 'java.util.Date');
    const ambiguity = ambiguityOf('Date');
    assert.ok(ambiguity, 'expected ambiguity to be reported');
    assert.deepStrictEqual(ambiguity.candidates, ['java.util.Date', 'java.sql.Date']);
    assert.strictEqual(ambiguityOf('java.util.Date'), null, 'a full name is never ambiguous');
    assert.strictEqual(getMembers('Date').ambiguous, true);
    assert.strictEqual(getMembers('java.util.Date').ambiguous, false);
});

// ── Member lookup ─────────────────────────────────────────────────────────────

test('String exposes its own members and the inherited Object ones', () => {
    const result = getMembers('java.lang.String');
    assert.strictEqual(result.resolved, true);
    assert.strictEqual(result.kind, 'class');
    assert.ok(names(result).includes('toUpperCase'));
    assert.ok(names(result).includes('substring'));
    assert.ok(names(result).includes('getClass'), 'Object.getClass is inherited');

    // String overrides equals(); getClass() is only ever declared by Object.
    assert.strictEqual(result.methods.find(m => m.name === 'equals').declaringType, 'java.lang.String');
    assert.strictEqual(result.methods.find(m => m.name === 'getClass').declaringType, 'java.lang.Object');
    assert.strictEqual(result.methods.find(m => m.name === 'toUpperCase').declaringType, 'java.lang.String');
});

test('every reference type inherits the Object members, interfaces included', () => {
    for (const type of ['java.lang.String', 'java.util.List', 'JRDataSource', 'byte[]']) {
        const result = getMembers(type);
        assert.ok(names(result).includes('toString'), `${type} should reach Object.toString`);
        assert.ok(names(result).includes('getClass'), `${type} should reach Object.getClass`);
    }
    assert.strictEqual(getMembers('java.util.List').methods.find(m => m.name === 'getClass').declaringType, 'java.lang.Object');
});

test('inherited members are deduplicated, most derived first', () => {
    const hashCodes = getMembers('java.lang.String').methods.filter(m => m.name === 'hashCode');
    assert.strictEqual(hashCodes.length, 1);
    assert.strictEqual(hashCodes[0].declaringType, 'java.lang.String');
});

test('members are copied, so a caller cannot corrupt the shared index', () => {
    const first = getMembers('java.lang.String');
    first.methods[0].name = 'mutated';
    first.methods.length = 0;

    const second = getMembers('java.lang.String');
    assert.ok(second.methods.length > 0, 'caller mutation must not empty the cache');
    assert.ok(second.methods.every(m => m.name !== 'mutated'));
});

test('static members are hidden unless asked for', () => {
    const instance = getMembers('java.lang.Integer');
    assert.ok(instance.methods.length > 0);
    assert.ok(instance.methods.every(m => !m.static), 'no statics on an instance receiver');

    const all = getMembers('java.lang.Integer', { includeStatics: true });
    assert.ok(all.methods.some(m => m.static), 'statics available when requested');
});

test('members newer than the baseline are hidden', () => {
    const java8 = getMembers('java.lang.String', { baseline: 8 });
    assert.ok(!names(java8).includes('isBlank'));
    assert.ok(!names(java8).includes('strip'));

    const java11 = getMembers('java.lang.String', { baseline: 11 });
    assert.ok(names(java11).includes('isBlank'));
    assert.ok(!names(java11).includes('formatted'), 'formatted is Java 15');

    const java21 = getMembers('java.util.List', { baseline: 21 });
    assert.ok(names(java21).includes('getFirst'));
    assert.ok(!names(getMembers('java.util.List', { baseline: 8 })).includes('getFirst'));
});

test('members reachable only through unindexed supertypes survive', () => {
    const builder = getMembers('java.lang.StringBuilder');
    // StringBuilder declares charAt/length as bridge methods; CharSequence is
    // where the callable declaration lives.
    assert.ok(names(builder).includes('charAt'));
    assert.ok(names(builder).includes('length'));
    assert.ok(names(builder).includes('substring'));
    assert.ok(builder.methods.find(m => m.name === 'charAt').declaringType === 'java.lang.CharSequence');
});

test('interfaces and their implementations share the inherited members', () => {
    const list = getMembers('java.util.List');
    assert.ok(names(list).includes('size'), 'Collection.size flows into List');
    assert.ok(names(list).includes('stream'));
    assert.ok(names(list).includes('iterator'));

    const arrayList = getMembers('java.util.ArrayList');
    assert.ok(names(arrayList).includes('get'));
    assert.ok(names(arrayList).includes('stream'), 'reachable through AbstractList → AbstractCollection');
});

test('JasperReports engine types complete, including their supertypes', () => {
    const source = getMembers('JRDataSource');
    assert.ok(names(source).includes('next'));
    assert.ok(names(source).includes('getFieldValue'));
    assert.strictEqual(source.methods.find(m => m.name === 'next').declaringType, 'net.sf.jasperreports.engine.JRDataSource');

    const rewindable = getMembers('JRRewindableDataSource');
    assert.ok(names(rewindable).includes('moveBeforeFirst'));
    assert.ok(names(rewindable).includes('next'), 'inherits JRDataSource');
});

test('built-in parameter types from jasperBuiltins all resolve or fail cleanly', () => {
    const { BUILTIN_PARAMETERS } = require('../jasperBuiltins');
    for (const parameter of BUILTIN_PARAMETERS) {
        const result = getMembers(parameter.type);
        if (result.resolved) {
            assert.ok(result.methods.length > 0, `${parameter.name} (${parameter.type}) has no members`);
        } else {
            assert.strictEqual(result.reason, 'unknown-type', `${parameter.type} should resolve or be unknown`);
        }
    }
});

test('arrays expose length, clone and the Object members', () => {
    const bytes = getMembers('byte[]');
    assert.strictEqual(bytes.resolved, true);
    assert.strictEqual(bytes.kind, 'array');
    assert.deepStrictEqual(bytes.fields.map(f => f.name), ['length']);
    assert.ok(names(bytes).includes('clone'));
    assert.ok(names(bytes).includes('toString'));
});

test('unresolvable input is reported, never guessed at', () => {
    const unknown = getMembers('com.acme.Customer');
    assert.strictEqual(unknown.resolved, false);
    assert.strictEqual(unknown.reason, 'unknown-type');
    assert.deepStrictEqual(unknown.methods, []);
    assert.strictEqual(unknown.typeKey, 'com.acme.Customer');

    const primitive = getMembers('int');
    assert.strictEqual(primitive.resolved, false);
    assert.strictEqual(primitive.reason, 'unknown-type');

    const nothing = getMembers(null);
    assert.strictEqual(nothing.resolved, false);
    assert.strictEqual(nothing.reason, 'no-type');
});

test('clearCache rebuilds the same lookup', () => {
    const before = getMembers('java.lang.String').methods.length;
    clearCache();
    assert.strictEqual(getMembers('java.lang.String').methods.length, before);
});
