// test/javaSourceScan.test.js
// The Java helper scan must work for multi-module Maven/Gradle workspaces:
// every <module>/src/main/java at any depth, without wandering into build
// outputs, and with fully-qualified snippets so reports need no <import>.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CustomMethod } from '../out/expressionSuggestions.js';
import {
    discoverJavaSourceRoots,
    extractJavaClass,
    scanJavaClasses,
    collectJavaClasses,
    staticMethodsOf,
} from '../out/javaSourceScan.js';

/** Static completion entries for one source, via the class model. */
function staticMethods(source: string): CustomMethod[] {
    const javaClass = extractJavaClass(source);
    return javaClass ? staticMethodsOf([javaClass]) : [];
}

const tempRoots: string[] = [];

function project(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-java-'));
    tempRoots.push(root);
    return root;
}

function write(root: string, relative: string, content: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function relativeRoots(root: string, roots: readonly string[]): string[] {
    return roots.map(item => path.relative(root, item).split(path.sep).join('/')).sort();
}

test.after(() => {
    for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

const HELPERS = `package com.acme.util;

public final class Helpers {
    public static String upper(String name) { return name; }
    public static java.util.List<String> names(String prefix) { return null; }
    public static <T> T identity(T value) { return value; }
    public static int sum(int a, int b) { return a + b; }
    public static void put(java.util.Map<String, Integer> values, String key) {}
    private static void hidden() {}
    public String instance() { return ""; }
}
`;

// ── Discovery ────────────────────────────────────────────────────────────────

test('finds src/main/java in modules nested at any depth', () => {
    const root = project();
    write(root, 'core/src/main/java/com/acme/core/A.java', 'public class A {}');
    write(root, 'services/api/src/main/java/com/acme/api/B.java', 'public class B {}');
    write(root, 'services/api/target/generated-sources/src/main/java/C.java', 'public class C {}');
    write(root, 'node_modules/pkg/src/main/java/D.java', 'public class D {}');
    write(root, '.hidden/src/main/java/E.java', 'public class E {}');
    write(root, 'docs/readme.md', '# docs');

    const roots = discoverJavaSourceRoots(root);

    assert.deepStrictEqual(relativeRoots(root, roots), [
        'core/src/main/java',
        'services/api/src/main/java',
    ]);
});

test('finds the workspace root module too', () => {
    const root = project();
    write(root, 'src/main/java/com/acme/Only.java', 'public class Only {}');

    assert.deepStrictEqual(relativeRoots(root, discoverJavaSourceRoots(root)), ['src/main/java']);
});

test('extra paths are scanned and de-duplicated', () => {
    const root = project();
    write(root, 'src/main/java/com/acme/Only.java', 'public class Only {}');
    write(root, 'generated/java/com/acme/Made.java', 'public class Made {}');

    const roots = discoverJavaSourceRoots(root, {
        extraPaths: ['generated/java', './src/main/java', 'missing/path'],
    });

    assert.deepStrictEqual(relativeRoots(root, roots), [
        'generated/java',
        'src/main/java',
    ]);
});

test('discovery respects the depth bound', () => {
    const root = project();
    write(root, 'a/b/c/d/e/src/main/java/com/acme/Deep.java', 'public class Deep {}');

    assert.deepStrictEqual(discoverJavaSourceRoots(root, { maxDepth: 0 }), []);
    assert.deepStrictEqual(
        relativeRoots(root, discoverJavaSourceRoots(root, { maxDepth: 6 })),
        ['a/b/c/d/e/src/main/java']
    );
});

// ── Extraction ───────────────────────────────────────────────────────────────

test('extracts public static methods with fully qualified snippets', () => {
    const methods = staticMethods(HELPERS);
    const byLabel = new Map(methods.map(method => [method.label, method]));

    assert.deepStrictEqual([...byLabel.keys()], [
        'Helpers.upper',
        'Helpers.names',
        'Helpers.identity',
        'Helpers.sum',
        'Helpers.put',
    ]);

    const upper = byLabel.get('Helpers.upper');
    assert.ok(upper, 'expected Helpers.upper');
    assert.strictEqual(upper.snippet, 'com.acme.util.Helpers.upper(${1:name})');
    assert.strictEqual(upper.detail, 'com.acme.util.Helpers.upper(String name) : String');
    assert.match(upper.doc, /com\.acme\.util\.Helpers/);
});

test('handles qualified and generic return types and generic parameters', () => {
    const byLabel = new Map(staticMethods(HELPERS).map(method => [method.label, method]));

    const names = byLabel.get('Helpers.names');
    assert.ok(names, 'expected Helpers.names');
    assert.strictEqual(names.snippet, 'com.acme.util.Helpers.names(${1:prefix})');
    assert.match(names.detail, /java\.util\.List<String>/);
    const identity = byLabel.get('Helpers.identity');
    assert.ok(identity, 'expected Helpers.identity');
    assert.match(identity.detail, /: T$/);
    const put = byLabel.get('Helpers.put');
    assert.ok(put, 'expected Helpers.put');
    assert.strictEqual(
        put.snippet,
        'com.acme.util.Helpers.put(${1:values}, ${2:key})',
        'a comma inside Map<String, Integer> is not a parameter separator'
    );
});

test('skips instance methods, private methods and non-public classes', () => {
    const labels = staticMethods(HELPERS).map(method => method.label);
    assert.ok(!labels.includes('Helpers.hidden'), 'private static is not callable');
    assert.ok(!labels.includes('Helpers.instance'), 'instance methods are not callable');

    assert.deepStrictEqual(
        staticMethods('package x;\nclass PackagePrivate { public static void run() {} }'),
        []
    );
});

test('a class without a package is inserted unqualified', () => {
    const [method] = staticMethods('public class Util {\n public static int one() { return 1; }\n}');
    assert.strictEqual(method.snippet, 'Util.one()');
    assert.strictEqual(method.detail, 'Util.one() : int');
});

test('enums and interfaces expose their public static methods', () => {
    const labels = staticMethods(`package x;
public enum Mode { A, B; public static Mode parse(String raw) { return A; } }
`).map(method => method.label);
    assert.deepStrictEqual(labels, ['Mode.parse']);
});

// ── Full scan ────────────────────────────────────────────────────────────────

test('collects helpers from every module and de-duplicates files', () => {
    const root = project();
    write(root, 'core/src/main/java/com/acme/core/Core.java',
        'package com.acme.core; public final class Core { public static String tag() { return "core"; } }');
    write(root, 'web/src/main/java/com/acme/web/Web.java',
        'package com.acme.web; public final class Web { public static String tag() { return "web"; } }');

    const methods = staticMethodsOf(collectJavaClasses([root]));
    const snippets = methods.map(method => method.snippet).sort();

    assert.deepStrictEqual(snippets, [
        'com.acme.core.Core.tag()',
        'com.acme.web.Web.tag()',
    ]);

    // Scanning overlapping roots must not duplicate entries.
    const again = staticMethodsOf(collectJavaClasses([root], { extraPaths: ['core/src/main/java'] }));
    assert.strictEqual(again.length, 2);
});

test('the file cap stops the scan early', () => {
    const root = project();
    for (let i = 0; i < 3; i += 1) {
        write(root, `mod${i}/src/main/java/com/acme/M${i}.java`,
            `package com.acme; public class M${i} { public static int v() { return ${i}; } }`);
    }

    const warned: string[] = [];
    const original = console.warn;
    console.warn = (message: unknown): void => { warned.push(String(message)); };
    try {
        const methods = staticMethodsOf(scanJavaClasses([
            path.join(root, 'mod0/src/main/java'),
            path.join(root, 'mod1/src/main/java'),
            path.join(root, 'mod2/src/main/java'),
        ], { maxFiles: 1 }));
        assert.strictEqual(methods.length, 1);
        assert.match(warned.join('\n'), /stopped after 1 files/);
    } finally {
        console.warn = original;
    }
});

test('unreadable roots do not throw', () => {
    assert.deepStrictEqual(staticMethodsOf(scanJavaClasses(['/definitely/not/here'])), []);
    assert.deepStrictEqual(staticMethodsOf(collectJavaClasses([], {})), []);
});

// ── Class/method model ──────────────────────────────────────────────────────

test('extractJavaClass records static, instance and varargs methods', () => {
    const parsed = extractJavaClass(`package com.acme;
public final class Helpers {
    public static String join(String... parts) { return ""; }
    public String instanceOnly() { return ""; }
    public static int sum(final int a, int b) { return a + b; }
}`);
    assert.ok(parsed, 'expected a public Helpers class');

    assert.strictEqual(parsed.qualifiedName, 'com.acme.Helpers');
    assert.deepStrictEqual(parsed.methods.map(method => [method.name, method.static, method.varargs]), [
        ['join', true, true],
        ['instanceOnly', false, false],
        ['sum', true, false],
    ]);

    const join = parsed.methods[0];
    assert.deepStrictEqual(join.parameters, [{ type: 'String[]', name: 'parts' }]);
    assert.deepStrictEqual(parsed.methods[2].parameters, [
        { type: 'int', name: 'a' },
        { type: 'int', name: 'b' },
    ]);
});

test('extractJavaClass returns null without a public top-level type', () => {
    assert.strictEqual(extractJavaClass('class PackagePrivate {}'), null);
    const outer = extractJavaClass('public class Outer { public class Inner {} }');
    assert.ok(outer, 'expected a public Outer class');
    assert.strictEqual(outer.className, 'Outer');
});

test('scanJavaClasses scans each file once', () => {
    const root = project();
    write(root, 'a/src/main/java/com/acme/One.java',
        'package com.acme; public class One { public static void go() {} }');
    write(root, 'b/src/main/java/com/acme/Two.java',
        'package com.acme; public class Two { public void stop() {} }');

    const classes = scanJavaClasses([
        path.join(root, 'a/src/main/java'),
        path.join(root, 'b/src/main/java'),
        path.join(root, 'a/src/main/java'),
    ]);
    assert.deepStrictEqual(classes.map(javaClass => javaClass.qualifiedName).sort(), [
        'com.acme.One',
        'com.acme.Two',
    ]);
});
