// test/javaProjectIndex.test.js
// The workspace Java index shared by completion and lint.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const { extractJavaClass } = require('../out/javaSourceScan');
const {
    buildJavaProjectIndex,
    classBySimpleName,
    getJavaProjectIndex,
    clearJavaProjectIndex,
    EMPTY_JAVA_PROJECT_INDEX,
} = require('../out/javaProjectIndex');

const SOURCE = `package com.acme.util;
public final class Helpers {
    public static String upper(String name) { return name; }
    public static int sum(int a, int b) { return a + b; }
    public String instanceOnly() { return ""; }
}
`;

const OTHER = `package com.acme.util;
public final class Helpers {
    public static void other() {}
}
`;

test('indexes classes by qualified and simple name', () => {
    const index = buildJavaProjectIndex([extractJavaClass(SOURCE)]);

    assert.ok(index.byQualified.get('com.acme.util.Helpers'));
    assert.deepStrictEqual([...index.packages], ['com.acme.util']);
    assert.strictEqual(classBySimpleName(index, 'Helpers').qualifiedName, 'com.acme.util.Helpers');
    assert.strictEqual(classBySimpleName(index, 'Missing'), null);
});

test('only static methods reach the completion table', () => {
    const index = buildJavaProjectIndex([extractJavaClass(SOURCE)]);
    const labels = index.methods.map(method => method.label);

    assert.deepStrictEqual(labels, ['Helpers.upper', 'Helpers.sum']);
    assert.ok(!labels.includes('Helpers.instanceOnly'));
});

test('an ambiguous simple name is not resolved', () => {
    const first = extractJavaClass(SOURCE);
    const second = { ...extractJavaClass(OTHER), packageName: 'com.other', qualifiedName: 'com.other.Helpers' };
    const index = buildJavaProjectIndex([first, second]);

    assert.strictEqual(classBySimpleName(index, 'Helpers'), null, 'two Helpers classes are ambiguous');
    assert.ok(index.byQualified.get('com.other.Helpers'));
});

test('a duplicate qualified name is indexed once', () => {
    const index = buildJavaProjectIndex([extractJavaClass(SOURCE), extractJavaClass(OTHER)]);
    assert.strictEqual(index.classes.length, 1);
    assert.strictEqual(index.byQualified.get('com.acme.util.Helpers').methods.length, 3);
});

test('an empty workspace yields the empty index', () => {
    assert.strictEqual(getJavaProjectIndex([]), EMPTY_JAVA_PROJECT_INDEX);
});

test('the index is cached per workspace and cleared on demand', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-index-'));
    const file = path.join(root, 'src/main/java/com/acme/Late.java');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'package com.acme; public class Late { public static void go() {} }');

    try {
        const first = getJavaProjectIndex([root]);
        assert.ok(first.byQualified.get('com.acme.Late'));
        assert.strictEqual(getJavaProjectIndex([root]), first, 'second call is cached');

        fs.rmSync(file);
        assert.strictEqual(getJavaProjectIndex([root]), first, 'still cached after a file disappears');

        clearJavaProjectIndex();
        const second = getJavaProjectIndex([root]);
        assert.strictEqual(second.byQualified.size, 0, 'cleared index rescans');
    } finally {
        clearJavaProjectIndex();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
