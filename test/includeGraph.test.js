// test/includeGraph.test.js

const test   = require('node:test');
const assert = require('node:assert');

const {
    buildIndex,
    buildTree,
    referencersOf,
    topsFor,
    baseName,
    quotedTokens,
} = require('../includeGraph');

function index(entries) {
    return buildIndex(Object.entries(entries).map(([path, text]) => ({ path, text })));
}

const PROJECT = {
    'reports/MasterReport.jrxml':   '<x>"ProductReport" "DetailReport" "SidebarReport"</x>',
    'reports/ProductReport.jrxml':  '<x>"DetailReport"</x>',
    'reports/DetailReport.jrxml':   '<x>nothing</x>',
    'reports/SidebarReport.jrxml':  '<x>nothing</x>',
};

// ── primitives ────────────────────────────────────────────────────────────────

test('baseName strips the folder and extension', () => {
    assert.strictEqual(baseName('reports/MasterReport.jrxml'), 'MasterReport');
    assert.strictEqual(baseName('C:\\reports\\Master.jrxml'), 'Master');
    assert.strictEqual(baseName('noext'), 'noext');
});

test('quotedTokens collects distinct non-empty tokens', () => {
    assert.deepStrictEqual([...quotedTokens('a "one" b "two" "one" ""')], ['one', 'two']);
});

// ── the graph ─────────────────────────────────────────────────────────────────

test('builds caller/callee edges by base name and ignores self-references', () => {
    const graph = index({
        'a/Self.jrxml': 'x "Self" y',
        'a/Other.jrxml': 'x "Self" y',
    });

    assert.deepStrictEqual([...graph.callees.get('a/Self.jrxml')], []);
    assert.deepStrictEqual([...graph.callees.get('a/Other.jrxml')], ['a/Self.jrxml']);
    assert.deepStrictEqual([...graph.callers.get('a/Self.jrxml')], ['a/Other.jrxml']);
});

test('every file sharing a base name becomes a target', () => {
    const graph = index({
        'a/Dup.jrxml': 'x',
        'one/Dup.jrxml': 'x',
        'two/Dup.jrxml': 'x',
        'caller.jrxml': '"Dup"',
    });

    assert.deepStrictEqual([...graph.callees.get('caller.jrxml')].sort(),
        ['a/Dup.jrxml', 'one/Dup.jrxml', 'two/Dup.jrxml']);
});

test('referencersOf walks upward transitively', () => {
    const graph = index(PROJECT);
    assert.deepStrictEqual([...referencersOf(graph, 'reports/DetailReport.jrxml')].sort(),
        ['reports/MasterReport.jrxml', 'reports/ProductReport.jrxml']);
    assert.deepStrictEqual([...referencersOf(graph, 'reports/SidebarReport.jrxml')],
        ['reports/MasterReport.jrxml']);
    assert.deepStrictEqual([...referencersOf(graph, 'reports/MasterReport.jrxml')], []);
});

test('topsFor finds the caller-free top templates', () => {
    const graph = index(PROJECT);
    assert.deepStrictEqual(topsFor(graph, 'reports/DetailReport.jrxml'),
        ['reports/MasterReport.jrxml']);
    assert.deepStrictEqual(topsFor(graph, 'reports/DetailReport.jrxml').length, 1);
});

// ── the tree ──────────────────────────────────────────────────────────────────

test('buildTree renders top-down, pruned to branches that reach the target', () => {
    const graph = index(PROJECT);
    const tree = buildTree(graph, 'reports/DetailReport.jrxml');

    assert.strictEqual(tree.length, 1);
    assert.strictEqual(tree[0].path, 'reports/MasterReport.jrxml');
    assert.strictEqual(tree[0].current, false);

    // Children are sorted by path, and SidebarReport is pruned away.
    assert.deepStrictEqual(tree[0].children.map(child => child.path), [
        'reports/DetailReport.jrxml',
        'reports/ProductReport.jrxml',
    ]);
    assert.strictEqual(tree[0].children[0].current, true);
    assert.deepStrictEqual(tree[0].children[0].children, []);
    assert.deepStrictEqual(tree[0].children[1].children.map(child => child.path),
        ['reports/DetailReport.jrxml']);
});

test('buildTree returns nothing for a file outside the index', () => {
    const graph = index(PROJECT);
    assert.deepStrictEqual(buildTree(graph, 'reports/Unknown.jrxml'), []);
});

test('a cycle makes the target its own top and is cut', () => {
    const graph = index({
        'A.jrxml': '"B"',
        'B.jrxml': '"A"',
    });

    const affected = referencersOf(graph, 'B.jrxml');
    assert.deepStrictEqual([...affected], ['A.jrxml']);
    assert.deepStrictEqual(topsFor(graph, 'B.jrxml'), ['B.jrxml']);

    const tree = buildTree(graph, 'B.jrxml');
    assert.strictEqual(tree.length, 1);
    assert.strictEqual(tree[0].current, true);
    assert.deepStrictEqual(tree[0].children, []);
});

test('multiple top templates each get their own root', () => {
    const graph = index({
        'One.jrxml': '"Shared"',
        'Two.jrxml': '"Shared"',
        'Shared.jrxml': 'x',
    });

    const tree = buildTree(graph, 'Shared.jrxml');
    assert.deepStrictEqual(tree.map(node => node.path), ['One.jrxml', 'Two.jrxml']);
});

test('a self-including file is shown as not referenced by anything else', () => {
    const graph = index({ 'Only.jrxml': '"Only"' });
    const tree = buildTree(graph, 'Only.jrxml');

    assert.strictEqual(tree.length, 1);
    assert.strictEqual(tree[0].current, true);
    assert.deepStrictEqual(tree[0].children, []);
});
