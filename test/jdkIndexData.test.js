// test/jdkIndexData.test.js
// Contract tests for the committed javap index (data/jdk-members.json) and the
// pure helpers of the generator that writes it. Run with: npm test

const test   = require('node:test');
const assert = require('node:assert');

const index = require('../data/jdk-members.json');
const {
    parseMember,
    parseHeader,
    normalizeMethods,
    isRedundantBridge,
    bridgeDeclarations,
    sinceFor,
    ancestorSet,
    typeKey,
} = require('../tools/gen-jdk-index');

const TYPES = index.types;

function methods(fqn) {
    return TYPES[fqn].methods;
}

function member(fqn, name, arity) {
    return methods(fqn).find(m => m.name === name && (arity === undefined || m.params.length === arity));
}

// ── Data contract ─────────────────────────────────────────────────────────────

test('index header describes how it was produced', () => {
    assert.strictEqual(index.schemaVersion, 1);
    assert.ok(index.generatedWith, 'generatedWith required');
    assert.strictEqual(index.baseline, 8);
    assert.ok(index.edges && typeof index.edges === 'object', 'edges required');
});

test('every type, method and field has the expected shape', () => {
    for (const [fqn, type] of Object.entries(TYPES)) {
        assert.ok(['class', 'interface', 'enum'].includes(type.kind), `${fqn} kind`);
        assert.ok(Array.isArray(type.methods) && Array.isArray(type.fields), `${fqn} members`);

        for (const m of type.methods) {
            assert.ok(m.name, `${fqn} method name`);
            assert.ok(Array.isArray(m.params), `${fqn}#${m.name} params`);
            assert.strictEqual(typeof m.returns, 'string', `${fqn}#${m.name} returns`);
            assert.strictEqual(typeof m.static, 'boolean', `${fqn}#${m.name} static`);
            assert.ok(Number.isInteger(m.since) && m.since >= 8, `${fqn}#${m.name} since`);
        }
        for (const f of type.fields) {
            assert.ok(f.name && typeof f.type === 'string', `${fqn}#${f.name} field`);
            assert.strictEqual(typeof f.static, 'boolean', `${fqn}#${f.name} static`);
            assert.ok(Number.isInteger(f.since) && f.since >= 8, `${fqn}#${f.name} since`);
        }
    }
});

test('no member name can collide with Object.prototype lookups', () => {
    // The runtime looks members up in null-prototype maps; a class member named
    // `toString`/`constructor` must still be a plain string key, not a function.
    for (const bad of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
        const found = methods('java.lang.Object').find(m => m.name === bad);
        if (found) assert.strictEqual(typeof found.since, 'number', `${bad} since must be a number`);
    }
});

test('signatures needed by completion are present', () => {
    assert.ok(member('java.lang.String', 'substring', 1), 'String.substring(int)');
    assert.ok(member('java.lang.String', 'substring', 2), 'String.substring(int,int)');
    assert.ok(member('java.lang.String', 'toUpperCase', 0), 'String.toUpperCase()');
    assert.ok(member('java.lang.Object', 'equals', 1), 'Object.equals — inherited by every type');
    assert.ok(member('java.math.BigDecimal', 'add', 1), 'BigDecimal.add');
    assert.ok(member('java.math.BigDecimal', 'setScale', 2), 'BigDecimal.setScale');
    assert.ok(member('java.sql.ResultSet', 'getString', 1), 'ResultSet.getString');
    assert.ok(member('java.util.Date', 'toInstant', 0), 'Date.toInstant');
});

test('constructors are never offered as members', () => {
    for (const [fqn, type] of Object.entries(TYPES)) {
        const simple = fqn.split('.').pop();
        for (const m of type.methods) {
            assert.notStrictEqual(m.name, simple, `${fqn} lists its constructor`);
        }
    }
});

test('javap bridge methods are collapsed', () => {
    // compareTo(Object) is the erased bridge of compareTo(String).
    assert.ok(!methods('java.lang.String').some(m => m.name === 'compareTo' && m.params[0] === 'java.lang.Object'));
    // valueOf(Object) is a real overload, not a bridge, and must survive.
    assert.ok(methods('java.lang.String').some(m => m.name === 'valueOf' && m.params[0] === 'java.lang.Object'));
    // StringBuilder declares charAt/length only as bridges; the inherited
    // CharSequence declarations keep them reachable.
    assert.ok(methods('java.lang.CharSequence').some(m => m.name === 'charAt'));
    assert.ok(methods('java.lang.CharSequence').some(m => m.name === 'getChars'));
    // resolveConstantDesc(Lookup) must keep the String return, not the Object bridge.
    assert.strictEqual(member('java.lang.String', 'resolveConstantDesc', 1).returns, 'java.lang.String');
    // remove(Object) and remove(int) are different methods and must both survive.
    assert.ok(member('java.util.List', 'remove', 1));
    const removes = methods('java.util.List').filter(m => m.name === 'remove');
    assert.strictEqual(new Set(removes.map(m => m.params.join(','))).size, removes.length, 'duplicate remove()');
});

