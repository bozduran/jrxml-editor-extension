// test/schemaChecks.test.js
// The curated JRXML vocabulary must catch typos without flagging real files.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { scanXml } = require('../out/xmlspan');
const { checkSchema } = require('../out/schemaChecks');

function findings(text) {
    return checkSchema(scanXml(text));
}

function codes(text) {
    return findings(text).map(finding => finding.code);
}

const VALID_6X = `<jasperReport name="R" pageWidth="595" pageHeight="842" columnWidth="555" orientation="Portrait">
  <import value="com.acme.Helpers"/>
  <style name="Base" default="true" bold="true"/>
  <field name="F" class="java.lang.String"/>
  <variable name="V" class="java.lang.Integer" calculation="Count">
    <variableExpression><![CDATA[1]]></variableExpression>
  </variable>
  <detail><band height="20" splitType="Stretch">
    <textField pattern="#,##0">
      <reportElement x="0" y="0" width="100" height="20" style="Base" positionType="Float"/>
      <textFieldExpression><![CDATA[$F{F}]]></textFieldExpression>
    </textField>
  </band></detail>
</jasperReport>`;

const VALID_7X = `<jasperReport name="R">
  <field name="F" class="java.lang.String"/>
  <detail><band height="40">
    <element kind="textField" x="0" y="0" width="200" height="20" style="Base">
      <expression><![CDATA[$F{F}]]></expression>
    </element>
    <element kind="line" x="0" y="20" width="200" height="1" direction="TopDown"/>
  </band></detail>
</jasperReport>`;

test('valid 6.x and 7.x reports produce no findings', () => {
    assert.deepStrictEqual(findings(VALID_6X), []);
    assert.deepStrictEqual(findings(VALID_7X), []);
});

test('unknown elements are reported with a suggestion and do not cascade', () => {
    const text = `<jasperReport name="R">
  <feild name="F" class="java.lang.String"/>
</jasperReport>`;
    const [finding] = findings(text);

    assert.strictEqual(finding.code, 'jrxml.schema.unknownElement');
    assert.match(finding.message, /<feild>/);
    assert.match(finding.message, /<field>/);
});

test('unknown attributes are reported on closed elements only', () => {
    const text = `<jasperReport name="R" nmae="x">
  <field name="F" class="java.lang.String" clazz="java.lang.String"/>
  <style name="S" fontWeird="bold"/>
</jasperReport>`;
    const all = findings(text);
    const report = all.find(finding => finding.code === 'jrxml.schema.unknownAttribute' && finding.message.includes('nmae'));
    const field = all.find(finding => finding.code === 'jrxml.schema.unknownAttribute' && finding.message.includes('clazz'));

    assert.ok(report, 'report attribute typo');
    assert.match(report.message, /Did you mean "name"/);
    assert.ok(field, 'field attribute typo');
    assert.ok(!all.some(finding => finding.message.includes('fontWeird')), 'styles have an open attribute set');
});

test('missing required attributes are reported', () => {
    const text = `<jasperReport>
  <field class="java.lang.String"/>
  <detail><band height="20">
    <textField><reportElement width="10" height="10"/></textField>
  </band></detail>
</jasperReport>`;
    const all = findings(text).filter(finding => finding.code === 'jrxml.schema.missingAttribute');

    assert.deepStrictEqual(all.map(finding => finding.length >= 0 && finding.message).sort(), [
        'Element <field> requires the "name" attribute.',
        'Element <jasperReport> requires the "name" attribute.',
        'Element <reportElement> requires the "x" attribute.',
        'Element <reportElement> requires the "y" attribute.',
    ]);
});

test('enum values are checked', () => {
    const text = `<jasperReport name="R" orientation="Sideways">
  <detail><band height="20">
    <element kind="widget" x="0" y="0" width="10" height="10"/>
  </band></detail>
</jasperReport>`;
    const all = findings(text).filter(finding => finding.code === 'jrxml.schema.invalidValue');

    assert.strictEqual(all.length, 2);
    assert.ok(all.some(finding => finding.message.includes('Sideways')));
    assert.ok(all.some(finding => finding.message.includes('widget')));
});

test('report-level elements are checked against schema order', () => {
    const text = `<jasperReport name="R">
  <detail><band height="20"/></detail>
  <field name="F" class="java.lang.String"/>
</jasperReport>`;
    const [finding] = findings(text);

    assert.strictEqual(finding.code, 'jrxml.schema.elementOrder');
    assert.match(finding.message, /<field> must appear before <detail>/);
});

test('queryString is accepted as the query spelling', () => {
    const text = `<jasperReport name="R">
  <queryString language="sql"><![CDATA[SELECT 1]]></queryString>
  <field name="F" class="java.lang.String"/>
</jasperReport>`;
    assert.deepStrictEqual(codes(text), []);
});

test('deprecated attributes point at their replacement', () => {
    const text = `<jasperReport name="R">
  <detail><band height="20">
    <textField isStretchWithOverflow="true">
      <reportElement x="0" y="0" width="10" height="10"/>
    </textField>
  </band></detail>
</jasperReport>`;
    const [finding] = findings(text);

    assert.strictEqual(finding.code, 'jrxml.schema.deprecatedAttribute');
    assert.match(finding.message, /textAdjust/);
});

test('namespaced tags are never reported', () => {
    const text = `<jasperReport name="R">
  <detail><band height="20">
    <textField>
      <reportElement x="0" y="0" width="10" height="10"/>
      <jr:expression><![CDATA[1]]></jr:expression>
    </textField>
  </band></detail>
</jasperReport>`;
    assert.deepStrictEqual(codes(text), []);
});

test('malformed XML yields no schema findings', () => {
    assert.deepStrictEqual(findings('<jasperReport name="R"><field name="F">'), []);
});

// ── Real files must stay clean ──────────────────────────────────────────────

const ROOT = path.join(__dirname, '..');

test('every repo fixture passes the schema checks', () => {
    for (const dir of ['integration/workspace', 'test/fixtures']) {
        for (const file of fs.readdirSync(path.join(ROOT, dir))) {
            if (!file.endsWith('.jrxml')) continue;
            const text = fs.readFileSync(path.join(ROOT, dir, file), 'utf8');
            assert.deepStrictEqual(
                checkSchema(scanXml(text)),
                [],
                `${dir}/${file} has schema findings`
            );
        }
    }
});
