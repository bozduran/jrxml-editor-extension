// test/diagnosticsProvider.test.js
// diagnosticsProvider requires 'vscode' at load time, so a stub is installed
// before the module is required. The provider is exercised as a whole
// (declaration parsing + reference collection + unused/undeclared checks).

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

class FakeRange {
    constructor(start, end) { this.start = start; this.end = end; }
}

let currentDiags = [];
const collection = {
    set(_uri, diags) { currentDiags = diags; },
    delete() {},
    dispose() {},
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return {
            DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
            Range: FakeRange,
            Diagnostic: class {
                constructor(range, message, severity) {
                    this.range = range;
                    this.message = message;
                    this.severity = severity;
                }
            },
            languages: { createDiagnosticCollection: () => collection },
            workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
            window: {},
        };
    }
    return originalLoad.call(this, request, ...rest);
};

const { updateDiagnostics } = require('../diagnosticsProvider');

let docSeq = 0;

function fakeDocument(text) {
    const uri = `file:///test/report-${docSeq++}.jrxml`;
    return {
        fileName: '/test/report.jrxml',
        uri: { toString: () => uri },
        version: 1,
        getText: () => text,
        positionAt(offset) {
            const lines = text.slice(0, offset).split('\n');
            return { line: lines.length - 1, character: lines[lines.length - 1].length };
        },
    };
}

function diagnose(text) {
    currentDiags = [];
    updateDiagnostics(fakeDocument(text));
    return currentDiags;
}

const undeclared = diags => diags.filter(d => d.code === 'jrxml.undeclaredReference');
const unused     = diags => diags.filter(d => String(d.code).startsWith('jrxml.unused'));

test('a subreport parameter name is not reported as an undeclared reference', () => {
    const text = `<jasperReport name="R">
  <field name="Field_1" class="java.lang.String"/>
  <detail><band height="10">
    <element kind="subreport" uuid="b1ec6cad" x="76" y="12" width="200" height="200">
      <connectionExpression><![CDATA[$P{REPORT_CONNECTION}]]></connectionExpression>
      <expression><![CDATA[$F{Field_1}]]></expression>
      <parameter name="someparameter"><expression><![CDATA["example"]]></expression></parameter>
    </element>
  </band></detail>
</jasperReport>`;

    const diags = diagnose(text);
    assert.deepStrictEqual(undeclared(diags), []);
    assert.deepStrictEqual(unused(diags), []);
});

test('a classic subreportParameter name is not reported as undeclared', () => {
    const text = `<jasperReport name="R">
  <detail><band height="10">
    <subreport>
      <subreportParameter name="SubP"><subreportParameterExpression><![CDATA["x"]]></subreportParameterExpression></subreportParameter>
      <subreportExpression><![CDATA["sub.jasper"]]></subreportExpression>
    </subreport>
  </band></detail>
</jasperReport>`;

    assert.deepStrictEqual(undeclared(diagnose(text)), []);
});

test('a genuinely undeclared $P{} is still flagged', () => {
    const text = `<jasperReport name="R">
  <expression><![CDATA[$P{Missing}]]></expression>
</jasperReport>`;

    const diags = undeclared(diagnose(text));
    assert.strictEqual(diags.length, 1);
    assert.match(diags[0].message, /Parameter 'Missing' is not declared/);
});

test('an undeclared returnValue toVariable is still flagged', () => {
    const text = `<jasperReport name="R">
  <detail><band height="10">
    <subreport><returnValue toVariable="MissingVar"/></subreport>
  </band></detail>
</jasperReport>`;

    const diags = undeclared(diagnose(text));
    assert.strictEqual(diags.length, 1);
    assert.match(diags[0].message, /Variable 'MissingVar' is not declared/);
});

test('a field used before its declaration in propertyExpression is not unused', () => {
    const text = `<jasperReport name="R">
  <propertyExpression name="net.sf.jasperreports.export.pdf.tag.language"><![CDATA[$F{Field_1}]]></propertyExpression>
  <field name="Field_1" class="java.lang.String"/>
</jasperReport>`;

    assert.deepStrictEqual(unused(diagnose(text)), []);
});
