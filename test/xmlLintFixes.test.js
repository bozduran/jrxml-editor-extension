// test/xmlLintFixes.test.js
// Quick-fix computation: each fix must remove its finding and converge.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { lintXml }        = require('../xmlLint');
const { fixForFinding }  = require('../xmlLintFixes');
const { applyEdits }     = require('../edits');

function findingFor(text, code) {
    const { findings, error } = lintXml(text);
    assert.strictEqual(error, null);
    const finding = findings.find(f => f.code === code);
    assert.ok(finding, `expected a ${code} finding`);
    return finding;
}

function applyFix(text, code) {
    const fix = fixForFinding(text, findingFor(text, code));
    assert.ok(fix, 'expected a fix to be offered');
    return { out: applyEdits(text, [fix.edit]), title: fix.title };
}

// ── constant printWhenExpression ──────────────────────────────────────────────

test('constant printWhen fix removes the whole element line', () => {
    const text = '<r>\n  <printWhenExpression><![CDATA[true]]></printWhenExpression>\n</r>';
    const { out, title } = applyFix(text, 'jrxml.lint.constantPrintWhen');

    assert.strictEqual(title, 'Remove constant <printWhenExpression>');
    assert.strictEqual(out, '<r>\n</r>');
    assert.strictEqual(lintXml(out).findings.length, 0);
});

test('constant printWhen fix keeps neighbouring content on a shared line', () => {
    const text = '<r><printWhenExpression><![CDATA[false]]></printWhenExpression><a/></r>';
    const { out } = applyFix(text, 'jrxml.lint.constantPrintWhen');
    assert.strictEqual(out, '<r><a/></r>');
});

// ── removeLineWhenBlank ───────────────────────────────────────────────────────

test('removeLineWhenBlank fix inserts the attribute on a self-closing tag', () => {
    const text = '<r><element kind="textField"/></r>';
    const { out, title } = applyFix(text, 'jrxml.lint.removeLineWhenBlank');

    assert.strictEqual(title, 'Set removeLineWhenBlank="true"');
    assert.strictEqual(out, '<r><element kind="textField" removeLineWhenBlank="true"/></r>');
    assert.strictEqual(lintXml(out).findings.length, 0);
});

test('removeLineWhenBlank fix inserts the attribute on an open tag', () => {
    const text = '<r><element kind="subreport">\n</element></r>';
    const { out } = applyFix(text, 'jrxml.lint.removeLineWhenBlank');
    assert.match(out, /<element kind="subreport" removeLineWhenBlank="true">/);
});

test('removeLineWhenBlank fix replaces a wrong value', () => {
    const text = '<r><element kind="textField" removeLineWhenBlank="False"/></r>';
    const { out } = applyFix(text, 'jrxml.lint.removeLineWhenBlank');
    assert.strictEqual(out, '<r><element kind="textField" removeLineWhenBlank="true"/></r>');
});

// ── markup ────────────────────────────────────────────────────────────────────

test('markup fix adds the attribute when absent', () => {
    const text = '<r><element kind="textField"><expression><![CDATA["<b>x"]]></expression></element></r>';
    const { out, title } = applyFix(text, 'jrxml.lint.markupTagWithoutMarkup');

    assert.strictEqual(title, 'Add markup="styled"');
    assert.match(out, /<element kind="textField" markup="styled">/);
    assert.strictEqual(
        lintXml(out).findings.filter(f => f.code === 'jrxml.lint.markupTagWithoutMarkup').length,
        0
    );
});

test('markup fix replaces an unusable value', () => {
    const text = '<r><element kind="textField" markup="none"><expression><![CDATA["<b>x"]]></expression></element></r>';
    const { out, title } = applyFix(text, 'jrxml.lint.markupTagWithoutMarkup');

    assert.strictEqual(title, 'Set markup="styled"');
    assert.match(out, /markup="styled"/);
    assert.strictEqual(
        lintXml(out).findings.filter(f => f.code === 'jrxml.lint.markupTagWithoutMarkup').length,
        0
    );
});

// ── robustness ────────────────────────────────────────────────────────────────

test('no fix is offered for an unknown code, malformed XML or a stale offset', () => {
    assert.strictEqual(fixForFinding('<r/>', { code: 'jrxml.lint.other', offset: 0 }), null);
    assert.strictEqual(fixForFinding('<r><a></b></r>', { code: 'jrxml.lint.removeLineWhenBlank', offset: 3 }), null);
    assert.strictEqual(fixForFinding('<r/>', { code: 'jrxml.lint.removeLineWhenBlank', offset: 999 }), null);
});

// ── convergence / idempotency ─────────────────────────────────────────────────

function applyAllFixes(text) {
    let current = text;
    for (let i = 0; i < 200; i++) {
        const { findings, error } = lintXml(current);
        assert.strictEqual(error, null);
        if (findings.length === 0) return current;

        const fix = fixForFinding(current, findings[0]);
        assert.ok(fix, `no fix for ${findings[0].code}`);
        current = applyEdits(current, [fix.edit]);
    }
    assert.fail('fixes did not converge');
}

test('applying every fix converges and is idempotent (fixtures)', () => {
    for (const name of ['LintEdgeReport.jrxml', 'Blank_A4_1.jrxml', 'MarkupReport.jrxml', 'TextReport.jrxml']) {
        const original = fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

        const once  = applyAllFixes(original);
        assert.strictEqual(lintXml(once).findings.length, 0, `${name} still has findings`);

        const twice = applyAllFixes(once);
        assert.strictEqual(twice, once, `${name} is not idempotent`);
    }
});
