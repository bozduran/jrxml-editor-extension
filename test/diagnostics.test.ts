// test/diagnostics.test.js
// The vscode-free analysis pipeline used by both the editor and CI.

import test from 'node:test';
import assert from 'node:assert';

import type { Finding } from '../out/diagnostics.js';
import { collectFindings } from '../out/diagnostics.js';

function codes(findings: readonly Finding[]): string[] {
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
    assert.ok(undeclared, 'expected an undeclared-reference finding');
    assert.strictEqual(undeclared.severity, 'error');
    assert.strictEqual(text.slice(undeclared.offset, undeclared.offset + undeclared.length), '$F{missing}');

    const unused = findings.find(finding => finding.code === 'jrxml.unusedField');
    assert.ok(unused, 'expected an unused-field finding');
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
        settings: { unused: false, expressions: false, schema: false },
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
    assert.ok(finding.data, 'expected quick-fix data');
    assert.strictEqual(finding.data.replacement, 'EQUALS($F{active}, true)');
});

// ── Java symbols and schema wiring ──────────────────────────────────────────

import { extractJavaClass } from '../out/javaSourceScan.js';
import { buildJavaProjectIndex } from '../out/javaProjectIndex.js';

const helpersClass = extractJavaClass(
    'package com.acme; public final class Helpers { public static void known() {} }'
);
assert.ok(helpersClass, 'expected a public Helpers class');
const JAVA_INDEX = buildJavaProjectIndex([helpersClass]);

function symbolReport(expression: string): string {
    return `<jasperReport name="R">
  <import value="com.acme.Helpers"/>
  <detail><band height="20">
    <textField>
      <reportElement x="0" y="0" width="100" height="20"/>
      <textFieldExpression><![CDATA[${expression}]]></textFieldExpression>
    </textField>
  </band></detail>
</jasperReport>`;
}

test('the Java index feeds helper-call findings through the pipeline', () => {
    const text = symbolReport('com.acme.Helpers.nope()');
    const findings = collectFindings({ text, javaIndex: JAVA_INDEX });

    assert.ok(codes(findings).includes('jrxml.unknownJavaHelper'));

    const valid = collectFindings({ text: symbolReport('com.acme.Helpers.known()'), javaIndex: JAVA_INDEX });
    assert.ok(!codes(valid).includes('jrxml.unknownJavaHelper'));
});

test('without an index the Java checks stay silent instead of guessing', () => {
    const findings = collectFindings({ text: symbolReport('com.acme.Helpers.nope()') });
    assert.ok(!codes(findings).includes('jrxml.unknownJavaHelper'));
});

test('the new families switch off independently', () => {
    const text = `<jasperReport name="R">
  <style name="Orphan"/>
  <field nmae="F" class="java.lang.String"/>
</jasperReport>`;

    const all = collectFindings({ text });
    assert.ok(codes(all).includes('jrxml.schema.unknownAttribute'));
    assert.ok(codes(all).includes('jrxml.unusedStyle'));

    const schemaOff = collectFindings({ text, settings: { schema: false } });
    assert.ok(!codes(schemaOff).includes('jrxml.schema.unknownAttribute'));
    assert.ok(codes(schemaOff).includes('jrxml.unusedStyle'));

    const unusedOff = collectFindings({ text, settings: { unusedResources: false } });
    assert.ok(!codes(unusedOff).includes('jrxml.unusedStyle'));
});
