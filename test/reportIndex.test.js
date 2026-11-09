// test/reportIndex.test.js
// Candidate 01: one report index answers "what is declared here, what is
// referenced here, and what uses it?". The sortField test is the navigation
// fix that used to be impossible because attribute references had no span.

const test   = require('node:test');
const assert = require('node:assert');

const { parseDeclarations } = require('../out/jrxmlParser');
const { reportIndex, usageNames } = require('../out/reportIndex');
const { resolveSymbol, occurrences } = require('../out/reportSymbols');
const { collectUsedNames } = require('../out/xmlClear');
const { scanXml } = require('../out/xmlspan');

let seq = 0;
function parse(text) {
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
function atOffset(text, offset) {
    const lineStart = text.lastIndexOf('\n', offset) + 1;
    const lineEnd = text.indexOf('\n', offset);
    return {
        offset,
        lineText: text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd),
        character: offset - lineStart,
    };
}

function at(text, needle, delta = 0) {
    return atOffset(text, text.indexOf(needle) + delta);
}

/** The sortField name attribute, not the field declaration of the same name. */
function atSortField(text) {
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

    assert.ok(used.has('FIELD:total'));
    assert.ok(!used.has('FIELD:key with space'));
    assert.ok(usageNames(scan).has('FIELD:total'));
    assert.deepStrictEqual([...used].sort(), [...usageNames(scan)].sort());
    assert.deepStrictEqual(
        reportIndex(parsed).resourceReferences.map(ref => ref.name),
        ['key with space'],
    );
});

test('a declaration-name cursor keeps origin "declaration"', () => {
    const parsed = parse(TEXT);
    const symbol = reportIndex(parsed).symbolAt(atSortField(TEXT));

    assert.ok(symbol);
    // The declaration also appears in the sortField; the cursor is inside a
    // declaration only when it is the first one, so resolve from the field.
    const field = reportIndex(parsed).symbolAt(at(TEXT, '<field name="total"', '<field name="'.length));
    assert.strictEqual(field && field.origin, 'declaration');
    assert.strictEqual(field && field.kind, 'field');
});
