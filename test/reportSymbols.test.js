// test/reportSymbols.test.js
// The vscode-free resolution seam shared by hover, definition, references and
// completion. No TextDocument and no vscode module: a parse result plus an
// offset in, one symbol record out.

const test   = require('node:test');
const assert = require('node:assert');

const { parseDeclarations } = require('../out/jrxmlParser');
const { resolveSymbol, occurrences, visibleDeclarations, declaredNames, declarationInAnyScope } = require('../out/reportSymbols');

let seq = 0;
function parse(text) {
    return parseDeclarations({
        uri: { toString: () => `test://symbols-${seq++}` },
        version: 1,
        getText: () => text,
    });
}

/** The offset, line text and column of the first occurrence of `needle`. */
function locate(text, needle, delta = 3) {
    const start = text.indexOf(needle);
    assert.ok(start >= 0, `missing ${needle} in fixture`);
    const offset = start + delta;
    const lineStart = text.lastIndexOf('\n', offset) + 1;
    const lineEnd = text.indexOf('\n', offset);
    return {
        offset,
        lineText: text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd),
        character: offset - lineStart,
    };
}

function resolve(text, needle, delta) {
    const parsed = parse(text);
    return resolveSymbol(parsed, locate(text, needle, delta));
}

test('resolves a report field reference to its declaration and report scope', () => {
    const text = `<jasperReport name="R">
  <field name="shared" class="java.lang.String"/>
  <detail><band height="20"><textField><reportElement x="0" y="0" width="10" height="10"/><textFieldExpression><![CDATA[$F{shared}]]></textFieldExpression></textField></band></detail>
</jasperReport>`;

    const symbol = resolve(text, '$F{shared}');

    assert.ok(symbol, 'expected a resolved symbol');
    assert.strictEqual(symbol.origin, 'reference');
    assert.strictEqual(symbol.kind, 'field');
    assert.strictEqual(symbol.token.sigil, 'F');
    assert.strictEqual(symbol.token.name, 'shared');
    assert.strictEqual(symbol.declaration.fullType, 'java.lang.String');
    assert.strictEqual(symbol.scope.kind, 'report');
    assert.strictEqual(symbol.builtin, false);
    assert.strictEqual(symbol.outOfScope, false);
});

test('falls back to a built-in parameter when the report does not declare it', () => {
    const text = `<jasperReport name="R">
  <detail><band height="20"><textField><reportElement x="0" y="0" width="10" height="10"/><textFieldExpression><![CDATA[$P{REPORT_LOCALE}]]></textFieldExpression></textField></band></detail>
</jasperReport>`;

    const symbol = resolve(text, '$P{REPORT_LOCALE}');

    assert.ok(symbol);
    assert.strictEqual(symbol.kind, 'parameter');
    assert.strictEqual(symbol.builtin, true);
    assert.strictEqual(symbol.declaration.name, 'REPORT_LOCALE');
    assert.strictEqual(symbol.declaration.type, 'java.util.Locale');
});

test('resolves a dataset declaration when report and dataset names collide', () => {
    const text = `<jasperReport name="R">
  <field name="shared" class="java.lang.String"/>
  <dataset name="DS">
    <field name="shared" class="java.lang.Integer"/>
    <filterExpression><![CDATA[$F{shared}]]></filterExpression>
  </dataset>
</jasperReport>`;

    const symbol = resolve(text, '$F{shared}]]>', 3);

    assert.strictEqual(symbol.scope.kind, 'dataset');
    assert.strictEqual(symbol.scope.datasetName, 'DS');
    assert.strictEqual(symbol.declaration.fullType, 'java.lang.Integer');
});

test('marks a report declaration used inside a dataset as out of scope', () => {
    const text = `<jasperReport name="R">
  <field name="MasterField" class="java.lang.String"/>
  <dataset name="DS">
    <field name="DSField" class="java.lang.Integer"/>
    <filterExpression><![CDATA[$F{MasterField}]]></filterExpression>
  </dataset>
</jasperReport>`;

    const symbol = resolve(text, '$F{MasterField}]]>', 3);

    assert.strictEqual(symbol.scope.kind, 'dataset');
    assert.strictEqual(symbol.declaration, null);
    assert.strictEqual(symbol.outOfScope, true);
    assert.strictEqual(symbol.reportDeclaration.fullType, 'java.lang.String');
});

