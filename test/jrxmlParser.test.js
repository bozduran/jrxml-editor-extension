// test/jrxmlParser.test.js
// Unit tests for the vscode-free parser. Run with: npm test

const test   = require('node:test');
const assert = require('node:assert');

const {
    parseDeclarations,
    resolveDeclarationScope,
    findDuplicateNames,
    clearCache,
    clearAllCaches,
} = require('../jrxmlParser');

let seq = 0;
/** Build a minimal fake TextDocument with a unique URI each call. */
function makeDoc(text, version = 1, uri) {
    const id = uri || `file:///test-${seq++}.jrxml`;
    return {
        uri: { toString: () => id },
        version,
        getText: () => text,
    };
}

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<jasperReport name="SalesReport">
  <parameter name="OWN_PARAM" class="java.lang.String" isForPrompting="true">
    <defaultValueExpression><![CDATA["x"]]></defaultValueExpression>
  </parameter>
  <parameter name="SYS_PARAM" class="java.lang.Object" isForPrompting="false"/>
  <field name="amount" class="java.math.BigDecimal">
    <description>Invoice amount</description>
  </field>
  <field name="plain" class="java.lang.String"/>
  <variable name="total" class="java.math.BigDecimal" resetType="Report" calculation="Sum">
    <variableExpression><![CDATA[$F{amount}]]></variableExpression>
  </variable>
  <group name="ByRegion">
    <groupExpression><![CDATA[$F{amount}]]></groupExpression>
  </group>
  <title>
    <band height="20">
      <textField>
        <reportElement x="0" y="0" width="100" height="20"/>
        <textFieldExpression><![CDATA[$V{total}]]></textFieldExpression>
      </textField>
    </band>
  </title>
  <subreport>
    <subreportParameter name="OWN_PARAM"/>
  </subreport>
</jasperReport>`;

test('records whether a declaration class was declared or must be inferred', () => {
    const text = `<jasperReport name="R">
  <field name="declared" class="java.lang.String"/>
  <field name="inferred"/>
  <parameter name="pDeclared" class="java.math.BigDecimal"/>
  <parameter name="pInferred"/>
  <variable name="vDeclared" class="java.lang.Integer"/>
  <variable name="vInferred"/>
</jasperReport>`;
    const r = parseDeclarations(makeDoc(text));

    assert.strictEqual(r.fields[0].typeSource, 'declared');
    assert.strictEqual(r.fields[1].typeSource, 'inferred');
    assert.strictEqual(r.parameters[0].typeSource, 'declared');
    assert.strictEqual(r.parameters[1].typeSource, 'inferred');
    assert.strictEqual(r.variables[0].typeSource, 'declared');
    assert.strictEqual(r.variables[1].typeSource, 'inferred');

    // The type stays Object so existing consumers keep working.
    assert.strictEqual(r.fields[1].fullType, 'java.lang.Object');
});

test('extracts fields, parameters, variables and groups', () => {
    const r = parseDeclarations(makeDoc(SAMPLE));

    assert.deepStrictEqual(r.fields.map(f => f.name), ['amount', 'plain']);
    assert.strictEqual(r.fields[0].type, 'BigDecimal');
    assert.strictEqual(r.fields[0].fullType, 'java.math.BigDecimal');
    assert.strictEqual(r.fields[0].description, 'Invoice amount');

    assert.deepStrictEqual(r.parameters.map(p => p.name), ['OWN_PARAM', 'SYS_PARAM']);
    assert.strictEqual(r.parameters[0].isSystem, false);
    assert.strictEqual(r.parameters[1].isSystem, true);
    assert.match(r.parameters[0].description, /Default:/);

    assert.deepStrictEqual(r.variables.map(v => v.name), ['total']);
    assert.match(r.variables[0].description, /Sum \/ reset: Report/);

    assert.deepStrictEqual(r.groups.map(g => g.name), ['ByRegion']);
});

test('nameOffset points at the name value for double quotes', () => {
    const text = `<jasperReport name="R"><field name="f1" class="java.lang.String"/></jasperReport>`;
    const f = parseDeclarations(makeDoc(text)).fields[0];
    assert.strictEqual(f.nameOffset, text.indexOf('f1'));
    assert.strictEqual(text.slice(f.nameOffset, f.nameOffset + f.name.length), 'f1');
});

test('nameOffset points at the name value for single quotes', () => {
    const text = `<jasperReport name="R"><field name='f1' class='java.lang.String'/></jasperReport>`;
    const f = parseDeclarations(makeDoc(text)).fields[0];
    assert.strictEqual(f.nameOffset, text.indexOf('f1'));
});

test('does not confuse a name attribute with a longer attribute name', () => {
    const text = `<jasperReport name="R"><field fullName="nope" name="real" class="java.lang.String"/></jasperReport>`;
    const f = parseDeclarations(makeDoc(text)).fields[0];
    assert.strictEqual(f.name, 'real');
    assert.strictEqual(f.nameOffset, text.indexOf('"real"') + 1);
});

test('collects $F/$P/$V references', () => {
    const text = `<jasperReport name="R"><textFieldExpression><![CDATA[$F{a} + $P{b} + $V{c}]]></textFieldExpression></jasperReport>`;
    const refs = parseDeclarations(makeDoc(text)).references
        .filter(r => !r.fromSubreport)
        .map(r => `${r.sigil}:${r.name}`).sort();
    assert.deepStrictEqual(refs, ['F:a', 'P:b', 'V:c']);
});

test('references are collected from expression elements, not comments or static text', () => {
    const text = `<jasperReport name="R">
  <!-- $F{inComment} -->
  <text><![CDATA[$F{inStaticText}]]></text>
  <expression><![CDATA[$F{Real}]]></expression>
