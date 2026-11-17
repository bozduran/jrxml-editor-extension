// test/javaSymbols.test.js
// Java import, class and call checks over a report + a workspace class index.

const test   = require('node:test');
const assert = require('node:assert');

const { scanXml } = require('../out/xmlspan');
const { parseReport } = require('../out/jrxmlParser');
const { textSource } = require('../out/reportSource');
const { extractJavaClass } = require('../out/javaSourceScan');
const { buildJavaProjectIndex } = require('../out/javaProjectIndex');
const { checkJavaSymbols } = require('../out/javaSymbols');

const HELPERS = `package com.acme.util;
public final class Helpers {
    public static String upper(String name) { return name; }
    public static int sum(int a, int b) { return a + b; }
    public static String join(String... parts) { return ""; }
    public String instanceOnly() { return ""; }
}
`;

const INDEX = buildJavaProjectIndex([extractJavaClass(HELPERS)]);

let seq = 0;

/** Build a report with imports, fields and expressions; returns text + parsed. */
function report({ imports = [], fields = [], expressions = [], printWhen = [] } = {}) {
    const importTags = imports.map(value => `<import value="${value}"/>`).join('\n  ');
    const fieldTags = fields
        .map(({ name, className }) => `<field name="${name}" class="${className}"/>`)
        .join('\n  ');
    const fieldExpression = fields.length
        ? `<variable name="V" class="java.lang.String"><variableExpression><![CDATA[$F{${fields[0].name}}]]></variableExpression></variable>`
        : '';

    const textField = (index, expression) => `<textField>
      <reportElement x="0" y="${index * 20}" width="100" height="20"/>
      <textFieldExpression><![CDATA[${expression}]]></textFieldExpression>
    </textField>`;
    const whenField = (index, expression) => `<textField>
      <reportElement x="0" y="${index * 20}" width="100" height="20"/>
      <printWhenExpression><![CDATA[${expression}]]></printWhenExpression>
    </textField>`;

    const text = `<jasperReport name="R">
  ${importTags}
  ${fieldTags}
  ${fieldExpression}
  <detail><band height="200">
    ${expressions.map((expression, index) => textField(index, expression)).join('\n    ')}
    ${printWhen.map((expression, index) => whenField(index + expressions.length, expression)).join('\n    ')}
  </band></detail>
</jasperReport>`;

    const scan = scanXml(text);
    seq += 1;
    return { text, scan, parsed: parseReport(textSource(text, `symbols-${seq}.jrxml`, seq), scan) };
}

function run(options) {
    const { text, scan, parsed } = report(options);
    return { text, findings: checkJavaSymbols({ text, scan, parsed, index: INDEX, baseline: 8 }) };
}

function codes(findings) {
    return findings.map(finding => finding.code);
}

function one(options, code) {
    return run(options).findings.find(finding => finding.code === code);
}

// ── Imports ──────────────────────────────────────────────────────────────────

test('a misspelled project import is reported with a suggestion', () => {
    const { findings } = run({ imports: ['com.acme.util.Helperz'] });
    const finding = findings.find(entry => entry.code === 'jrxml.unknownImport');

    assert.ok(finding);
    assert.match(finding.message, /did you mean 'Helpers'/);
});

test('third-party imports the extension cannot see are not reported', () => {
    const { findings } = run({ imports: ['org.springframework.Bean'] });
    assert.deepStrictEqual(codes(findings), []);
});

test('an imported class that no expression uses is reported', () => {
    const { findings } = run({ imports: ['com.acme.util.Helpers'], expressions: ['1 + 1'] });
    assert.ok(codes(findings).includes('jrxml.unusedImport'));
});

test('a used import and wildcard imports are not reported as unused', () => {
    const used = run({
        imports: ['com.acme.util.Helpers'],
        expressions: ['com.acme.util.Helpers.upper("x")'],
    });
    assert.ok(!codes(used.findings).includes('jrxml.unusedImport'));

    const wildcard = run({ imports: ['com.acme.util.*'], expressions: ['1 + 1'] });
    assert.ok(!codes(wildcard.findings).includes('jrxml.unusedImport'));
});

// ── Declaration classes ─────────────────────────────────────────────────────

test('a misspelled project class on a declaration is reported', () => {
    const { findings } = run({ fields: [{ name: 'F', className: 'com.acme.util.Helperz' }] });
    const finding = findings.find(entry => entry.code === 'jrxml.unknownClass');

    assert.ok(finding);
    assert.strictEqual(finding.offset > 0, true);
    assert.match(finding.message, /Helpers/);
});

test('JDK and third-party declaration classes are trusted, not guessed at', () => {
    const { findings } = run({
        fields: [
            { name: 'A', className: 'java.lang.Math' },
            { name: 'B', className: 'org.springframework.Bean' },
        ],
    });
    assert.deepStrictEqual(codes(findings), []);
});

// ── Static helper calls ─────────────────────────────────────────────────────

