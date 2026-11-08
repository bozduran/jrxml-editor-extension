// test/diagnostics.test.js
// The vscode-free analysis pipeline used by both the editor and CI.

const test   = require('node:test');
const assert = require('node:assert');

const { collectFindings } = require('../diagnostics');

function codes(findings) {
    return findings.map(finding => finding.code);
}

test('collectFindings returns plain findings with string severities', () => {
    const text = `<jasperReport name="R">
  <field name="unused" class="java.lang.String"/>
  <expression><![CDATA[$F{missing}]]></expression>
</jasperReport>`;

    const findings = collectFindings({ text });
    assert.ok(codes(findings).includes('jrxml.unusedField'));
    assert.ok(codes(findings).includes('jrxml.undeclaredReference'));

    const undeclared = findings.find(finding => finding.code === 'jrxml.undeclaredReference');
    assert.strictEqual(undeclared.severity, 'error');
    assert.strictEqual(text.slice(undeclared.offset, undeclared.offset + undeclared.length), '$F{missing}');

    const unused = findings.find(finding => finding.code === 'jrxml.unusedField');
    assert.strictEqual(unused.severity, 'warning');
    assert.strictEqual(text.slice(unused.offset, unused.offset + unused.length), 'unused');
});

test('settings can switch individual rules off', () => {
    const text = `<jasperReport name="R">
  <field name="unused" class="java.lang.String"/>
  <expression><![CDATA[$F{missing}]]></expression>
</jasperReport>`;

    const findings = collectFindings({
        text,
        settings: { unused: false, expressions: false },
    });

    assert.deepStrictEqual(findings, []);
});

test('layout findings come through as errors', () => {
    const text = `<jasperReport name="R" pageWidth="595" pageHeight="842" columnWidth="555"
      leftMargin="20" rightMargin="20" columnCount="2">
  <detail><band height="20"/></detail>
</jasperReport>`;

    const findings = collectFindings({ text });
    assert.deepStrictEqual(codes(findings), ['jrxml.layout.columns']);
    assert.strictEqual(findings[0].severity, 'error');
});

test('quick-fix payloads survive the pipeline', () => {
    const text = `<jasperReport name="R">
  <field name="active" class="java.lang.Boolean"/>
  <expression><![CDATA[$F{active} == true]]></expression>
</jasperReport>`;

    const finding = collectFindings({ text })
        .find(item => item.code === 'jrxml.booleanEquals');

    assert.ok(finding, 'expected a boolean-style finding');
    assert.strictEqual(finding.data.replacement, 'EQUALS($F{active}, true)');
});