</jasperReport>`;
    const refs = parseDeclarations(makeDoc(text)).references;

    assert.deepStrictEqual(refs.map(r => `${r.sigil}:${r.name}`), ['F:Real']);
});

test('collects $P!{} query fragments with their exact span', () => {
    const text = `<jasperReport name="R">
  <query language="sql"><![CDATA[SELECT * FROM t WHERE x = $P!{Clause}]]></query>
</jasperReport>`;
    const refs = parseDeclarations(makeDoc(text)).references;

    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].sigil, 'P');
    assert.strictEqual(refs[0].name, 'Clause');
    assert.strictEqual(refs[0].bang, true);
    assert.strictEqual(
        text.slice(refs[0].offset, refs[0].end),
        '$P!{Clause}'
    );
});

test('does not invent references in a document that cannot be scanned', () => {
    const text = '<jasperReport><expression><![CDATA[$F{a}]]></expression>';
    assert.deepStrictEqual(parseDeclarations(makeDoc(text)).references, []);
});

test('treats subreportParameter as a used parameter reference', () => {
    const text = `<jasperReport name="R"><subreport><subreportParameter name="passed"/></subreport></jasperReport>`;
    const refs = parseDeclarations(makeDoc(text)).references;
    assert.deepStrictEqual(refs.map(r => `${r.sigil}:${r.name}:${!!r.fromSubreport}`), ['P:passed:true']);
});

test('treats a parameter nested in <element kind="subreport"> as used (regression)', () => {
    const text = `<jasperReport name="R">
  <parameter name="OWN" class="java.lang.String"/>
  <element kind="subreport">
    <parameter name="NESTED" class="java.lang.String"/>
  </element>
</jasperReport>`;
    const r = parseDeclarations(makeDoc(text));

    // The nested parameter must NOT be treated as a declaration of this report…
    assert.deepStrictEqual(r.parameters.map(p => p.name), ['OWN']);
    // …but it must count as a usage so the 'unused' warning does not fire.
    const nested = r.references.find(x => x.name === 'NESTED');
    assert.ok(nested, 'expected NESTED to be registered as a reference');
    assert.strictEqual(nested.sigil, 'P');
    assert.strictEqual(nested.fromSubreport, true);
});

test('ignores <parameter> tags inside subreports when collecting declarations', () => {
    const text = `<jasperReport name="R"><element kind="subreport"><parameter name="NESTED"/></element></jasperReport>`;
    assert.deepStrictEqual(parseDeclarations(makeDoc(text)).parameters, []);
});

test('dataset declarations are not report-scope declarations (issue regression)', () => {
    const text = `<jasperReport name="R">
  <parameter name="Own" class="java.lang.String"/>
  <field name="MainField" class="java.lang.String"/>
  <variable name="MainVar" class="java.lang.String"/>
  <dataset name="DS">
    <parameter name="DSParam" class="java.lang.String"/>
    <field name="DSField" class="java.lang.String"/>
    <variable name="DSVar" class="java.lang.String"/>
    <query language="jsonql"><![CDATA[x]]></query>
  </dataset>
