// test/xmlLint.test.js
// Rule-level tests plus golden fixtures copied from the myhooks hook repo.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { lintXml, findStringLiterals, firstMarkupTag, RULE } = require('../xmlLint');

function lineOf(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

/** Render findings as `line: message`, the hook's own report shape. */
function report(text, enabled) {
    const { findings, error } = lintXml(text, enabled);
    assert.strictEqual(error, null, `unexpected scan error: ${error}`);
    return findings.map(f => `${lineOf(text, f.offset)}: ${f.message}`);
}

function fixture(name) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

// ── constant printWhenExpression ──────────────────────────────────────────────

test('constant printWhen: flags literal true and false only', () => {
    const text = `<r>
<printWhenExpression><![CDATA[true]]></printWhenExpression>
<printWhenExpression><![CDATA[false]]></printWhenExpression>
<printWhenExpression><![CDATA[ true ]]></printWhenExpression>
<printWhenExpression><![CDATA[TRUE]]></printWhenExpression>
<printWhenExpression><![CDATA[$F{a}]]></printWhenExpression>
<printWhenExpression/>
<printWhenExpression></printWhenExpression>
</r>`;

    assert.deepStrictEqual(report(text), [
        "2: printWhenExpression is a constant 'true'",
        "3: printWhenExpression is a constant 'false'",
        "4: printWhenExpression is a constant 'true'",
    ]);
});

test('constant printWhen: plain text content (no CDATA) is handled', () => {
    const text = `<r><printWhenExpression>false</printWhenExpression></r>`;
    assert.deepStrictEqual(report(text), ["1: printWhenExpression is a constant 'false'"]);
});

// ── removeLineWhenBlank ───────────────────────────────────────────────────────

test('removeLineWhenBlank: flags textField and subreport with missing/wrong value', () => {
    const text = `<r>
<element kind="textField"/>
<element kind="subreport"/>
<element kind="textField" removeLineWhenBlank="true"/>
<element kind="textField" removeLineWhenBlank=" false "/>
<element kind="textField" removeLineWhenBlank="True"/>
<element kind="staticText"/>
<element kind="image"/>
</r>`;

    assert.deepStrictEqual(report(text), [
        '2: textField is missing removeLineWhenBlank="true"',
        '3: subreport is missing removeLineWhenBlank="true"',
        '5: removeLineWhenBlank is " false " on textField; expected "true"',
        '6: removeLineWhenBlank is "True" on textField; expected "true"',
    ]);
});

test('removeLineWhenBlank: nested elements are checked too', () => {
    const text = `<r><element kind="frame"><element kind="textField"/></element></r>`;
    assert.deepStrictEqual(report(text), ['1: textField is missing removeLineWhenBlank="true"']);
});

// ── markup tag without markup ─────────────────────────────────────────────────

// Markup cases isolate the rule so the (unrelated) removeLineWhenBlank warning
// every bare textField also produces does not pollute the expectation.
const reportMarkup = text => report(text, { removeLineWhenBlank: false });

test('markup: flags a markup tag inside a string literal', () => {
    const text = `<r><element kind="textField">
<expression><![CDATA[$F{name} + " <b>bold</b>"]]></expression>
</element></r>`;

    assert.deepStrictEqual(reportMarkup(text), [
        '1: text contains markup tag <b> but markup is not "styled", "html" or "rtf"',
    ]);
});

test('markup: styled/html/rtf are accepted case-insensitively', () => {
    const text = `<r>
<element kind="textField" markup="styled"><expression><![CDATA["<b>x</b>"]]></expression></element>
<element kind="textField" markup="HTML"><expression><![CDATA["<i>x</i>"]]></expression></element>
<element kind="textField" markup=" Rtf "><expression><![CDATA["<u>x</u>"]]></expression></element>
</r>`;

    assert.deepStrictEqual(reportMarkup(text), []);
});

test('markup: none / unknown / missing are flagged', () => {
    const text = `<r>
<element kind="textField" markup="none"><expression><![CDATA["<b>x</b>"]]></expression></element>
<element kind="textField" markup="weird"><expression><![CDATA["<b>x</b>"]]></expression></element>
</r>`;

    assert.deepStrictEqual(reportMarkup(text), [
        '2: text contains markup tag <b> but markup is not "styled", "html" or "rtf"',
        '3: text contains markup tag <b> but markup is not "styled", "html" or "rtf"',
    ]);
});

test('markup: the matched tag case is preserved and only one warning is emitted', () => {
    const text = `<r><element kind="textField">
<expression><![CDATA["<B>a</B> and <i>b</i>"]]></expression>
</element></r>`;
    assert.deepStrictEqual(reportMarkup(text), [
        '1: text contains markup tag <B> but markup is not "styled", "html" or "rtf"',
    ]);
});

test('markup: tags are only recognised inside strings, not in code', () => {
    const text = `<r>
<element kind="textField"><expression><![CDATA[$F{a} < $F{b}]]></expression></element>
<element kind="textField"><expression><![CDATA[a<b]]></expression></element>
<element kind="textField"><expression><![CDATA[List<String> x = null]]></expression></element>
<element kind="textField"><expression><![CDATA['<' + "plain"]]></expression></element>
<element kind="textField"><expression><![CDATA["<b"]]></expression></element>
</r>`;

    assert.deepStrictEqual(reportMarkup(text), []);
});

test('markup: a self-closing / attribute-bearing tag is recognised', () => {
    const text = `<r><element kind="textField">
<expression><![CDATA["line<br/>next"]]></expression>
</element></r>`;
    assert.deepStrictEqual(reportMarkup(text), [
        '1: text contains markup tag <br> but markup is not "styled", "html" or "rtf"',
    ]);
});

test('markup: textFieldExpression child and other kinds', () => {
    const text = `<r>
<element kind="textField"><textFieldExpression><![CDATA["<b>x</b>"]]></textFieldExpression></element>
<element kind="staticText"><text><![CDATA["<b>x</b>"]]></text></element>
</r>`;

    assert.deepStrictEqual(reportMarkup(text), [
        '2: text contains markup tag <b> but markup is not "styled", "html" or "rtf"',
    ]);
});

// ── gating and robustness ─────────────────────────────────────────────────────

test('each rule can be switched off independently', () => {
    const text = `<r>
<element kind="textField"><expression><![CDATA["<b>x</b>"]]></expression></element>
<printWhenExpression><![CDATA[true]]></printWhenExpression>
</r>`;

    assert.deepStrictEqual(lintXml(text, { markupTagWithoutMarkup: false }).findings.map(f => f.rule),
        ['removeLineWhenBlank', 'constantPrintWhen']);
    assert.deepStrictEqual(lintXml(text, { removeLineWhenBlank: false }).findings.map(f => f.rule),
        ['markupTagWithoutMarkup', 'constantPrintWhen']);
    assert.deepStrictEqual(lintXml(text, { constantPrintWhen: false }).findings.map(f => f.rule),
        ['markupTagWithoutMarkup', 'removeLineWhenBlank']);
});

test('malformed XML yields an error and no findings (never guesses)', () => {
    const result = lintXml('<r><a></b></r>');
    assert.strictEqual(result.findings.length, 0);
    assert.match(result.error, /mismatched/);
});

test('linting is read-only / stable across runs', () => {
    const text = fixture('LintEdgeReport.jrxml');
    assert.deepStrictEqual(lintXml(text).findings, lintXml(text).findings);
});

test('findings carry a code and a start-tag anchored range', () => {
    const text = '<r><printWhenExpression><![CDATA[true]]></printWhenExpression></r>';
    const [finding] = lintXml(text).findings;
    assert.strictEqual(finding.code, RULE.constantPrintWhen);
    assert.strictEqual(text.slice(finding.offset, finding.offset + finding.length),
        '<printWhenExpression>');
});

// ── literal scanner ───────────────────────────────────────────────────────────

test('findStringLiterals returns strings and text blocks, skips char literals and comments', () => {
    const java = `a + "one" + 'x' + """block""" + // "ignored"
                  /* "also ignored" */ + "two"`;
    const literals = findStringLiterals(java).map(l => l.raw);
    assert.deepStrictEqual(literals, ['"one"', '"""block"""', '"two"']);
});

test('firstMarkupTag returns the first tag or null', () => {
    assert.strictEqual(firstMarkupTag('"<b>x</b>"'), 'b');
    assert.strictEqual(firstMarkupTag('"plain"'), null);
});

// ── golden fixtures (expected output recorded from the hook) ──────────────────

test('golden: LintEdgeReport.jrxml', () => {
    assert.deepStrictEqual(report(fixture('LintEdgeReport.jrxml')), [
        "14: printWhenExpression is a constant 'true'",
    ]);
});

test('golden: MarkupReport.jrxml', () => {
    assert.deepStrictEqual(report(fixture('MarkupReport.jrxml')), [
        '9: textField is missing removeLineWhenBlank="true"',
        '12: textField is missing removeLineWhenBlank="true"',
    ]);
});

test('golden: Blank_A4_1.jrxml', () => {
    assert.deepStrictEqual(report(fixture('Blank_A4_1.jrxml')), [
        '17: textField is missing removeLineWhenBlank="true"',
        '26: textField is missing removeLineWhenBlank="true"',
        '31: textField is missing removeLineWhenBlank="true"',
        '37: textField is missing removeLineWhenBlank="true"',
        '40: textField is missing removeLineWhenBlank="true"',
        '44: textField is missing removeLineWhenBlank="true"',
        '47: textField is missing removeLineWhenBlank="true"',
        '50: subreport is missing removeLineWhenBlank="true"',
        '54: subreport is missing removeLineWhenBlank="true"',
        '60: textField is missing removeLineWhenBlank="true"',
    ]);
});

test('golden: TextReport.jrxml', () => {
    assert.deepStrictEqual(report(fixture('TextReport.jrxml')), [
        '21: textField is missing removeLineWhenBlank="true"',
        '31: textField is missing removeLineWhenBlank="true"',
        '39: textField is missing removeLineWhenBlank="true"',
        '57: textField is missing removeLineWhenBlank="true"',
        '60: textField is missing removeLineWhenBlank="true"',
        '63: textField is missing removeLineWhenBlank="true"',
        '70: textField is missing removeLineWhenBlank="true"',
        '73: textField is missing removeLineWhenBlank="true"',
        '78: textField is missing removeLineWhenBlank="true"',
    ]);
});