test('a helper call without an import is reported once', () => {
    const finding = one({ expressions: ['Helpers.upper($F{F})'], fields: [{ name: 'F', className: 'java.lang.String' }] }, 'jrxml.missingImport');
    assert.ok(finding);
    assert.match(finding.message, /com\.acme\.util\.Helpers/);
});

test('a fully qualified call to an unknown project class is reported with a hint', () => {
    const finding = one({ expressions: ['com.acme.util.Helperz.upper("x")'] }, 'jrxml.unknownClass');
    assert.ok(finding);
    assert.match(finding.message, /did you mean 'Helpers'/);
});

test('an unknown helper method and a non-static method are distinguished', () => {
    const missing = one({ expressions: ['com.acme.util.Helpers.nope()'] }, 'jrxml.unknownJavaHelper');
    assert.ok(missing);
    assert.match(missing.message, /no method named 'nope'/);

    const instance = one({ expressions: ['com.acme.util.Helpers.instanceOnly()'] }, 'jrxml.unknownJavaHelper');
    assert.ok(instance);
    assert.match(instance.message, /not static/);
});

test('arity is checked, including overloads and varargs', () => {
    const arity = one({ expressions: ['com.acme.util.Helpers.upper("a", "b")'] }, 'jrxml.javaHelperArity');
    assert.ok(arity);
    assert.match(arity.message, /2 argument/);

    assert.deepStrictEqual(codes(run({ expressions: ['com.acme.util.Helpers.sum(1, 2)'] }).findings), []);
    assert.deepStrictEqual(codes(run({ expressions: ['com.acme.util.Helpers.join("a", "b", "c")'] }).findings), []);
});

test('a class with no readable methods is not treated as missing every method', () => {
    const { scan, parsed, text } = (() => {
        const { text: source, scan: scanned, parsed: reportParsed } = report({
            expressions: ['com.acme.Empty.nope()'],
        });
        return { text: source, scan: scanned, parsed: reportParsed };
    })();
    const emptyIndex = buildJavaProjectIndex([
        extractJavaClass('package com.acme; public class Empty { public static final int X = 1; }'),
    ]);

    const findings = checkJavaSymbols({ text, scan, parsed, index: emptyIndex, baseline: 8 });
    assert.ok(!findings.some(finding => finding.code === 'jrxml.unknownJavaHelper'));
});

test('indexed JDK statics are checked, unindexed JDK classes are skipped', () => {
    assert.deepStrictEqual(codes(run({ expressions: ['String.valueOf(1)'] }).findings), []);
    assert.ok(codes(run({ expressions: ['String.nope(1)'] }).findings).includes('jrxml.unknownJavaHelper'));
    assert.ok(codes(run({ expressions: ['Integer.parseInt("1", 2, 3)'] }).findings).includes('jrxml.javaHelperArity'));

    // Math is not in the shipped member table: absence is not evidence.
    assert.deepStrictEqual(codes(run({ expressions: ['Math.max(1, 2)'] }).findings), []);
});

// ── Typed receiver calls ────────────────────────────────────────────────────

test('an unknown method on a typed receiver is reported', () => {
    const finding = one({
        fields: [{ name: 'F', className: 'java.lang.String' }],
        expressions: ['$F{F}.trimX()'],
    }, 'jrxml.unknownJavaMember');

    assert.ok(finding);
    assert.match(finding.message, /java\.lang\.String/);
});

test('a known method and an unknown receiver type are not reported', () => {
    assert.deepStrictEqual(codes(run({
        fields: [{ name: 'F', className: 'java.lang.String' }],
        expressions: ['$F{F}.trim()'],
    }).findings), []);

    assert.deepStrictEqual(codes(run({
        fields: [{ name: 'F', className: 'com.acme.util.Helpers' }],
        expressions: ['$F{F}.trimX()'],
    }).findings), []);
});

// ── printWhenExpression ─────────────────────────────────────────────────────

test('a literal printWhenExpression is reported', () => {
    const finding = one({ printWhen: ['"yes"'] }, 'jrxml.printWhenNotBoolean');
    assert.ok(finding);
    assert.deepStrictEqual(codes(run({ printWhen: ['$F{F} != null'], fields: [{ name: 'F', className: 'java.lang.String' }] }).findings), []);
});

// ── Gates and spans ─────────────────────────────────────────────────────────

test('non-Java reports skip the whole family', () => {
    const { text, scan, parsed } = report({ expressions: ['com.acme.util.Helpers.nope()'] });
    const findings = checkJavaSymbols({
        text, scan, parsed, index: INDEX, baseline: 8, javaLanguage: false,
    });
    assert.deepStrictEqual(findings, []);
});

test('finding spans point at the offending source text', () => {
    const { text, findings } = run({ expressions: ['com.acme.util.Helpers.nope()'] });
    const finding = findings[0];
    assert.strictEqual(
        text.slice(finding.offset, finding.offset + finding.length),
        'com.acme.util.Helpers.nope()'
    );
});