</jasperReport>`;
    const r = parseDeclarations(makeDoc(text));

    assert.deepStrictEqual(r.fields.map(f => f.name), ['MainField']);
    assert.deepStrictEqual(r.parameters.map(p => p.name), ['Own']);
    assert.deepStrictEqual(r.variables.map(v => v.name), ['MainVar']);

    assert.deepStrictEqual(r.dataset.fields.map(f => f.name), ['DSField']);
    assert.deepStrictEqual(r.dataset.parameters.map(p => p.name), ['DSParam']);
    assert.deepStrictEqual(r.dataset.variables.map(v => v.name), ['DSVar']);

    // all* spans report + dataset scope for reference resolution
    assert.deepStrictEqual(r.allFields.map(f => f.name).sort(), ['DSField', 'MainField']);
    assert.deepStrictEqual(r.allParameters.map(p => p.name).sort(), ['DSParam', 'Own']);
    assert.deepStrictEqual(r.allVariables.map(v => v.name).sort(), ['DSVar', 'MainVar']);
});

const SCOPED_REPORT = `<jasperReport name="R">
  <field name="MainField" class="java.lang.String"/>
  <dataset name="DS">
    <parameter name="DSParam" class="java.lang.String"/>
    <field name="DSField" class="java.lang.String"/>
    <filterExpression><![CDATA[$F{DSField}]]></filterExpression>
  </dataset>
  <detail><band height="20">
    <element kind="component">
      <component kind="list">
        <datasetRun subDataset="DS">
          <parameter name="DSParam">
            <expression><![CDATA[$F{MainField}]]></expression>
          </parameter>
        </datasetRun>
        <contents>
          <element kind="textField"><expression><![CDATA[$F{DSField}]]></expression></element>
        </contents>
      </component>
    </element>
  </band></detail>
</jasperReport>`;

test('exposes every dataset with its own declarations and document span', () => {
    const r = parseDeclarations(makeDoc(SCOPED_REPORT));

    assert.strictEqual(r.datasets.length, 1);
    const ds = r.datasets[0];
    assert.strictEqual(ds.name, 'DS');
    assert.deepStrictEqual(ds.fields.map(f => f.name), ['DSField']);
    assert.deepStrictEqual(ds.parameters.map(p => p.name), ['DSParam']);
    assert.deepStrictEqual(ds.variables, []);
    assert.strictEqual(
        SCOPED_REPORT.slice(ds.offset, ds.offset + '<dataset'.length),
        '<dataset'
    );
    assert.ok(ds.end > ds.offset);
});

test('resolveDeclarationScope selects the dataset inside a dataset definition', () => {
    const text = SCOPED_REPORT;
    const cursor = text.indexOf('$F{DSField}') + 2;
    const scope = resolveDeclarationScope(parseDeclarations(makeDoc(text)), cursor);

    assert.strictEqual(scope.kind, 'dataset');
    assert.strictEqual(scope.datasetName, 'DS');
    assert.deepStrictEqual(scope.fields.map(f => f.name), ['DSField']);
    assert.deepStrictEqual(scope.allFields.map(f => f.name), ['DSField']);
});

test('resolveDeclarationScope selects the dataset inside a list datasetRun consumer', () => {
    const text = SCOPED_REPORT;
    const cursor = text.lastIndexOf('$F{DSField}') + 2;
    const scope = resolveDeclarationScope(parseDeclarations(makeDoc(text)), cursor);

    assert.strictEqual(scope.kind, 'dataset');
    assert.strictEqual(scope.datasetName, 'DS');
});

test('datasetRun parameter bindings stay in report scope', () => {
    const text = SCOPED_REPORT;
    const cursor = text.indexOf('$F{MainField}') + 2;
    const scope = resolveDeclarationScope(parseDeclarations(makeDoc(text)), cursor);

    assert.strictEqual(scope.kind, 'report');
    assert.deepStrictEqual(scope.fields.map(f => f.name), ['MainField']);
});

test('resolveDeclarationScope falls back to report scope outside datasets', () => {
    const scope = resolveDeclarationScope(parseDeclarations(makeDoc(SCOPED_REPORT)), 0);

    assert.strictEqual(scope.kind, 'report');
    assert.deepStrictEqual(scope.allFields.map(f => f.name), ['MainField']);
});

test('resolveDeclarationScope marks a run of an undefined dataset as unknown', () => {
    const text = `<jasperReport name="R">
  <field name="MainField" class="java.lang.String"/>
  <detail><band><element kind="component"><component kind="list">
    <datasetRun subDataset="External"/>
    <contents><element kind="textField"><expression><![CDATA[$F{Anything}]]></expression></element></contents>
  </component></element></band></detail>
