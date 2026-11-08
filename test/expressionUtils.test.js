// test/expressionUtils.test.js
// expressionUtils lazily requires 'vscode' inside findExpressionAtCursor, so we
// install a tiny stub before loading the module.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const Module = require('node:module');

class FakeRange {
    constructor(start, end) { this.start = start; this.end = end; }
}

// Keep the stub installed for the whole file: the module resolves 'vscode' at
// call time, not at require time.
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return { Range: FakeRange };
    return originalLoad.call(this, request, ...rest);
};

const {
    findExpressionAtCursor,
    findTagReplacement,
    findReferenceToken,
    findDeclarationAtOffset,
    stripCdata,
    wrapExpression,
    hasCdata,
    EXPRESSION_TAGS,
} = require('../expressionUtils');

function fakeDocument(text) {
    return {
        getText: () => text,
        offsetAt: offset => offset,
        positionAt: offset => offset,
    };
}

test('stripCdata removes the wrapper and trims', () => {
    assert.strictEqual(stripCdata('<![CDATA[$F{a}]]>'), '$F{a}');
    assert.strictEqual(stripCdata('  <![CDATA[ $F{a} ]]>  '), '$F{a}');
    assert.strictEqual(stripCdata('$F{a}'), '$F{a}');
});

test('hasCdata detects the wrapper', () => {
    // hasCdata only inspects the opening marker — it is used to decide whether
    // to re-wrap, not to validate the content.
    assert.strictEqual(hasCdata('<![CDATA[x]]>'), true);
    assert.strictEqual(hasCdata('  <![CDATA[x]]>'), true);
    assert.strictEqual(hasCdata('$F{a}'), false);
    assert.strictEqual(hasCdata('x'), false);
});

test('wrapExpression only wraps when asked', () => {
    assert.strictEqual(wrapExpression('$F{a}', true), '<![CDATA[$F{a}]]>');
    assert.strictEqual(wrapExpression('$F{a}', false), '$F{a}');
});

test('EXPRESSION_TAGS contains the common expression elements', () => {
    for (const tag of ['textFieldExpression', 'printWhenExpression', 'variableExpression', 'jr:expression']) {
        assert.ok(EXPRESSION_TAGS.includes(tag), `missing ${tag}`);
    }
});

// ── Registry / grammar parity ───────────────────────────────────────────────
// The editor, completion, formatting, diagnostics and used-name collection all
// read EXPRESSION_TAGS, while the TextMate grammar carries its own copy of the
// same list. These tests are the guard against the two drifting apart.

const grammar = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'syntaxes', 'jrxml.tmLanguage.json'), 'utf8')
);
const expressionRule = grammar.repository.expression_tag.patterns[0];

/** Tags inside the `(?:a|b|c)` alternation of a grammar regex. */
function grammarTags(source, open, close) {
    const start = source.indexOf(open);
    assert.notStrictEqual(start, -1, `missing ${open} in ${source.slice(0, 60)}…`);
    const from = start + open.length;
    const end  = source.indexOf(close, from);
    assert.notStrictEqual(end, -1, `missing ${close} in ${source.slice(0, 60)}…`);
    return source.slice(from, end).split('|');
}

test('every expression tag highlighted by the grammar is in the shared registry', () => {
    const tags = grammarTags(expressionRule.begin, '<(?:', ')(?=');
    const missing = tags.filter(tag => !EXPRESSION_TAGS.includes(tag));

    assert.deepStrictEqual(missing, [], `grammar-only tags: ${missing.join(', ')}`);
});

test('every registry tag is highlighted by the grammar', () => {
    const tags = new Set(grammarTags(expressionRule.begin, '<(?:', ')(?='));
    const missing = EXPRESSION_TAGS.filter(tag => !tags.has(tag));

    assert.deepStrictEqual(missing, [], `registry-only tags: ${missing.join(', ')}`);
});

test('the grammar opens and closes the same expression tags', () => {
    const begin = grammarTags(expressionRule.begin, '<(?:', ')(?=').sort();
    const end   = grammarTags(expressionRule.end,   '</(?:', ')>').sort();

    assert.deepStrictEqual(end, begin);
});

test('the expression editor recognizes every registry tag at the cursor', () => {
    for (const tag of EXPRESSION_TAGS) {
        const text = `<jasperReport><${tag}><![CDATA[$F{x}]]></${tag}></jasperReport>`;
        const offset = text.indexOf('$F{x}') + 2;
        const result = findExpressionAtCursor(fakeDocument(text), offset);

        assert.ok(result, `no expression found for <${tag}>`);
        assert.strictEqual(result.tagName, tag);
    }
});

test('findExpressionAtCursor returns the enclosing expression', () => {
    const text = '<jasperReport><textFieldExpression><![CDATA[$F{a} + 1]]></textFieldExpression></jasperReport>';
    const offset = text.indexOf('$F{a}') + 2;

    const result = findExpressionAtCursor(fakeDocument(text), offset);
    assert.ok(result, 'expected a match');
    assert.strictEqual(result.tagName, 'textFieldExpression');
    assert.strictEqual(result.expression, '$F{a} + 1');
    assert.ok(result.range instanceof FakeRange);
});

test('findExpressionAtCursor returns null outside expression tags', () => {
    const text = '<jasperReport><field name="a"/></jasperReport>';
    assert.strictEqual(findExpressionAtCursor(fakeDocument(text), 3), null);
});

