// test/definitionProvider.test.js
// definitionProvider requires 'vscode' at load time, so a stub is installed
// before the module is required. The registered provider is exercised with a
// fake document: cursor position in, Location (or null) out.

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

class FakeRange {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

class FakeLocation {
    constructor(uri, range) {
        this.uri = uri;
        this.range = range;
    }
}

let registered = null;

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return {
            Range: FakeRange,
            Location: FakeLocation,
            languages: {
                registerDefinitionProvider: (_selector, provider) => {
                    registered = provider;
                    return { dispose() {} };
                },
            },
        };
    }
    return originalLoad.call(this, request, ...rest);
};

require('../definitionProvider');
const provider = registered;

let seq = 0;

/** Minimal TextDocument stub with the line/position APIs the provider uses. */
function makeDoc(text) {
    const uri = { toString: () => `file:///definition-${seq++}.jrxml` };
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1);
    }

    return {
        uri,
        version: 1,
        getText: () => text,
        positionAt(offset) {
            let line = 0;
            while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
            return { line, character: offset - lineStarts[line] };
        },
        offsetAt(position) { return lineStarts[position.line] + position.character; },
        lineAt(position) {
            const start = lineStarts[position.line];
            const next  = position.line + 1 < lineStarts.length ? lineStarts[position.line + 1] : text.length;
            return { text: text.slice(start, next).replace(/\r?\n$/, '') };
        },
    };
}

function positionAt(text, offset) {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length - 1, character: before[before.length - 1].length };
}

function offsetAt(text, position) {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line; i++) offset += lines[i].length + 1;
    return offset + position.character;
}

test('Ctrl+Click jumps from $F{name} to its declaration', () => {
    const text = `<jasperReport name="R">
  <field name="amount" class="java.math.BigDecimal"/>
  <expression><![CDATA[$F{amount}]]></expression>
</jasperReport>`;
    const offset = text.indexOf('$F{amount}') + 3;

    const location = provider.provideDefinition(makeDoc(text), positionAt(text, offset));
    assert.ok(location, 'expected a definition');
    assert.strictEqual(offsetAt(text, location.range.start), text.indexOf('"amount"') + 1);
});

test('Ctrl+Click navigates $P!{} query fragments', () => {
    const text = `<jasperReport name="R">
  <parameter name="Clause" class="java.lang.String"/>
  <query language="sql"><![CDATA[WHERE x = $P!{Clause}]]></query>
</jasperReport>`;
    // Cursor on the `!` character.
    const offset = text.indexOf('$P!{Clause}') + 2;

    const location = provider.provideDefinition(makeDoc(text), positionAt(text, offset));
    assert.ok(location, 'expected $P!{} to resolve');
    assert.strictEqual(offsetAt(text, location.range.start), text.indexOf('"Clause"') + 1);
});

test('resolves the dataset declaration when a report and dataset name collide', () => {
    const text = `<jasperReport name="R">
  <field name="shared" class="java.lang.String"/>
  <dataset name="DS">
    <field name="shared" class="java.lang.Integer"/>
    <filterExpression><![CDATA[$F{shared}]]></filterExpression>
  </dataset>
</jasperReport>`;
    const cursor = text.indexOf('$F{shared}') + 3;
    const expected = text.lastIndexOf('"shared"') + 1;

    const location = provider.provideDefinition(makeDoc(text), positionAt(text, cursor));
    assert.ok(location, 'expected a dataset definition');
    assert.strictEqual(offsetAt(text, location.range.start), expected);
});

test('returns null for an undeclared reference or outside a token', () => {
    const text = '<jasperReport name="R"><expression><![CDATA[$P{Missing}]]></expression></jasperReport>';
    const doc  = makeDoc(text);

    assert.strictEqual(
        provider.provideDefinition(doc, positionAt(text, text.indexOf('$P{Missing}') + 3)),
        null
    );
    assert.strictEqual(provider.provideDefinition(doc, { line: 0, character: 0 }), null);
});