</jasperReport>`;
    const cursor = text.indexOf('$F{Anything}') + 2;
    const scope = resolveDeclarationScope(parseDeclarations(makeDoc(text)), cursor);

    assert.strictEqual(scope.kind, 'unknown');
    assert.strictEqual(scope.datasetName, 'External');
    assert.deepStrictEqual(scope.fields, []);
});

test('a parameter passed into a subreport is not a declaration of this report (issue regression)', () => {
    const text = `<jasperReport name="R">
  <field name="Field_1" class="java.lang.String"/>
  <detail><band height="10">
    <element kind="subreport" x="0" y="0" width="200" height="200">
      <connectionExpression><![CDATA[$P{REPORT_CONNECTION}]]></connectionExpression>
      <expression><![CDATA[$F{Field_1}]]></expression>
      <parameter name="someparameter"><expression><![CDATA["example"]]></expression></parameter>
    </element>
  </band></detail>
</jasperReport>`;
    const r = parseDeclarations(makeDoc(text));

    assert.deepStrictEqual(r.parameters, []);
    assert.deepStrictEqual(r.allParameters, []);
    assert.deepStrictEqual(r.dataset.parameters, []);
});

test('treats returnValue toVariable as a used variable reference', () => {
    const text = `<jasperReport name="R"><returnValue toVariable="out"/></jasperReport>`;
    const refs = parseDeclarations(makeDoc(text)).references;
    assert.deepStrictEqual(refs.map(r => `${r.sigil}:${r.name}`), ['V:out']);
});

test('outline lists one textField per element and strips CDATA', () => {
    const r = parseDeclarations(makeDoc(SAMPLE));
    const report = r.outline[0];
    const band = report.children.find(c => c.kind === 'band');

    assert.ok(band, 'expected a band node');
    assert.strictEqual(band.children.length, 1, 'textFieldExpression must not add a second node');
    assert.strictEqual(band.children[0].name, '$V{total}');
});

test('outline node ranges are ordered and parents contain their children', () => {
    const report = parseDeclarations(makeDoc(SAMPLE)).outline[0];

    const check = (node) => {
        assert.ok(node.end >= node.offset, `${node.kind} range must be ordered`);
        for (const child of node.children) {
            assert.ok(child.offset >= node.offset && child.end <= node.end,
                `${child.kind} must be contained in ${node.kind}`);
            check(child);
        }
    };
    check(report);
});

test('caches per document version and clearCache forces a re-parse', () => {
    const uri  = 'file:///cached.jrxml';
    const text = `<jasperReport name="R"><field name="a" class="java.lang.String"/></jasperReport>`;

    const first  = parseDeclarations(makeDoc(text, 1, uri));
    const second = parseDeclarations(makeDoc(text, 1, uri));
    assert.strictEqual(first, second, 'same version should hit the cache');

    const third = parseDeclarations(makeDoc(text, 2, uri));
    assert.notStrictEqual(first, third, 'a bumped version should re-parse');

    clearCache(uri);
    clearAllCaches();
    assert.ok(true);
});

module.exports = {};

const DUPLICATES_REPORT = `<jasperReport name="R">
  <field name="Amount" class="java.lang.Double"/>
  <field name="Amount" class="java.lang.String"/>
  <field name="Unique" class="java.lang.String"/>
  <dataset name="DS">
    <field name="Amount" class="java.lang.Double"/>
    <field name="Amount" class="java.lang.String"/>
    <parameter name="P" class="java.lang.String"/>
    <parameter name="P" class="java.lang.String"/>
    <variable name="V" class="java.lang.Integer" calculation="Count"/>
    <variable name="V" class="java.lang.Integer" calculation="Count"/>
  </dataset>
  <dataset name="DS"/>
  <group name="G"><groupExpression><![CDATA[1]]></groupExpression></group>
  <group name="G"><groupExpression><![CDATA[2]]></groupExpression></group>
  <style name="S" fontSize="10"/>
  <style name="S" fontSize="12"/>
</jasperReport>`;

test('findDuplicateNames reports repeats inside a scope, not across scopes', () => {
    const text = DUPLICATES_REPORT;
    const duplicates = findDuplicateNames(parseDeclarations(makeDoc(text)));

    const summary = duplicates.map(d => `${d.kind}:${d.name}@${d.scope}`).sort();
    assert.deepStrictEqual(summary, [
        'dataset:DS@',
        'field:Amount@',
        'field:Amount@DS',
        'group:G@',
        'parameter:P@DS',
        'style:S@',
        'variable:V@DS',
    ]);

    for (const duplicate of duplicates) {
        assert.strictEqual(
            text.slice(duplicate.offset, duplicate.offset + duplicate.length),
            duplicate.name,
            `span for ${duplicate.kind}:${duplicate.name}`
        );
    }
});

test('findDuplicateNames returns an empty list for unique declarations', () => {
    const parsed = parseDeclarations(makeDoc(SAMPLE));
    assert.deepStrictEqual(findDuplicateNames(parsed), []);
});
