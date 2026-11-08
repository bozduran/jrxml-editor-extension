// test/completionProvider.test.js
// completionProvider requires 'vscode' at load time, so a stub is installed
// before the module is required. The provider is exercised end to end: document
// text in, CompletionItems out — covering both the typed-member path and the
// legacy list it must fall back to.

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

let settings = {};

class FakeCompletionItem {
    constructor(label, kind) {
        this.label = label;
        this.kind = kind;
        this.detail = null;
        this.documentation = null;
        this.insertText = null;
        this.filterText = null;
        this.sortText = null;
        this.tags = undefined;
    }
}

class FakeSnippetString {
    constructor(value) { this.value = value; }
    toString() { return this.value; }
}

class FakeMarkdownString {
    constructor(value) { this.value = value; }
    toString() { return this.value; }
}

let registered = null;

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return {
            CompletionItem: FakeCompletionItem,
            CompletionItemKind: { Text: 0, Method: 2, Field: 5, Variable: 6, Class: 7, Function: 3, TypeParameter: 25, Reference: 18 },
            CompletionItemTag: { Deprecated: 1 },
            SnippetString: FakeSnippetString,
            MarkdownString: FakeMarkdownString,
            languages: {
                registerCompletionItemProvider: (_selector, provider) => {
                    registered = provider;
                    return { dispose() {} };
                },
            },
            workspace: {
                getConfiguration: () => ({ get: (key, fallback) => (key in settings ? settings[key] : fallback) }),
                workspaceFolders: null,
                onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
                onDidSaveTextDocument: () => ({ dispose() {} }),
                onDidCreateFiles: () => ({ dispose() {} }),
                onDidDeleteFiles: () => ({ dispose() {} }),
                onDidRenameFiles: () => ({ dispose() {} }),
            },
        };
    }
    return originalLoad.call(this, request, ...rest);
};

// The module exports the registration disposable; the provider object itself is
// what the stub captured.
require('../completionProvider');
const provider = registered;

let seq = 0;

/** Build a document stub with the offset/line APIs the provider uses. */
function makeDoc(text) {
    const id = `file:///completion-${seq++}.jrxml`;
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1);
    }
    return {
        uri: { toString: () => id },
        version: 1,
        getText: () => text,
        offsetAt: (position) => lineStarts[position.line] + position.character,
        // The real API accepts either a line number or a Position.
        lineAt: (lineOrPosition) => {
            const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
            return { text: text.split('\n')[line] ?? '' };
        },
    };
}

function positionAt(text, index) {
    const before = text.slice(0, index);
    const line = before.split('\n').length - 1;
    const lastBreak = before.lastIndexOf('\n');
    return { line, character: index - (lastBreak + 1) };
}

const DECLARATIONS = [
    '<field name="CustomerName" class="java.lang.String"/>',
    '<field name="Unset"/>',
    '<field name="Items" class="java.util.List"/>',
    '<field name="When" class="java.sql.Timestamp"/>',
    '<field name="Custom" class="com.acme.Customer"/>',
    '<field name="Ambiguous" class="Date"/>',
    '<parameter name="Total" class="java.math.BigDecimal"/>',
    '<variable name="Count" class="java.lang.Integer" calculation="Count">',
    '  <variableExpression><![CDATA[1]]></variableExpression>',
    '</variable>',
].join('\n  ');

function report(expression, declarations = DECLARATIONS) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<jasperReport name="R">
  ${declarations}
  <detail>
    <band height="20">
      <textField>
        <reportElement x="0" y="0" width="100" height="20"/>
        <textFieldExpression><![CDATA[${expression}]]></textFieldExpression>
      </textField>
    </band>
  </detail>
