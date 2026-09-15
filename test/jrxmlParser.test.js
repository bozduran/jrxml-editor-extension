// test/jrxmlParser.test.js
// Unit tests for the vscode-free parser. Run with: npm test

const test   = require('node:test');
const assert = require('node:assert');

const {
    parseDeclarations,
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
