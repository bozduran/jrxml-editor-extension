// test/javaSymbols.test.js
// Java import, class and call checks over a report + a workspace class index.

import test from 'node:test';
import assert from 'node:assert';

import type { XmlScanResult } from '../out/xmlspan.js';
import { scanXml } from '../out/xmlspan.js';
import type { ParseResult } from '../out/jrxmlParser.js';
import { parseReport } from '../out/jrxmlParser.js';
import { textSource } from '../out/reportSource.js';
import { extractJavaClass } from '../out/javaSourceScan.js';
import { buildJavaProjectIndex } from '../out/javaProjectIndex.js';
import type { JavaSymbolFinding } from '../out/javaSymbols.js';
import { checkJavaSymbols } from '../out/javaSymbols.js';

const HELPERS = `package com.acme.util;
public final class Helpers {
    public static String upper(String name) { return name; }
    public static int sum(int a, int b) { return a + b; }
    public static String join(String... parts) { return ""; }
    public String instanceOnly() { return ""; }
}
`;

const helpersClass = extractJavaClass(HELPERS);
assert.ok(helpersClass, 'expected a public Helpers class');
const INDEX = buildJavaProjectIndex([helpersClass]);

let seq = 0;

interface FieldSpec {
    name: string;
    className: string;
}

interface ReportOptions {
    imports?: string[];
    fields?: FieldSpec[];
    expressions?: string[];
    printWhen?: string[];
}

interface ReportFixture {
    text: string;
    scan: XmlScanResult;
    parsed: ParseResult;
}

interface RunResult {
    text: string;
    findings: JavaSymbolFinding[];
}

/** Build a report with imports, fields and expressions; returns text + parsed. */
function report({ imports = [], fields = [], expressions = [], printWhen = [] }: ReportOptions = {}): ReportFixture {
    const importTags = imports.map(value => `<import value="${value}"/>`).join('\n  ');
    const fieldTags = fields
        .map(({ name, className }) => `<field name="${name}" class="${className}"/>`)
        .join('\n  ');
    const fieldExpression = fields.length
        ? `<variable name="V" class="java.lang.String"><variableExpression><![CDATA[$F{${fields[0].name}}]]></variableExpression></variable>`
        : '';

    const textField = (index: number, expression: string): string => `<textField>
      <reportElement x="0" y="${index * 20}" width="100" height="20"/>
      <textFieldExpression><![CDATA[${expression}]]></textFieldExpression>
    </textField>`;
    const whenField = (index: number, expression: string): string => `<textField>
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

function run(options: ReportOptions): RunResult {
    const { text, scan, parsed } = report(options);
    return { text, findings: checkJavaSymbols({ text, scan, parsed, index: INDEX, baseline: 8 }) };
}

function codes(findings: readonly JavaSymbolFinding[]): string[] {
    return findings.map(finding => finding.code);
}

function one(options: ReportOptions, code: string): JavaSymbolFinding | undefined {
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
    const emptyClass = extractJavaClass(
        'package com.acme; public class Empty { public static final int X = 1; }'
    );
    assert.ok(emptyClass, 'expected a public Empty class');
    const emptyIndex = buildJavaProjectIndex([emptyClass]);

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
        fields: [{ name: 'F', className: 'com.acme.Unknown' }],
        expressions: ['$F{F}.trimX()'],
    }).findings), []);
});

test('a project class works as a receiver, with a proper arity finding', () => {
    const unknown = one({
        fields: [{ name: 'F', className: 'com.acme.util.Helpers' }],
        expressions: ['$F{F}.missing()'],
    }, 'jrxml.unknownJavaMember');
    assert.ok(unknown, 'a declared project class is no longer treated as unknown');

    const arity = one({
        fields: [{ name: 'F', className: 'java.lang.String' }],
        expressions: ['$F{F}.substring()'],
    }, 'jrxml.javaMemberArity');
    assert.ok(arity);
    assert.match(arity.message, /substring/);
    assert.match(arity.message, /0 argument/);
});

test('a project superclass suppresses unknown-method guesses', () => {
    const base = extractJavaClass('package com.acme; public class Base { public String inherited() { return ""; } }');
    assert.ok(base, 'expected a public Base class');
    const child = extractJavaClass('package com.acme; public class Child extends Base { public String own() { return ""; } }');
    assert.ok(child, 'expected a public Child class');
    const index = buildJavaProjectIndex([base, child]);
    const { text, scan, parsed } = report({
        fields: [{ name: 'F', className: 'com.acme.Child' }],
        expressions: ['$F{F}.inherited()'],
    });

    const findings = checkJavaSymbols({ text, scan, parsed, index, baseline: 8 });
    assert.deepStrictEqual(codes(findings), [], 'inherited methods are not scanned, so stay quiet');
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

// ── Java expressions outside the formatter's tag list ───────────────────────

function rawReport(text: string): ReportFixture {
    seq += 1;
    const scan = scanXml(text);
    return { text, scan, parsed: parseReport(textSource(text, `raw-${seq}.jrxml`, seq), scan) };
}

test('propertyExpression counts as a Java expression', () => {
    const used = rawReport(`<jasperReport name="R">
  <import value="com.acme.util.Helpers"/>
  <propertyExpression name="p"><![CDATA[com.acme.util.Helpers.upper("x")]]></propertyExpression>
  <detail><band height="20"/></detail>
</jasperReport>`);

    const findings = checkJavaSymbols({ ...used, index: INDEX, baseline: 8 });
    assert.ok(!codes(findings).includes('jrxml.unusedImport'));
    assert.ok(!codes(findings).includes('jrxml.unknownJavaHelper'));

    const broken = rawReport(`<jasperReport name="R">
  <propertyExpression name="p"><![CDATA[com.acme.util.Helpers.nope()]]></propertyExpression>
  <detail><band height="20"/></detail>
</jasperReport>`);
    assert.ok(codes(checkJavaSymbols({ ...broken, index: INDEX, baseline: 8 }))
        .includes('jrxml.unknownJavaHelper'));
});

test('an import is unused even when the report has no expressions', () => {
    const { text, scan, parsed } = rawReport(`<jasperReport name="R">
  <import value="com.acme.util.Helpers"/>
  <detail><band height="20"/></detail>
</jasperReport>`);

    const findings = checkJavaSymbols({ text, scan, parsed, index: INDEX, baseline: 8 });
    assert.ok(codes(findings).includes('jrxml.unusedImport'));
});

test('a null printWhenExpression is not a boolean', () => {
    const finding = one({ printWhen: ['null'] }, 'jrxml.printWhenNotBoolean');
    assert.ok(finding);
});

test('a missing class in a scanned package is reported without a near miss', () => {
    const field = one({
        fields: [{ name: 'F', className: 'com.acme.util.Missing' }],
    }, 'jrxml.unknownClass');
    assert.ok(field);
    assert.match(field.message, /com\.acme\.util\.Missing/);

    const imported = one({
        imports: ['com.acme.util.Missing'],
    }, 'jrxml.unknownImport');
    assert.ok(imported);

    const called = one({
        expressions: ['com.acme.util.Missing.run()'],
    }, 'jrxml.unknownClass');
    assert.ok(called);
});
