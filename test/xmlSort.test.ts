// test/xmlSort.test.js

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    discoverSortFix,
    parse,
    sortedChildren,
    overlaps,
} from '../out/xmlSort.js';
import type { ParsedSort, SortFix } from '../out/xmlSort.js';
import { TEST_DIR } from './support.ts';

function fixture(): string {
    return fs.readFileSync(path.join(TEST_DIR, 'fixtures', 'SortEdgeReport.jrxml'), 'utf8');
}

function band(inner: string): string {
    return `<jasperReport name="R">\n  <detail>\n    <band height="200">\n${inner}\n    </band>\n  </detail>\n</jasperReport>`;
}

/** A fix is expected in every test that dereferences one. */
function requiredSortFix(text: string): SortFix {
    const fix = discoverSortFix(text);
    assert.ok(fix, 'expected a sort fix');
    return fix;
}

/** The fixtures are well-formed, so parsing must succeed. */
function parsedSort(text: string): ParsedSort {
    const parsed = parse(text);
    assert.ok(parsed, 'expected parsable XML');
    return parsed;
}

test('sorts by y then x, stably', () => {
    const children = [
        { kind: 'a', x: 5, y: 10 },
        { kind: 'b', x: 0, y: 0 },
        { kind: 'c', x: 0, y: 10 },
    ];
    assert.deepStrictEqual(sortedChildren(children).map(c => c.kind), ['b', 'c', 'a']);
});

test('returns null when nothing needs reordering', () => {
    const text = band('      <element kind="a" x="0" y="0" width="1" height="1"/>\n      <element kind="b" x="0" y="1" width="1" height="1"/>');
    assert.strictEqual(discoverSortFix(text), null);
});

test('ignores non-element direct children', () => {
    const text = band([
        '      <property name="p" value="v"/>',
        '      <component kind="c" x="0" y="99"/>',
        '      <element kind="a" x="0" y="10" width="1" height="1"/>',
        '      <element kind="b" x="0" y="0" width="1" height="1"/>',
    ].join('\n'));

    const parsed = parsedSort(text);
    const containers = parsed.containers.filter(c => c.kind === 'band');
    assert.deepStrictEqual(containers[0].children.map(c => c.kind), ['a', 'b']);

    const applied = requiredSortFix(text).edit.replacement;
    assert.ok(applied.indexOf('<property name="p"') < applied.indexOf('<component kind="c"'));
    assert.ok(applied.indexOf('<component kind="c"') < applied.indexOf('kind="b"'));
});

test('missing or non-numeric coordinates warn and count as zero', () => {
    const text = band([
        '      <element kind="a" x="0" y="5" width="1" height="1"/>',
        '      <element kind="b" x="0" width="1" height="1"/>',
    ].join('\n'));

    const fix = requiredSortFix(text);
    assert.match(fix.description, /warning: missing or non-numeric y on b \(line 5\)/);
    // b now sorts first because its missing y is treated as 0
    assert.ok(fix.edit.replacement.indexOf('kind="b"') < fix.edit.replacement.indexOf('kind="a"'));
});

test('detects overlapping rectangles in the original order', () => {
    const text = band([
        '      <element kind="a" x="0" y="5" width="10" height="10"/>',
        '      <element kind="b" x="0" y="0" width="10" height="10"/>',
    ].join('\n'));

    const fix = requiredSortFix(text);
    assert.match(fix.description, /warning: overlap a\(0,5\) <-> b\(0,0\)/);

    const bandContainer = parsedSort(text).containers.find(c => c.kind === 'band');
    assert.ok(bandContainer, 'expected a band container');
    const children = bandContainer.children;
    assert.strictEqual(overlaps(children).length, 1);
});

test('trivia moves with its element', () => {
    const text = band([
        '      <element kind="a" x="0" y="10" width="1" height="1"/>',
        '      <!-- belongs to b -->',
        '      <property name="pb" value="1"/>',
        '      <element kind="b" x="0" y="0" width="1" height="1"/>',
    ].join('\n'));

    const applied = requiredSortFix(text).edit.replacement;
    const comment = applied.indexOf('<!-- belongs to b -->');
    const b = applied.indexOf('kind="b"');
    const a = applied.indexOf('kind="a"');
    const property = applied.indexOf('<property name="pb"');

    assert.ok(comment < b && property < b, 'comment/property stay immediately before b');
    assert.ok(b < a, 'b sorts first');
});

test('the first element keeps a separator when it moves last', () => {
    const text = band([
        '      <element kind="a" x="0" y="10" width="1" height="1"/>',
        '      <element kind="b" x="0" y="0" width="1" height="1"/>',
    ].join('\n'));

    const applied = requiredSortFix(text).edit.replacement;
    const bIdx = applied.indexOf('kind="b"');
    const aIdx = applied.indexOf('kind="a"');

    assert.ok(bIdx !== -1 && aIdx !== -1 && bIdx < aIdx, 'b sorts first');
    assert.ok(applied.slice(bIdx, aIdx).includes('\n'), 'elements are not glued together');
});

test('reorders nested frames independently', () => {
    const text = band([
        '      <element kind="frame" x="0" y="0" width="10" height="10">',
        '        <element kind="a" x="0" y="5" width="1" height="1"/>',
        '        <element kind="b" x="0" y="0" width="1" height="1"/>',
        '      </element>',
    ].join('\n'));

    const applied = requiredSortFix(text).edit.replacement;
    assert.ok(applied.indexOf('kind="b"') < applied.indexOf('kind="a"'));
});

test('sorting is idempotent', () => {
    for (const text of [fixture(), band('      <element kind="a" x="0" y="10" width="1" height="1"/>\n      <element kind="b" x="0" y="0" width="1" height="1"/>')]) {
        const once = requiredSortFix(text).edit.replacement;
        assert.strictEqual(discoverSortFix(once), null);
    }
});

test('golden: SortEdgeReport description matches the hook', () => {
    const fix = requiredSortFix(fixture());
    assert.strictEqual(fix.description, [
        'reorder [textField(0,40), image(0,10), frame(0,60)] -> [image(0,10), textField(0,40), frame(0,60)]',
        'reorder [textField(0,30), image(0,0)] -> [image(0,0), textField(0,30)]',
    ].join('\n'));
});

test('golden: SortEdgeReport reorder keeps trivia attached', () => {
    const applied = requiredSortFix(fixture()).edit.replacement;

    const comment = applied.indexOf('<!-- belongs to the early image -->');
    const property = applied.indexOf('<property name="com.example.belongs-to-a"');
    const image = applied.indexOf('kind="image" uuid="dddddddd-0000-0000-0000-000000000003"');
    const textField = applied.indexOf('kind="textField" uuid="dddddddd-0000-0000-0000-000000000002"');

    assert.ok(comment !== -1 && property !== -1 && image !== -1 && textField !== -1);
    assert.ok(comment < property && property < image, 'comment and property stay with the image');
    assert.ok(image < textField, 'image sorts before the textField');
});

test('malformed XML yields no fix', () => {
    assert.strictEqual(discoverSortFix('<r><a></b></r>'), null);
});
