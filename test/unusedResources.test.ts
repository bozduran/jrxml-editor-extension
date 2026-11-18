// test/unusedResources.test.js
// Styles, subdatasets and the opt-in resource-bundle key summary.

import test from 'node:test';
import assert from 'node:assert';

import { scanXml } from '../out/xmlspan.js';
import { parseReport } from '../out/jrxmlParser.js';
import { textSource } from '../out/reportSource.js';
import type { BundleIndex } from '../out/resourceBundle.js';
import type { UnusedResourceFinding } from '../out/unusedResources.js';
import { checkUnusedResources } from '../out/unusedResources.js';

let seq = 0;

interface RunOptions {
    bundle?: BundleIndex | null;
    includeStyles?: boolean;
    includeSubDatasets?: boolean;
    includeResourceKeys?: boolean;
}

function run(text: string, {
    bundle = null,
    includeStyles = true,
    includeSubDatasets = true,
    includeResourceKeys = false,
}: RunOptions = {}): UnusedResourceFinding[] {
    const scan = scanXml(text);
    seq += 1;
    const parsed = parseReport(textSource(text, `unused-${seq}.jrxml`, seq), scan);
    return checkUnusedResources({ scan, parsed, bundle, includeStyles, includeSubDatasets, includeResourceKeys });
}

function codes(findings: readonly UnusedResourceFinding[]): string[] {
    return findings.map(finding => finding.code);
}

function bundleOf(keys: readonly string[]): BundleIndex {
    return {
        name: 'messages',
        files: [],
        entries: new Map(keys.map(key => [key, {
            key,
            defaultValue: null,
            defaultFile: null,
            defaultPosition: null,
            locales: new Map(),
        }])),
    };
}

const STYLES = `<jasperReport name="R">
  <style name="Used"/>
  <style name="Unused"/>
  <style name="Default" default="true"/>
  <style name="Child" style="Used"/>
  <detail><band height="20">
    <textField>
      <reportElement x="0" y="0" width="10" height="10" style="Used"/>
      <textFieldExpression><![CDATA[1]]></textFieldExpression>
    </textField>
  </band></detail>
</jasperReport>`;

test('unused styles are reported, used and default styles are not', () => {
    const findings = run(STYLES);
    const unused = findings.filter(finding => finding.code === 'jrxml.unusedStyle');

    assert.deepStrictEqual(unused.map(finding => finding.message), [
        "Style 'Unused' is declared but never referenced.",
        "Style 'Child' is declared but never referenced.",
    ]);
});

test('unused subdatasets are reported, referenced ones are not', () => {
    const text = `<jasperReport name="R">
  <subDataset name="Used"><field name="F" class="java.lang.String"/></subDataset>
  <subDataset name="Orphan"><field name="F" class="java.lang.String"/></subDataset>
  <detail><band height="20">
    <componentElement>
      <datasetRun subDataset="Used"/>
    </componentElement>
  </band></detail>
</jasperReport>`;
    const findings = run(text).filter(finding => finding.code === 'jrxml.unusedSubDataset');

    assert.deepStrictEqual(findings.map(finding => finding.message), [
        "Subdataset 'Orphan' is declared but no datasetRun uses it.",
    ]);
});

test('resource keys are opt-in and summarised at the bundle attribute', () => {
    const text = `<jasperReport name="R" resourceBundle="messages">
  <detail><band height="20">
    <textField>
      <reportElement x="0" y="0" width="10" height="10"/>
      <textFieldExpression><![CDATA[$R{title}]]></textFieldExpression>
    </textField>
  </band></detail>
</jasperReport>`;
    const bundle = bundleOf(['title', 'subtitle', 'footer']);

    assert.deepStrictEqual(codes(run(text, { bundle })), [], 'off by default');

    const findings = run(text, { bundle, includeResourceKeys: true });
    assert.deepStrictEqual(codes(findings), ['jrxml.unusedResourceKey']);
    assert.match(findings[0].message, /subtitle/);
    assert.match(findings[0].message, /footer/);
    assert.ok(!findings[0].message.includes('title,'), 'used keys are not listed');
});

test('a fully used bundle produces nothing', () => {
    const text = `<jasperReport name="R" resourceBundle="messages">
  <detail><band height="20">
    <textField>
      <reportElement x="0" y="0" width="10" height="10"/>
      <textFieldExpression><![CDATA[$R{title}]]></textFieldExpression>
    </textField>
  </band></detail>
</jasperReport>`;
    assert.deepStrictEqual(
        codes(run(text, { bundle: bundleOf(['title']), includeResourceKeys: true })),
        []
    );
});

test('each family switch is independent', () => {
    const withStyle = '<jasperReport name="R"><style name="S"/><detail><band height="20"/></detail></jasperReport>';
    assert.deepStrictEqual(codes(run(withStyle, { includeStyles: false })), []);
    assert.deepStrictEqual(codes(run(withStyle, { includeStyles: true })), ['jrxml.unusedStyle']);

    const withDataset = '<jasperReport name="R"><subDataset name="D"/><detail><band height="20"/></detail></jasperReport>';
    assert.deepStrictEqual(codes(run(withDataset, { includeSubDatasets: false })), []);
});

test('malformed XML yields no unused-resource findings', () => {
    assert.deepStrictEqual(run('<jasperReport name="R"><style name="S">'), []);
});
