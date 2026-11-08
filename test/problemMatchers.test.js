// test/problemMatchers.test.js
// The contributed problem matchers are the only thing connecting the external
// JasperReports build to the Problems panel, so their regexes are tested here.

const test   = require('node:test');
const assert = require('node:assert');

const pkg = require('../package.json');

const matchers = new Map(
    pkg.contributes.problemMatchers.map(matcher => [
        matcher.name,
        { ...matcher, regexp: new RegExp(matcher.pattern.regexp) },
    ])
);

function parse(name, line) {
    const matcher = matchers.get(name);
    assert.ok(matcher, `unknown matcher ${name}`);
    const match = matcher.regexp.exec(line);
    if (!match) return null;
    return {
        file: match[matcher.pattern.file],
        line: match[matcher.pattern.line],
        message: typeof matcher.pattern.message === 'number'
            ? match[matcher.pattern.message]
            : matcher.pattern.message,
    };
}

test('every contributed matcher has a valid regexp and is applied to all documents', () => {
    for (const matcher of matchers.values()) {
        assert.strictEqual(matcher.applyTo, 'allDocuments', matcher.name);
        assert.strictEqual(matcher.source, 'JasperReports', matcher.name);
        assert.doesNotThrow(() => new RegExp(matcher.pattern.regexp), matcher.name);
    }
});

test('parses javac-style "file:line: error" output', () => {
    const parsed = parse('jrxml-javac', '/work/reports/detail.jrxml:7: error: cannot find symbol');

    assert.deepStrictEqual(parsed, {
        file: '/work/reports/detail.jrxml',
        line: '7',
        message: 'cannot find symbol',
    });
});

test('parses Maven "[ERROR] file:line" output', () => {
    const parsed = parse('jrxml-file-line', '[ERROR] /work/reports/detail.jrxml:12: Field not found');

    assert.deepStrictEqual(parsed, {
        file: '/work/reports/detail.jrxml',
        line: '12',
        message: 'Field not found',
    });
});

test('parses JasperReports "ERROR in file (at line N)" output', () => {
    const parsed = parse('jrxml-compile', '1. ERROR in /work/reports/detail.jrxml (at line 3)');

    assert.deepStrictEqual(parsed, {
        file: '/work/reports/detail.jrxml',
        line: '3',
        message: 'JasperReports compile error',
    });
});

test('ignores lines that do not point at a .jrxml file', () => {
    assert.strictEqual(parse('jrxml-javac', 'BUILD FAILURE'), null);
    assert.strictEqual(parse('jrxml-file-line', '[ERROR] Something else'), null);
    assert.strictEqual(parse('jrxml-compile', '2 errors'), null);
});
