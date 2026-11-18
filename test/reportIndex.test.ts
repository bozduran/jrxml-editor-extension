// test/reportIndex.test.js
// Candidate 01: one report index answers "what is declared here, what is
// referenced here, and what uses it?". The sortField test is the navigation
// fix that used to be impossible because attribute references had no span.

import test from 'node:test';
import assert from 'node:assert';

import { parseDeclarations } from '../out/jrxmlParser.js';
import { reportIndex, usageNames } from '../out/reportIndex.js';
import { resolveSymbol, occurrences } from '../out/reportSymbols.js';
import { collectUsedNames } from '../out/xmlClear.js';
import { scanXml } from '../out/xmlspan.js';
import type { ParseResult } from '../out/jrxmlParser.js';
import type { ResolveAt } from '../out/reportIndex.js';

let seq = 0;
function parse(text: string): ParseResult {
    return parseDeclarations({
        uri: { toString: () => `test://index-${seq++}` },
        version: 1,
        getText: () => text,
    });
}

const TEXT = `<jasperReport name="R">
  <field name="total" class="java.lang.Double"/>
  <sortField name="total" type="Field"/>
  <detail><band height="20"><textField>
    <reportElement x="0" y="0" width="10" height="10"/>
    <textFieldExpression><![CDATA[$F{total}]]></textFieldExpression>
  </textField></band></detail>
</jasperReport>`;

/** Cursor-at semantics: an offset plus the source line and column. */
function atOffset(text: string, offset: number): ResolveAt {
    const lineStart = text.lastIndexOf('\n', offset) + 1;
    const lineEnd = text.indexOf('\n', offset);
    return {
        offset,
        lineText: text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd),
        character: offset - lineStart,
    };
}

function at(text: string, needle: string, delta = 0): ResolveAt {
    return atOffset(text, text.indexOf(needle) + delta);
}

/** The sortField name attribute, not the field declaration of the same name. */
function atSortField(text: string): ResolveAt {
    const start = text.indexOf('<sortField');
    return atOffset(text, text.indexOf('name="total"', start) + 'name="'.length);
}

test('the index is built once per parse result', () => {
    const parsed = parse(TEXT);
    assert.strictEqual(reportIndex(parsed), reportIndex(parsed));
});

test('a sortField name resolves to its field declaration', () => {
    const parsed = parse(TEXT);
    const symbol = resolveSymbol(parsed, atSortField(TEXT));

    assert.ok(symbol, 'expected a resolved symbol');
    assert.strictEqual(symbol.origin, 'reference');
    assert.strictEqual(symbol.kind, 'field');
    assert.ok(symbol.declaration, 'a resolved field reference must carry its declaration');
    assert.strictEqual(symbol.declaration.name, 'total');
    assert.strictEqual(symbol.token.name, 'total');
});

test('occurrences include the token and the sortField reference', () => {
    const parsed = parse(TEXT);
    const symbol = resolveSymbol(parsed, at(TEXT, '$F{total}', '$F{'.length));
    const refs = occurrences(parsed, symbol);

    assert.strictEqual(refs.length, 2);
    const spans = refs.map(ref => TEXT.slice(ref.offset, ref.end)).sort();
    assert.deepStrictEqual(spans, ['$F{total}', 'total']);
});

test('the usage set and the index agree, and exclude resource keys', () => {
    const text = TEXT.replace(
        '<textFieldExpression>',
        '<textFieldExpression><![CDATA[$R{key with space}]]></textFieldExpression><textFieldExpression>',
    );
    const parsed = parse(text);
    const scan = scanXml(text);
    const used = collectUsedNames(text);
    const usage = usageNames(scan);
    const index = reportIndex(parsed);

    assert.ok(used, 'the document must be scannable');
    assert.ok(usage, 'a scanned document must expose its usage names');
    assert.ok(index, 'the parse result must own an index');
    assert.ok(used.has('FIELD:total'));
    assert.ok(!used.has('FIELD:key with space'));
    assert.ok(usage.has('FIELD:total'));
    assert.deepStrictEqual([...used].sort(), [...usage].sort());
    assert.deepStrictEqual(
        index.resourceReferences.map(ref => ref.name),
        ['key with space'],
    );
});

test('a declaration-name cursor keeps origin "declaration"', () => {
    const parsed = parse(TEXT);
    const index = reportIndex(parsed);
    assert.ok(index, 'the parse result must own an index');
    const symbol = index.symbolAt(atSortField(TEXT));

    assert.ok(symbol);
    // The declaration also appears in the sortField; the cursor is inside a
    // declaration only when it is the first one, so resolve from the field.
    const field = index.symbolAt(at(TEXT, '<field name="total"', '<field name="'.length));
    assert.strictEqual(field && field.origin, 'declaration');
    assert.strictEqual(field && field.kind, 'field');
});