</jasperReport>`;
}

/** Complete at the end of `expression` inside a report. */
function completeExpression(expression, options = {}) {
    settings = options.settings || {};
    const text = report(expression, options.declarations);
    // Anchor on the CDATA block: the same text can appear in the XML prolog.
    const open = `<![CDATA[${expression}`;
    const cursor = text.indexOf(open) + open.length;
    return provider.provideCompletionItems(makeDoc(text), positionAt(text, cursor), {});
}

/** The label is either a string or a CompletionItemLabel object. */
function labelOf(item) {
    return item.label && typeof item.label === 'object' ? item.label.label : item.label;
}

function labels(items) {
    return items.map(labelOf);
}

function find(items, name) {
    return items.find(item => labelOf(item) === name);
}

// ── Typed members ─────────────────────────────────────────────────────────────

test('a field receiver offers the members of its declared class', () => {
    const items = completeExpression('$F{CustomerName}.');

    const upper = find(items, 'toUpperCase');
    assert.ok(upper, `expected toUpperCase, got ${labels(items).slice(0, 8).join(', ')}`);
    assert.strictEqual(upper.kind, 2, 'methods are CompletionItemKind.Method');
    assert.strictEqual(upper.insertText.value, 'toUpperCase()');
    assert.strictEqual(upper.filterText, 'toUpperCase');
    assert.strictEqual(upper.detail, 'toUpperCase() : String');
    assert.match(upper.sortText, /^0_/);
    assert.match(upper.documentation.value, /java\.lang\.String/);
});

test('members complete after a partial name and inside a longer expression', () => {
    const items = completeExpression('$F{CustomerName} == null ? "x" : $F{CustomerName}.toU');
    assert.ok(find(items, 'toUpperCase'), 'the receiver before the dot is what counts');
});

test('overloads are separate items carrying their parameter types', () => {
    const items = completeExpression('$F{CustomerName}.');
    const substrings = items.filter(item => labelOf(item) === 'substring');
    assert.strictEqual(substrings.length, 2);
    assert.deepStrictEqual(substrings.map(i => i.label.detail), ['(int)', '(int, int)']);
    assert.deepStrictEqual(substrings.map(i => i.insertText.value), ['substring(${1:n})', 'substring(${1:n}, ${2:n2})']);
});

test('parameters and variables complete through their declared class', () => {
    const fromParameter = completeExpression('$P{Total}.');
    assert.ok(find(fromParameter, 'setScale'), 'BigDecimal member from a parameter');
    assert.ok(find(fromParameter, 'add'));

    const fromVariable = completeExpression('$V{Count}.');
    assert.ok(find(fromVariable, 'intValue'), 'Integer member from a variable');
});

test('built-in parameters resolve through the JasperReports type table', () => {
    const items = completeExpression('$P{REPORT_DATA_SOURCE}.');
    assert.ok(find(items, 'next'), 'JRDataSource.next');
    assert.ok(find(items, 'getFieldValue'));
});

test('a method chain keeps completing on the return type', () => {
    const items = completeExpression('$F{CustomerName}.trim().');
    assert.ok(find(items, 'toUpperCase'), 'trim() returns a String');
    assert.ok(find(items, 'length'));
});

test('inherited members are offered and marked as inherited', () => {
    const items = completeExpression('$F{When}.');
    const label = item => item.label.detail;

    // Timestamp declares before(Timestamp) and also inherits before(Date):
    // both are offered, the own one first.
    const befores = items.filter(item => labelOf(item) === 'before');
    assert.deepStrictEqual(befores.map(label), ['(Timestamp)', '(Date)']);

    const [own, inherited] = befores;
    assert.match(own.sortText, /^0_/, 'own members come first');
    assert.match(own.documentation.value, /Declared by `java\.sql\.Timestamp`/);

    assert.match(inherited.sortText, /^1_/, 'inherited members sort after own ones');
    assert.match(inherited.documentation.value, /Declared by `java\.util\.Date`/);
    assert.match(inherited.documentation.value, /Inherited for/);
});

test('the deprecated flag is surfaced as an item tag', () => {
    const items = completeExpression('$F{When}.getYear');
    const getYear = find(items, 'getYear');
    assert.ok(getYear);
    assert.deepStrictEqual(getYear.tags, [1]);
});

test('the configured JDK baseline decides which members are offered', () => {
    const java8 = completeExpression('$F{CustomerName}.');
    assert.ok(!find(java8, 'isBlank'), 'isBlank is Java 11');

    const java11 = completeExpression('$F{CustomerName}.', { settings: { 'typeCompletion.jdkBaseline': '11' } });
    assert.ok(find(java11, 'isBlank'));
});

// ── Hints ─────────────────────────────────────────────────────────────────────

test('a field without a class gets one hint that inserts nothing', () => {
    const items = completeExpression('$F{Unset}.');
    assert.strictEqual(items.length, 1, 'no member list can be produced, only the hint');

    const hint = items[0];
    assert.match(hint.label, /\$F\{Unset\} is not declared/);
    assert.match(hint.label, /class="\.\.\."/);
    assert.strictEqual(hint.insertText.value, '$0');
    assert.match(hint.documentation.value, /class="java\.lang\.String"/);
});

test('an unindexed class explains what the index covers', () => {
    const items = completeExpression('$F{Custom}.');
    assert.strictEqual(items.length, 1);
    assert.match(items[0].label, /com\.acme\.Customer is not in the type index/);
});

test('an ambiguous short class name lists the alternatives', () => {
    const items = completeExpression('$F{Ambiguous}.');
    assert.strictEqual(items.length, 1);
    assert.match(items[0].label, /java\.util\.Date and java\.sql\.Date/);
});

test('an undeclared reference falls back to the normal list instead of a hint', () => {
    const items = completeExpression('$F{Mystery}.');
    assert.ok(items.length > 1, 'the legacy list is offered');
    assert.ok(find(items, 'TODAY'), 'Jasper built-ins are still there');
});

// ── Dataset scope ────────────────────────────────────────────────────────────

const SCOPED_DECLARATIONS = [
    '<field name="ReportField" class="java.lang.String"/>',
    '<dataset name="DS">',
    '  <field name="DatasetField" class="java.lang.Integer"/>',
    '  <filterExpression><![CDATA[%EXPR%]]></filterExpression>',
    '</dataset>',
    '<detail><band>',
    '  <element kind="component"><component kind="list">',
    '    <datasetRun subDataset="DS"/>',
    '    <contents><element kind="textField"><expression><![CDATA[%EXPR%]]></expression></element></contents>',
    '  </component></element>',
    '</band></detail>',
].join('\n  ');

/** Complete at the end of the expression in the dataset definition. */
function completeInDatasetDefinition(expression) {
    settings = {};
    const text = `<jasperReport name="R">\n  ${SCOPED_DECLARATIONS.replaceAll('%EXPR%', expression)}\n</jasperReport>`;
    const open = `<![CDATA[${expression}`;
    const cursor = text.indexOf(open) + open.length;
    return provider.provideCompletionItems(makeDoc(text), positionAt(text, cursor), {});
}

/** Complete at the end of the expression in a list's dataset-run contents. */
function completeInListContents(expression) {
    settings = {};
    const text = `<jasperReport name="R">\n  ${SCOPED_DECLARATIONS.replaceAll('%EXPR%', expression)}\n</jasperReport>`;
    const open = `<![CDATA[${expression}`;
    const cursor = text.lastIndexOf(open) + open.length;
    return provider.provideCompletionItems(makeDoc(text), positionAt(text, cursor), {});
}

test('inside a dataset only that dataset’s fields are offered', () => {
    const names = labels(completeInDatasetDefinition('$F{'));

    assert.ok(names.includes('DatasetField'), 'dataset field is offered');
    assert.ok(!names.includes('ReportField'), 'master field is not');
});

test('inside a list dataset-run consumer only the run dataset’s fields are offered', () => {
    const names = labels(completeInListContents('$F{'));

    assert.ok(names.includes('DatasetField'));
    assert.ok(!names.includes('ReportField'));
});

test('outside datasets only report-scope fields are offered', () => {
    settings = {};
    const text = report('$F{', [
        '<field name="ReportField" class="java.lang.String"/>',
        '<dataset name="DS"><field name="DatasetField" class="java.lang.Integer"/></dataset>',
    ].join('\n  '));
    const open = '<![CDATA[$F{';
    const cursor = text.indexOf(open) + open.length;
    const names = labels(provider.provideCompletionItems(makeDoc(text), positionAt(text, cursor), {}));

    assert.ok(names.includes('ReportField'));
    assert.ok(!names.includes('DatasetField'));
});

// ── Falling back ──────────────────────────────────────────────────────────────

test('a decimal point does not start member completion', () => {
    const items = completeExpression('1.5');
    assert.ok(find(items, 'TODAY'), 'legacy list, not members');
    assert.ok(!find(items, 'toUpperCase'));
});

test('settings can turn typed completion off entirely', () => {
    const items = completeExpression('$F{CustomerName}.', { settings: { 'typeCompletion.enabled': false } });
    assert.ok(find(items, 'TODAY'), 'legacy list is unchanged');
    assert.ok(!find(items, 'toUpperCase'));
});

test('completion outside an expression tag is empty', () => {
    const text = '<jasperReport name="R"><field name="A" class="java.lang.String"/></jasperReport>';
    settings = {};
    const cursor = text.indexOf('</jasperReport>');
    assert.deepStrictEqual(provider.provideCompletionItems(makeDoc(text), positionAt(text, cursor), {}), []);
});

test('the legacy contexts still work', () => {
    const insideField = completeExpression('$F{');
    assert.ok(labels(insideField).includes('CustomerName'), '$F{ lists the fields');

    const insideParameter = completeExpression('$P{');
    assert.ok(labels(insideParameter).includes('Total'));

    const insideVariable = completeExpression('$V{');
    assert.ok(labels(insideVariable).includes('Count'));

    const afterDollar = completeExpression('$');
    assert.deepStrictEqual(labels(afterDollar), ['$F{', '$P{', '$V{', '$R{']);
});

test('a single dot without a receiver falls back instead of erroring', () => {
    const items = completeExpression('.');
    assert.ok(items.length > 1);
    assert.ok(find(items, 'TODAY'));
});
