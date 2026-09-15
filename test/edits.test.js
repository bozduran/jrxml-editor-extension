// test/edits.test.js

const test   = require('node:test');
const assert = require('node:assert');

const { applyEdits, findOverlap, lineAwareSpan } = require('../edits');

test('applies edits regardless of input order', () => {
    const text = 'abcdef';
    const out = applyEdits(text, [
        { start: 0, end: 1, replacement: 'A' },
        { start: 4, end: 6, replacement: 'EF' },
    ]);
    assert.strictEqual(out, 'AbcdEF');
});

test('one edit can be a pure insertion', () => {
    assert.strictEqual(applyEdits('ab', [{ start: 1, end: 1, replacement: 'X' }]), 'aXb');
});

test('one edit can be a pure deletion', () => {
    assert.strictEqual(applyEdits('abc', [{ start: 1, end: 2, replacement: '' }]), 'ac');
});

test('rejects overlapping edits', () => {
    const edits = [
        { start: 0, end: 3, replacement: 'x' },
        { start: 2, end: 4, replacement: 'y' },
    ];
    assert.ok(findOverlap(edits));
    assert.throws(() => applyEdits('abcdef', edits), /overlapping edits/);
});

test('allows adjacent (touching) edits', () => {
    const out = applyEdits('abcdef', [
        { start: 0, end: 3, replacement: 'X' },
        { start: 3, end: 6, replacement: 'Y' },
    ]);
    assert.strictEqual(out, 'XY');
    assert.strictEqual(findOverlap([
        { start: 0, end: 3 }, { start: 3, end: 6 },
    ]), null);
});

test('lineAwareSpan consumes the whole line when the span is alone', () => {
    const text = 'a\n  <x/>\nb';
    const start = text.indexOf('<x/>');
    const span = lineAwareSpan(text, start, start + 4);
    assert.strictEqual(text.slice(span.start, span.end), '  <x/>\n');
});

test('lineAwareSpan keeps the span when other content shares the line', () => {
    const text = 'a\n  <x/> <!-- keep -->\nb';
    const start = text.indexOf('<x/>');
    const span = lineAwareSpan(text, start, start + 4);
    assert.deepStrictEqual(span, { start, end: start + 4 });
});

test('lineAwareSpan handles the last line without a terminator', () => {
    const text = 'a\n  <x/>';
    const start = text.indexOf('<x/>');
    const span = lineAwareSpan(text, start, start + 4);
    assert.strictEqual(text.slice(span.start, span.end), '  <x/>');
    assert.strictEqual(span.end, text.length);
});
