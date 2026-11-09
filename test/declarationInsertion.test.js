// test/declarationInsertion.test.js
// Quick-fix insertion must target report-level declarations, never a nested
// subreport parameter that happens to share the tag name.

const test   = require('node:test');
const assert = require('node:assert');

const { findInsertionPoint } = require('../out/declarationInsertion');

test('inserts after the last report-level declaration', () => {
    const text = `<jasperReport name="R">
  <parameter name="OWN" class="java.lang.String"/>
  <detail><band height="20"/></detail>
</jasperReport>`;

    const at = findInsertionPoint(text, 'parameter');
    assert.ok(at > text.indexOf('name="OWN"'));
    assert.ok(at < text.indexOf('<detail>'));
    assert.strictEqual(text.slice(at - 2, at), '/>');
});

test('ignores a parameter nested inside a subreport element', () => {
    const text = `<jasperReport name="R">
  <parameter name="OWN" class="java.lang.String"/>
  <detail><band height="20">
    <element kind="subreport">
      <parameter name="SUBREPORT_DIR" class="java.lang.Object" isForPrompting="true"/>
      <expression><![CDATA[$P{SUBREPORT_DIR}+"detail"]]></expression>
    </element>
  </band></detail>
</jasperReport>`;

    const at = findInsertionPoint(text, 'parameter');
    assert.ok(at < text.indexOf('<detail>'), 'must stay above the report body');
    assert.ok(at < text.indexOf('SUBREPORT_DIR'), 'must not land inside the subreport');
});

test('adding a parameter with only fields inserts before the first field', () => {
    const text = `<jasperReport name="R">
  <field name="F" class="java.lang.String"/>
</jasperReport>`;

    const at = findInsertionPoint(text, 'parameter');
    assert.strictEqual(at, text.indexOf('<field '));
});

test('adding a field with only parameters inserts after them', () => {
    const text = `<jasperReport name="R">
  <parameter name="P" class="java.lang.String"/>
  <detail><band/></detail>
</jasperReport>`;

    const at = findInsertionPoint(text, 'field');
    assert.ok(at > text.indexOf('name="P"'));
    assert.strictEqual(at, text.indexOf('<detail>'));
});

test('adding a variable with sort fields and a filter inserts before the filter', () => {
    const text = `<jasperReport name="R">
  <field name="F" class="java.lang.String"/>
  <sortField name="F"/>
  <filterExpression><![CDATA[true]]></filterExpression>
  <detail><band/></detail>
</jasperReport>`;

    const at = findInsertionPoint(text, 'variable');
    assert.strictEqual(at, text.indexOf('<filterExpression>'));
});

test('with no declarations it inserts before the first section', () => {
    const text = `<jasperReport name="R">
  <detail><band/></detail>
</jasperReport>`;

    assert.strictEqual(findInsertionPoint(text, 'parameter'), text.indexOf('<detail>'));
});

test('falls back to the closing report tag for a malformed document', () => {
    const text = '<jasperReport name="R"><field name="F"';
    const at = findInsertionPoint(text, 'parameter');
    assert.strictEqual(at, text.length);
});