test('`since` marks the post-Java-8 APIs that matter', () => {
    assert.strictEqual(member('java.lang.String', 'isBlank', 0).since, 11);
    assert.strictEqual(member('java.lang.String', 'strip', 0).since, 11);
    assert.strictEqual(member('java.lang.String', 'substring', 1).since, 8);
    assert.strictEqual(member('java.util.Map', 'getOrDefault', 2).since, 8);
    assert.strictEqual(member('java.util.Collection', 'toArray', 1).params[0], 'java.util.function.IntFunction');
    assert.strictEqual(member('java.util.Collection', 'toArray', 1).since, 11);
    assert.ok(member('java.util.Collection', 'toArray', 1).since === 11);
    assert.strictEqual(methods('java.util.Collection').find(m => m.name === 'toArray' && m.params.length === 0).since, 8);
    assert.strictEqual(member('java.util.ArrayList', 'getFirst', 0).since, 21);
    assert.strictEqual(member('java.util.List', 'reversed', 0).since, 21);
    assert.strictEqual(member('java.sql.Connection', 'enquoteLiteral', 1).since, 9);
    assert.strictEqual(member('java.util.Optional', 'ofNullable', 1).since, 8);
});

test('deprecated members are flagged', () => {
    assert.strictEqual(member('java.util.Date', 'getYear', 0).deprecated, true);
    assert.strictEqual(member('java.util.Date', 'getTime', 0).deprecated, undefined);
});

test('every supertype edge points at a class the walk can follow', () => {
    for (const [fqn, parents] of Object.entries(index.edges)) {
        assert.ok(Array.isArray(parents), `${fqn} edges`);
        for (const parent of parents) {
            assert.ok(index.edges[parent], `${fqn} → ${parent} has no edges entry`);
        }
    }
});

test('unindexed supertypes are still walkable', () => {
    // ArrayList → AbstractList → AbstractCollection → Collection: only the last
    // is indexed, the edges map has to bridge the gap.
    const ancestors = ancestorSet('java.util.ArrayList', index.edges);
    assert.ok(ancestors.has('java.util.AbstractList'));
    assert.ok(ancestors.has('java.util.Collection'));
    assert.ok(ancestors.has('java.lang.Iterable'));
});

// ── Generator helpers ─────────────────────────────────────────────────────────

test('parseHeader ignores `extends` inside a type-parameter bound', () => {
    const line = 'public interface java.util.stream.BaseStream<T, S extends java.util.stream.BaseStream<T, S>> extends java.lang.AutoCloseable {';
    const header = parseHeader(line);
    assert.strictEqual(header.fqn, 'java.util.stream.BaseStream');
    assert.deepStrictEqual(header.supertypes, ['java.lang.AutoCloseable']);
});

test('parseHeader handles class, interface and enum declarations', () => {
    assert.deepStrictEqual(
        parseHeader('public final class java.lang.String extends java.lang.Object implements java.io.Serializable, java.lang.Comparable<java.lang.String> {').supertypes,
        ['java.lang.Object', 'java.io.Serializable', 'java.lang.Comparable']
    );
    assert.strictEqual(
        parseHeader('public interface java.util.List<E> extends java.util.Collection<E> {').kind,
        'interface'
    );
    assert.strictEqual(
        parseHeader('public final class java.time.DayOfWeek extends java.lang.Enum<java.time.DayOfWeek> implements java.time.temporal.TemporalAccessor {').kind,
        'enum'
    );
});

