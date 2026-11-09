// test/layoutRules.test.js
// Pure layout checks: column width, band-height budget and element bounds.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { checkLayout } = require('../out/layoutRules');

function report(body, attrs = '') {
    return `<jasperReport name="R" pageWidth="595" pageHeight="842" columnWidth="555" `
        + `leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20"${attrs}>`
        + body
        + '</jasperReport>';
}

const codes = findings => findings.map(finding => finding.code);

test('a well-formed report has no layout findings', () => {
    const text = report(`
  <title height="40"/>
  <pageHeader height="20"/>
  <columnHeader height="20"/>
  <detail>
    <band height="40">
      <element kind="textField" x="0" y="0" width="200" height="20"/>
    </band>
  </detail>
  <pageFooter height="20"/>`);

    assert.deepStrictEqual(checkLayout(text), []);
});

test('fills the available column height exactly without a finding', () => {
    const text = report(`
  <pageHeader height="35"/>
  <columnHeader height="61"/>
  <detail><band height="607"/></detail>
  <columnFooter height="45"/>
  <pageFooter height="54"/>`);

    assert.deepStrictEqual(checkLayout(text), []);
});

test('columns wider than the page are reported', () => {
    const findings = checkLayout(report('<detail><band height="20"/></detail>', ' columnCount="2"'));

    assert.deepStrictEqual(codes(findings), ['jrxml.layout.columns']);
    assert.match(findings[0].message, /column/i);
    assert.match(findings[0].message, /595/);
});

test('band heights that overflow the page are reported', () => {
    const text = `<jasperReport name="R" pageWidth="300" pageHeight="200" columnWidth="260"
      leftMargin="20" rightMargin="20" topMargin="10" bottomMargin="10">
  <pageHeader height="100"/>
  <detail><band height="100"/></detail>
</jasperReport>`;

    const findings = checkLayout(text);
    assert.deepStrictEqual(codes(findings), ['jrxml.layout.bandHeight']);
    assert.match(findings[0].message, /200/);
    assert.match(findings[0].message, /180/);
});

test('the largest detail band counts toward the page budget', () => {
    const text = report(`
  <detail>
    <band height="100"/>
    <band height="20"/>
  </detail>
  <pageFooter height="10"/>`);

    assert.deepStrictEqual(checkLayout(text), []);
});

test('an element that extends below its band is reported', () => {
    const text = report(`
  <detail>
    <band height="20">
      <element kind="textField" x="0" y="10" width="50" height="20"/>
    </band>
  </detail>`);

    const findings = checkLayout(text);
    assert.deepStrictEqual(codes(findings), ['jrxml.layout.elementOutsideBand']);
    assert.match(findings[0].message, /band/);
});

test('a nested element is checked against its frame, not the band', () => {
    const valid = report(`
  <detail>
    <band height="300">
      <element kind="frame" x="0" y="0" width="100" height="100">
        <element kind="textField" x="0" y="70" width="50" height="20"/>
      </element>
    </band>
  </detail>`);
    assert.deepStrictEqual(checkLayout(valid), []);

    const invalid = report(`
  <detail>
    <band height="300">
      <element kind="frame" x="0" y="0" width="100" height="100">
        <element kind="textField" x="0" y="90" width="50" height="20"/>
      </element>
    </band>
  </detail>`);
    assert.deepStrictEqual(codes(checkLayout(invalid)), ['jrxml.layout.elementOutsideBand']);
});

test('classic reportElement bounds are checked against the band', () => {
    const text = report(`
  <detail>
    <band height="20">
      <textField>
        <reportElement x="0" y="10" width="50" height="20"/>
      </textField>
    </band>
  </detail>`);

    assert.deepStrictEqual(codes(checkLayout(text)), ['jrxml.layout.elementOutsideBand']);
});

test('a positioned element outside any band is reported', () => {
    const text = report('<element kind="textField" x="0" y="0" width="10" height="10"/>');

    const findings = checkLayout(text);
    assert.deepStrictEqual(codes(findings), ['jrxml.layout.elementOutsideBand']);
    assert.match(findings[0].message, /not inside a band/i);
});

test('every shipped fixture passes the layout checks', () => {
    const dir = path.join(__dirname, 'fixtures');

    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.jrxml'))) {
        const findings = checkLayout(fs.readFileSync(path.join(dir, file), 'utf8'));
        assert.deepStrictEqual(findings, [], file);
    }
});

test('classic <band> heights count toward the page budget', () => {
    const text = `<jasperReport name="C" pageWidth="595" pageHeight="200" columnWidth="555"
      leftMargin="20" rightMargin="20" topMargin="10" bottomMargin="10">
  <pageHeader><band height="100"/></pageHeader>
  <detail><band height="100"/></detail>
</jasperReport>`;

    assert.deepStrictEqual(codes(checkLayout(text)), ['jrxml.layout.bandHeight']);
});

test('classic frame children are measured against the frame', () => {
    const text = report(`
  <detail>
    <band height="300">
      <frame>
        <reportElement x="0" y="0" width="100" height="100"/>
        <textField>
          <reportElement x="0" y="90" width="50" height="20"/>
        </textField>
      </frame>
    </band>
  </detail>`);

    assert.deepStrictEqual(codes(checkLayout(text)), ['jrxml.layout.elementOutsideBand']);
});
