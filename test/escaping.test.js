// test/escaping.test.js
// Unit tests for the shared escaping helpers.
//
// Each helper has to escape the escape character before the character it
// protects. CodeQL's "incomplete string escaping or encoding" query flagged the
// earlier single-character versions (`x.replace(/`/g, '\\`')` and
// `key.replace(/\$/g, '\\$')`), and the cases below are the ones that were
// wrong: a value whose last character is a backslash, and a backslash directly
// before the character being escaped.

const test   = require('node:test');
const assert = require('node:assert');

const {
    escapeRegExp,
    escapeMarkdownCode,
    escapeSnippet,
} = require('../out/escaping');

// ── Regular expressions ─────────────────────────────────────────────────────

test('escapeRegExp escapes every RegExp metacharacter', () => {
    assert.strictEqual(escapeRegExp('a.b*c?'), 'a\\.b\\*c\\?');
    assert.strictEqual(escapeRegExp('$F{x}(y)|z'), '\\$F\\{x\\}\\(y\\)\\|z');
    assert.strictEqual(escapeRegExp('a\\\\b'), 'a\\\\\\\\b');
    assert.strictEqual(escapeRegExp('plain'), 'plain');
    assert.strictEqual(escapeRegExp(''), '');
});

test('escapeRegExp output matches the literal text only', () => {
    const literal = 'value $F{total} is (1 + 2)';
    const source = new RegExp(`^${escapeRegExp(literal)}$`);
    assert.ok(source.test(literal));
    assert.ok(!source.test('value $F{total} is 1 2'));
});

// ── Markdown code spans ─────────────────────────────────────────────────────

test('escapeMarkdownCode escapes the backslash before the backtick', () => {
    assert.strictEqual(escapeMarkdownCode('plain'), 'plain');
    assert.strictEqual(escapeMarkdownCode('a`b'), 'a\\`b');
    assert.strictEqual(escapeMarkdownCode('a\\b'), 'a\\\\b');

    // A value ending in a backslash must not swallow the escape of the
    // backtick that follows it.
    assert.strictEqual(escapeMarkdownCode('a\\`b'), 'a\\\\\\`b');
});

// ── Editor snippets ─────────────────────────────────────────────────────────

test('escapeSnippet escapes the backslash before the dollar', () => {
    assert.strictEqual(escapeSnippet('title'), 'title');
    assert.strictEqual(escapeSnippet('$F{x}'), '\\$F{x}');
    assert.strictEqual(escapeSnippet('a\\b'), 'a\\\\b');

    // Same order requirement as above: one literal backslash plus one dollar
    // has to become three backslashes then the dollar.
    assert.strictEqual(escapeSnippet('a\\$b'), 'a\\\\\\$b');
});
