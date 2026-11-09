// test/expressionCoverage.test.js
// Candidate 02: every registry tag is handled by the format, null-dereference
// and text-check consumers. Before the registry switch these three rules shared
// a ten-tag subset; the registry-wide loops below are the parity guard.

const test   = require('node:test');
const assert = require('node:assert');

const {
    EXPRESSION_TAGS,
    forRole,
    hasRole,
} = require('../out/expressionTags');
const { EXPRESSION_CONTENT_TAGS } = require('../out/designSpec');
const { combinedFormatterEdits } = require('../out/xmlRules');
const { lintXml } = require('../out/xmlLint');
const { collectTextCheckIssues } = require('../out/textCheck');

const FORMAT_STEPS = {
    reportName: false,
    positionType: false,
    textAdjust: false,
    expression: true,
    textcheck: false,
};

function reportWith(tag, body) {
    return `<jasperReport name="R">
  <field name="a" class="java.lang.String"/>
  <${tag}><![CDATA[${body}]]></${tag}>
</jasperReport>`;
}

test('the formatter handles every registry tag', () => {
    for (const tag of EXPRESSION_TAGS) {
        const edits = combinedFormatterEdits(reportWith(tag, 'a&&b'), 'R.jrxml', FORMAT_STEPS);
        assert.ok(
            edits.some(edit => edit.replacement.includes('a && b')),
            `no format edit for <${tag}>`,
        );
    }
});

test('null-dereference lint handles every registry tag', () => {
    for (const tag of EXPRESSION_TAGS) {
        const { findings } = lintXml(reportWith(tag, '$F{a}.trim()'), {
            uncheckedNullDereference: true,
        });
        assert.ok(
            findings.some(finding => finding.code === 'jrxml.lint.uncheckedNullDereference'),
            `no null-dereference finding for <${tag}>`,
        );
    }
});

test('text-check handles every registry tag', () => {
    for (const tag of EXPRESSION_TAGS) {
        const issues = collectTextCheckIssues(reportWith(tag, '"a  b"'));
        assert.ok(issues.length > 0, `no text-check issue for <${tag}>`);
        assert.ok(
            issues.some(issue => issue.edit && issue.edit.replacement.includes('"a b"')),
            `wrong text-check fix for <${tag}>`,
        );
    }
});

test('the confirmed gap tags are registered and handled', () => {
    for (const tag of ['filterExpression', 'labelExpression', 'patternExpression', 'textExpression']) {
        assert.ok(EXPRESSION_TAGS.includes(tag), `${tag} missing from the registry`);
        assert.ok(hasRole(tag, 'format'), `${tag} missing the format role`);
        assert.ok(hasRole(tag, 'textcheck'), `${tag} missing the textcheck role`);
    }

    assert.ok(lintXml(reportWith('filterExpression', '$F{a}.trim()'), {
        uncheckedNullDereference: true,
    }).findings.some(finding => finding.code === 'jrxml.lint.uncheckedNullDereference'));
});

test('the design-content list is the registry projection', () => {
    assert.deepStrictEqual(
        [...EXPRESSION_CONTENT_TAGS].sort(),
        [...forRole('designContent')].sort(),
    );
});