test('parseMember reads methods, fields, varargs, arrays and throws clauses', () => {
    const method = parseMember('  public java.lang.String substring(int, int);', 'String');
    assert.deepStrictEqual(method.params.map(p => p.text), ['int', 'int']);
    assert.strictEqual(method.returns.text, 'java.lang.String');

    const varargs = parseMember('  public static java.lang.String join(java.lang.CharSequence, java.lang.CharSequence...);', 'String');
    assert.deepStrictEqual(varargs.params.map(p => p.text), ['java.lang.CharSequence', 'java.lang.CharSequence[]']);

    const throws = parseMember('  public final void wait(long, int) throws java.lang.InterruptedException;', 'Object');
    assert.strictEqual(throws.name, 'wait');
    assert.deepStrictEqual(throws.params.map(p => p.text), ['long', 'int']);

    const generic = parseMember('  public static <T> T requireNonNull(T);', 'Objects');
    assert.strictEqual(generic.name, 'requireNonNull');
    assert.strictEqual(generic.params[0].text, 'T');

    const field = parseMember('  public static final java.util.Comparator<java.lang.String> CASE_INSENSITIVE_ORDER;', 'String');
    assert.strictEqual(field.kind, 'field');
    assert.strictEqual(field.name, 'CASE_INSENSITIVE_ORDER');
    assert.strictEqual(field.type.text, 'java.util.Comparator');

    assert.strictEqual(parseMember('  public java.lang.String(byte[]);', 'String'), null, 'constructor');
});

test('typeKey rejects type variables that cannot be resolved', () => {
    assert.strictEqual(typeKey('java.util.List<java.lang.String>'), 'java.util.List');
    assert.strictEqual(typeKey('E'), null);
    assert.strictEqual(typeKey('T[]'), null);
    assert.strictEqual(typeKey('?'), null);
    assert.strictEqual(typeKey('byte[]'), 'byte[]');
});

test('bridgeDeclarations reads ACC_BRIDGE/ACC_SYNTHETIC from javap -v output', () => {
    const verbose = [
        'public final class Example {',
        '  public int compareTo(java.lang.String);',
        '    descriptor: (Ljava/lang/String;)I',
        '    flags: (0x0001) ACC_PUBLIC',
        '',
        '  public int compareTo(java.lang.Object);',
        '    descriptor: (Ljava/lang/Object;)I',
        '    flags: (0x1041) ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC',
        '',
        '  static {};',
        '    flags: (0x0008) ACC_STATIC, ACC_SYNTHETIC',
        '}',
    ].join('\n');

    const bridges = bridgeDeclarations(verbose);
    assert.ok(bridges.has('public int compareTo(java.lang.Object);'));
    assert.ok(!bridges.has('public int compareTo(java.lang.String);'));
});

test('isRedundantBridge only matches bridges that re-expose a reachable member', () => {
    const bridge = { name: 'compareTo', params: ['java.lang.Object'], returns: 'int', bridge: true };
    const specific = { name: 'compareTo', params: ['java.lang.String'], returns: 'int', bridge: false };
    assert.ok(isRedundantBridge(bridge, specific));
    assert.ok(!isRedundantBridge(specific, bridge));

    // A declared method is never treated as a bridge, however it looks.
    assert.ok(!isRedundantBridge(
        { name: 'valueOf', params: ['java.lang.Object'], returns: 'java.lang.String', bridge: false },
        { name: 'valueOf', params: ['char[]'], returns: 'java.lang.String', bridge: false }
    ));

    // Different names or primitives are not erasures of each other.
    assert.ok(!isRedundantBridge(
        { name: 'getOrDefault', params: ['java.lang.Object', 'V'], returns: 'V', bridge: true },
        { name: 'putIfAbsent', params: ['K', 'V'], returns: 'V', bridge: false }
    ));
    assert.ok(!isRedundantBridge(
        { name: 'remove', params: ['java.lang.Object'], returns: 'boolean', bridge: true },
        { name: 'remove', params: ['int'], returns: 'java.lang.Object', bridge: false }
    ));
});

test('normalizeMethods keeps the specific covariant return', () => {
    const list = normalizeMethods([
        { name: 'repeat', params: ['int', 'int'], returns: 'java.lang.StringBuilder' },
        { name: 'repeat', params: ['int', 'int'], returns: 'java.lang.AbstractStringBuilder' },
    ]);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].returns, 'java.lang.StringBuilder');
});

test('sinceFor consults signature, arity, name and sequenced rules', () => {
    assert.strictEqual(sinceFor('java.util.Collection', { name: 'toArray', params: ['java.util.function.IntFunction'] }), 11);
    assert.strictEqual(sinceFor('java.util.Collection', { name: 'toArray', params: ['T[]'] }), 8);
    assert.strictEqual(sinceFor('java.util.Optional', { name: 'orElseThrow', params: [] }), 10);
    assert.strictEqual(sinceFor('java.lang.String', { name: 'describeConstable', params: [] }), 12);
    assert.strictEqual(sinceFor('java.util.ArrayList', { name: 'getFirst', params: [] }, { sequenced: true }), 21);
    assert.strictEqual(sinceFor('java.util.ArrayList', { name: 'getFirst', params: [] }, { sequenced: false }), 8);
    assert.strictEqual(sinceFor('java.lang.String', { name: 'toString', params: [] }), 8);
});