test('resolves a cursor on a declaration name from the declaration side', () => {
    const text = `<jasperReport name="R">
  <field name="shared" class="java.lang.String"/>
</jasperReport>`;

    const symbol = resolve(text, 'name="shared"', 7);

    assert.strictEqual(symbol.origin, 'declaration');
    assert.strictEqual(symbol.kind, 'field');
    assert.strictEqual(symbol.token.name, 'shared');
    assert.strictEqual(symbol.declaration.fullType, 'java.lang.String');
    assert.strictEqual(symbol.scope.kind, 'report');
});

test('occurrences keep same-named references from another scope out', () => {
    const text = `<jasperReport name="R">
  <field name="amount" class="java.math.BigDecimal"/>
  <dataset name="DS">
    <field name="amount" class="java.lang.Integer"/>
    <filterExpression><![CDATA[$F{amount}]]></filterExpression>
  </dataset>
  <detail><band height="20">
    <textField><reportElement x="0" y="0" width="10" height="10"/><textFieldExpression><![CDATA[$F{amount}]]></textFieldExpression></textField>
    <textField><reportElement x="0" y="20" width="10" height="10"/><textFieldExpression><![CDATA[$F{amount} + 1]]></textFieldExpression></textField>
  </band></detail>
</jasperReport>`;

    const parsed = parse(text);
    const symbol = resolveSymbol(parsed, locate(text, '$F{amount} + 1', 3));
    const found = occurrences(parsed, symbol);

    const all = [...text.matchAll(/\$F\{amount\}/g)].map(match => match.index);
    assert.deepStrictEqual(found.map(item => item.offset), all.slice(1));
});

test('visibleDeclarations follows the declaration scope at the offset', () => {
    const text = `<jasperReport name="R">
  <field name="MainField" class="java.lang.String"/>
  <dataset name="DS">
    <field name="DSField" class="java.lang.Integer"/>
    <filterExpression><![CDATA[]]></filterExpression>
  </dataset>
  <detail><band height="20"><textField><reportElement x="0" y="0" width="10" height="10"/><textFieldExpression><![CDATA[$F{MainField}]]></textFieldExpression></textField></band></detail>
</jasperReport>`;
    const parsed = parse(text);

    const report = visibleDeclarations(parsed, text.indexOf('$F{MainField}'));
    const dataset = visibleDeclarations(parsed, text.indexOf('<field name="DSField"'));

    assert.strictEqual(report.kind, 'report');
    assert.deepStrictEqual(report.fields.map(field => field.name), ['MainField']);
    assert.strictEqual(dataset.kind, 'dataset');
    assert.deepStrictEqual(dataset.fields.map(field => field.name), ['DSField']);
});

test('declaredNames includes built-ins and excludes report fields inside a dataset', () => {
    const text = `<jasperReport name="R">
  <field name="MainField" class="java.lang.String"/>
  <dataset name="DS"><field name="DSField" class="java.lang.Integer"/></dataset>
</jasperReport>`;
    const parsed = parse(text);
    const dataset = visibleDeclarations(parsed, text.indexOf('<field name="DSField"'));

    assert.deepStrictEqual([...declaredNames(dataset, 'F')], ['DSField']);
    assert.ok(declaredNames(dataset, 'P').has('REPORT_LOCALE'));
    assert.ok(declaredNames(dataset, 'V').has('PAGE_NUMBER'));
});

test('declarationInAnyScope is the unknown-scope fallback for a same-named report declaration', () => {
    const text = `<jasperReport name="R">
  <field name="MainField" class="java.lang.String"/>
  <detail><band><element kind="component"><component kind="list">
    <datasetRun subDataset="External"/>
    <contents><element kind="textField"><expression><![CDATA[$F{MainField}]]></expression></element></contents>
  </component></element></band></detail>
</jasperReport>`;

    const parsed = parse(text);
    const symbol = resolveSymbol(parsed, locate(text, '$F{MainField}', 3));

    assert.strictEqual(symbol.scope.kind, 'unknown');
    assert.strictEqual(symbol.declaration, null);
    assert.strictEqual(declarationInAnyScope(parsed, symbol.token).fullType, 'java.lang.String');
});

test('resolves and finds occurrences for a declaration name containing a dash', () => {
    const text = `<jasperReport name="R">
  <field name="my-field" class="java.lang.String"/>
  <detail><band height="20"><textField><reportElement x="0" y="0" width="10" height="10"/><textFieldExpression><![CDATA[$F{my-field}]]></textFieldExpression></textField></band></detail>
</jasperReport>`;

    const parsed = parse(text);
    const symbol = resolveSymbol(parsed, locate(text, '$F{my-field}', 3));

    assert.strictEqual(symbol.declaration.name, 'my-field');
    assert.deepStrictEqual(occurrences(parsed, symbol).map(item => item.name), ['my-field']);
});
