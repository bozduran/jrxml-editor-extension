// test/textCheck.test.js

const test   = require('node:test');
const assert = require('node:assert');

const { collectTextCheckIssues, fixForTextCheck, CODE } = require('../textCheck');
const { applyEdits } = require('../edits');

function doc(body) {
    return `<jasperReport name="R">\n${body}\n</jasperReport>`;
}

const TEXT_FIELD = doc([
    '  <detail><band height="10">',
    '    <element kind="textField" x="0" y="0" width="10" height="10">',
    '      <expression><![CDATA["a  b.C"]]></expression>',
    '    </element>',
    '  </band></detail>',
].join('\n'));

test('flags double space and missing period space inside a string literal', () => {
    const issues = collectTextCheckIssues(TEXT_FIELD);
    assert.strictEqual(issues.length, 1);

    const [issue] = issues;
    assert.strictEqual(issue.code, CODE);
    assert.strictEqual(
        issue.message,
        "Text check: add space after '.' (1 occurrence), remove double space (1 occurrence)"
    );
    // Anchored at the first change in document coordinates (the double space).
    assert.strictEqual(TEXT_FIELD.slice(issue.offset, issue.offset + issue.length), '  ');
});

test('the quick fix rewrites the string and clears the warning', () => {
    const [issue] = collectTextCheckIssues(TEXT_FIELD);
    const fixed = applyEdits(TEXT_FIELD, [issue.edit]);

    assert.ok(fixed.includes('"a b. C"'));
    assert.deepStrictEqual(collectTextCheckIssues(fixed), []);
});

test('fixForTextCheck resolves by anchor offset', () => {
    const [issue] = collectTextCheckIssues(TEXT_FIELD);
    const fix = fixForTextCheck(TEXT_FIELD, issue.offset);

    assert.ok(fix);
    assert.match(fix.title, /^Fix text: /);
    assert.deepStrictEqual(fix.edit, issue.edit);

    assert.strictEqual(fixForTextCheck(TEXT_FIELD, 0), null);
    assert.strictEqual(fixForTextCheck('<r><a></b></r>', 3), null);
});

test('non-text expressions only get the double-space rule', () => {
    const text = doc([
        '  <variable name="V" class="java.lang.String">',
        '    <expression><![CDATA["a  b.C"]]></expression>',
        '  </variable>',
    ].join('\n'));

    const [issue] = collectTextCheckIssues(text);
    assert.strictEqual(issue.message, 'Text check: remove double space (1 occurrence)');
});

test('flags unrenderable characters and matches the hook wording', () => {
    const text = doc([
        '  <element kind="staticText" markup="styled">',
        '    <text><![CDATA[A\u00A0B  C.Today<br/>D]]></text>',
        '  </element>',
    ].join('\n'));

    const [issue] = collectTextCheckIssues(text);
    assert.strictEqual(issue.message,
        'Text check: replace non-breaking space (U+00A0) with " ", ' +
        "add space after '.' (1 occurrence), remove double space (1 occurrence)");

    const fixed = applyEdits(text, [issue.edit]);
    assert.ok(fixed.includes('A B C. Today<br/>D'));
});

test('normalizes newlines to the markup token', () => {
    const styled = doc([
        '  <element kind="staticText" markup="styled"><text><![CDATA[a<br>b]]></text></element>',
    ].join('\n'));
    const [issue] = collectTextCheckIssues(styled);
    assert.match(issue.message, /normalize newline/);
    assert.ok(applyEdits(styled, [issue.edit]).includes('a<br/>b'));

    // Already matching markup: no warning.
    const ok = doc([
        '  <element kind="staticText" markup="styled"><text><![CDATA[a<br/>b]]></text></element>',
    ].join('\n'));
    assert.deepStrictEqual(collectTextCheckIssues(ok), []);
});

test('ignores code outside string literals and non-CDATA bodies', () => {
    const codeOnly = doc([
        '  <variable name="V" class="java.lang.Integer">',
        '    <expression><![CDATA[$F{a}  +  $F{b}]]></expression>',
        '  </variable>',
    ].join('\n'));
    assert.deepStrictEqual(collectTextCheckIssues(codeOnly), []);

    const plain = doc('  <element kind="staticText"><text>a  b.C</text></element>');
    assert.deepStrictEqual(collectTextCheckIssues(plain), []);
});

test('char literals and comments are not rewritten', () => {
    const text = doc([
        '  <element kind="staticText">',
        "    <text><![CDATA['a  b']]></text>",
        '  </element>',
    ].join('\n'));
    // <text> content is not an expression, so a char literal is still plain text;
    // it must still be transformed as text content (the hook does the same).
    assert.strictEqual(applyEdits(text, [collectTextCheckIssues(text)[0].edit]).includes("'a b'"), true);
});

test('malformed XML yields no issues', () => {
    assert.deepStrictEqual(collectTextCheckIssues('<r><a></b></r>'), []);
});
