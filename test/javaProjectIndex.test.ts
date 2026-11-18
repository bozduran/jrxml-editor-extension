// test/javaProjectIndex.test.js
// The workspace Java index shared by completion and lint.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractJavaClass } from '../out/javaSourceScan.js';
import type { JavaClass } from '../out/javaSourceScan.js';
import {
    buildJavaProjectIndex,
    classBySimpleName,
    getJavaProjectIndex,
    clearJavaProjectIndex,
    EMPTY_JAVA_PROJECT_INDEX,
} from '../out/javaProjectIndex.js';

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

/** The fixture sources always declare a public top-level class. */
function scannedClass(source: string): JavaClass {
    const scanned = extractJavaClass(source);
    assert.ok(scanned, 'the fixture source must declare a class');
    return scanned;
}

test('indexes classes by qualified and simple name', () => {
    const index = buildJavaProjectIndex([scannedClass(SOURCE)]);

    assert.ok(index.byQualified.get('com.acme.util.Helpers'));
    assert.deepStrictEqual([...index.packages], ['com.acme.util']);
    const helpers = classBySimpleName(index, 'Helpers');
    assert.ok(helpers, 'Helpers must resolve to its single class');
    assert.strictEqual(helpers.qualifiedName, 'com.acme.util.Helpers');
    assert.strictEqual(classBySimpleName(index, 'Missing'), null);
});

test('only static methods reach the completion table', () => {
    const index = buildJavaProjectIndex([scannedClass(SOURCE)]);
    const labels = index.methods.map(method => method.label);

    assert.deepStrictEqual(labels, ['Helpers.upper', 'Helpers.sum']);
    assert.ok(!labels.includes('Helpers.instanceOnly'));
});

test('an ambiguous simple name is not resolved', () => {
    const first = scannedClass(SOURCE);
    const second = { ...scannedClass(OTHER), packageName: 'com.other', qualifiedName: 'com.other.Helpers' };
    const index = buildJavaProjectIndex([first, second]);

    assert.strictEqual(classBySimpleName(index, 'Helpers'), null, 'two Helpers classes are ambiguous');
    assert.ok(index.byQualified.get('com.other.Helpers'));
});

test('a duplicate qualified name is indexed once', () => {
    const index = buildJavaProjectIndex([scannedClass(SOURCE), scannedClass(OTHER)]);
    assert.strictEqual(index.classes.length, 1);
    const helpers = index.byQualified.get('com.acme.util.Helpers');
    assert.ok(helpers, 'the duplicate was indexed');
    assert.strictEqual(helpers.methods.length, 3);
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
