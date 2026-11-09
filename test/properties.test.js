// test/properties.test.js
// Pure tests for the Java .properties reader used by resource-bundle support.

const test   = require('node:test');
const assert = require('node:assert');

const { parseProperties } = require('../out/properties');

const SAMPLE = [
    '# a comment',
    'title = Welcome',
    'greeting: Hello',
    'plain  value with spaces',
    'multi = first \\',
    '        second',
    'escaped\\ key = a\\tb\\u0041',
    'dup=1',
    'dup=2',
    '! another comment',
].join('\n');

test('parses = , : and whitespace separators', () => {
    const entries = parseProperties(SAMPLE);
    const byKey = new Map(entries.map(entry => [entry.key, entry.value]));

    assert.strictEqual(byKey.get('title'), 'Welcome');
    assert.strictEqual(byKey.get('greeting'), 'Hello');
    assert.strictEqual(byKey.get('plain'), 'value with spaces');
});

test('ignores comments and blank lines', () => {
    const keys = parseProperties(SAMPLE).map(entry => entry.key);

    assert.ok(!keys.some(key => key.startsWith('#')));
    assert.ok(!keys.some(key => key.startsWith('!')));
    assert.ok(!keys.includes(''));
});

test('joins continuation lines and trims the continuation indent', () => {
    const entry = parseProperties(SAMPLE).find(item => item.key === 'multi');
    assert.strictEqual(entry.value, 'first second');
});

test('decodes escaped separators, tabs and unicode', () => {
    const entry = parseProperties(SAMPLE).find(item => item.key === 'escaped key');
    assert.ok(entry, 'escaped key is unescaped');
    assert.strictEqual(entry.value, 'a\tbA');
});

test('reports the key position for navigation', () => {
    const entry = parseProperties(SAMPLE).find(item => item.key === 'title');

    assert.strictEqual(entry.offset, SAMPLE.indexOf('title'));
    assert.strictEqual(entry.line, 1);
    assert.strictEqual(entry.character, 0);
});

test('keeps duplicate keys in file order so the caller can decide precedence', () => {
    const duplicates = parseProperties(SAMPLE).filter(entry => entry.key === 'dup');
    assert.deepStrictEqual(duplicates.map(entry => entry.value), ['1', '2']);
});

test('handles CRLF input without shifting offsets', () => {
    const text = 'a=1\r\nb=2\r\n';
    const entries = parseProperties(text);

    assert.deepStrictEqual(entries.map(entry => [entry.key, entry.value]), [['a', '1'], ['b', '2']]);
    assert.strictEqual(entries[1].offset, text.indexOf('b'));
    assert.strictEqual(entries[1].line, 1);
});