test('findExpressionAtCursor matches jr:expression', () => {
    const text = '<jr:expression><![CDATA[$P{x}]]></jr:expression>';
    const result = findExpressionAtCursor(fakeDocument(text), 4);
    assert.ok(result);
    assert.strictEqual(result.tagName, 'jr:expression');
    assert.strictEqual(result.expression, '$P{x}');
});

test('findExpressionAtCursor does not span a mismatched closing tag', () => {
    const text = '<textFieldExpression><![CDATA[$F{a}]]></variableExpression>';
    assert.strictEqual(findExpressionAtCursor(fakeDocument(text), 20), null);
});

// ── findTagReplacement ───────────────────────────────────────────────────────

test('findTagReplacement replaces only the target tag and preserves CDATA', () => {
    const text = [
        '<jasperReport>',
        '\t<textFieldExpression><![CDATA[$F{a}]]></textFieldExpression>',
        '\t<expression><![CDATA[$F{b}]]></expression>',
        '</jasperReport>',
    ].join('\n');
    const tagStart = text.indexOf('<textFieldExpression>');

    const replacement = findTagReplacement(text, 'textFieldExpression', tagStart, '$F{a} + 1');
    assert.ok(replacement, 'expected a replacement');
    assert.ok(replacement.useCdata);
    assert.strictEqual(
        replacement.newTag,
        '<textFieldExpression><![CDATA[$F{a} + 1]]></textFieldExpression>'
    );
    assert.strictEqual(replacement.startOffset, tagStart);
    assert.strictEqual(
        replacement.endOffset,
        tagStart + '<textFieldExpression><![CDATA[$F{a}]]></textFieldExpression>'.length
    );
    assert.ok(text.includes('<expression><![CDATA[$F{b}]]></expression>'), 'other tags untouched');
});

test('findTagReplacement picks the occurrence closest to the original offset', () => {
    const text = [
        '<expression><![CDATA[$F{a}]]></expression>',
        '<expression><![CDATA[$F{b}]]></expression>',
    ].join('\n');
    const second = text.indexOf('<expression>', 1);

    const replacement = findTagReplacement(text, 'expression', second, '$F{b} + 1');
    assert.ok(replacement);
    assert.strictEqual(replacement.startOffset, second);
    assert.ok(text.slice(second).startsWith('<expression><![CDATA[$F{b}]]></expression>'));
});

test('findTagReplacement writes plain text when the original had no CDATA', () => {
    const text = '<expression>$F{a}</expression>';
    const replacement = findTagReplacement(text, 'expression', 0, '$P{limit}');
    assert.ok(replacement);
    assert.strictEqual(replacement.useCdata, false);
    assert.strictEqual(replacement.newTag, '<expression>$P{limit}</expression>');
});

test('findTagReplacement returns null when the tag is missing', () => {
    assert.strictEqual(findTagReplacement('<jasperReport/>', 'expression', 0, 'x'), null);
    assert.strictEqual(findTagReplacement('', 'expression', 0, 'x'), null);
});

test('findTagReplacement keeps the opening tag attributes', () => {
    const text = '<expression class="java.lang.String">$F{a}</expression>';
    const replacement = findTagReplacement(text, 'expression', 0, '$F{b}');
    assert.ok(replacement);
    assert.strictEqual(
        replacement.newTag,
        '<expression class="java.lang.String">$F{b}</expression>'
    );
});

// ── Reference / declaration lookup ─────────────────────────────────────────

test('findReferenceToken finds the token under the cursor', () => {
    const line = 'IF($F{status} == null, $P{fallback}, $V{PAGE_NUMBER})';
    const field = findReferenceToken(line, line.indexOf('$F{status}') + 3);
    assert.deepStrictEqual(field, {
        sigil: 'F', name: 'status', start: line.indexOf('$F{status}'), end: line.indexOf('$F{status}') + '$F{status}'.length,
    });
    assert.strictEqual(findReferenceToken(line, line.indexOf('$P{fallback}') + 2).sigil, 'P');
    assert.strictEqual(findReferenceToken(line, 0), null);
    assert.strictEqual(findReferenceToken('plain text', 4), null);
});

test('findReferenceToken supports dotted names', () => {
    const line = 'X.equals($F{customer.name})';
    const token = findReferenceToken(line, line.indexOf('$F{customer.name}') + 4);
    assert.strictEqual(token.name, 'customer.name');
});

test('findDeclarationAtOffset finds declaration name attributes', () => {
    const text = '<field name="status"/><parameter name="limit"/><variable name="total"/>';
    const parsed = {
        allFields:     [{ name: 'status', nameOffset: text.indexOf('"status"') + 1 }],
        allParameters: [{ name: 'limit',  nameOffset: text.indexOf('"limit"') + 1 }],
        allVariables:  [{ name: 'total',  nameOffset: text.indexOf('"total"') + 1 }],
    };

    assert.strictEqual(findDeclarationAtOffset(parsed, text.indexOf('status') + 2).name, 'status');
    assert.strictEqual(findDeclarationAtOffset(parsed, text.indexOf('limit') + 2).sigil, 'P');
    assert.strictEqual(findDeclarationAtOffset(parsed, text.indexOf('total') + 2).sigil, 'V');
    assert.strictEqual(findDeclarationAtOffset(parsed, 0), null);
    assert.strictEqual(findDeclarationAtOffset(null, 5), null);
});
