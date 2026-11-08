// test/definitionProvider.test.js
// definitionProvider requires 'vscode' at load time, so a stub is installed
// before the module is required. The registered provider is exercised with a
// fake document: cursor position in, Location (or null) out.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const Module = require('node:module');

class FakeRange {
    // vscode.Range accepts either two Positions or four line/character numbers.
    constructor(start, end, endLine, endCharacter) {
        if (typeof start === 'number') {
            this.start = { line: start, character: end };
            this.end   = { line: endLine, character: endCharacter };
        } else {
            this.start = start;
            this.end = end;
        }
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
            Uri: { file: (fsPath) => ({ fsPath, toString: () => `file://${fsPath}` }) },
            languages: {
                registerDefinitionProvider: (_selector, provider) => {
                    registered = provider;
                    return { dispose() {} };
                },
            },
            workspace: { workspaceFolders: null },
        };
    }
    return originalLoad.call(this, request, ...rest);
};

require('../definitionProvider');
const provider = registered;

let seq = 0;

/** Minimal TextDocument stub with the line/position APIs the provider uses. */
function makeDoc(text, fileName) {
    const uri = { toString: () => `file:///definition-${seq++}.jrxml` };
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1);
    }

    return {
        uri,
        fileName: fileName || '/test/report.jrxml',
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

test('go-to-definition jumps to the key line in the properties file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-definition-'));
    const properties = path.join(dir, 'messages.properties');
    fs.writeFileSync(properties, '# header\ntitle = Welcome\nbody=Body\n');

    const text = `<jasperReport name="R" resourceBundle="messages">
  <expression><![CDATA[$R{body}]]></expression>
</jasperReport>`;
    const location = provider.provideDefinition(
        makeDoc(text, path.join(dir, 'report.jrxml')),
        positionAt(text, text.indexOf('$R{body}') + 3)
    );

    assert.ok(location, 'expected a resource-key definition');
    assert.strictEqual(location.uri.fsPath, properties);
    assert.strictEqual(location.range.start.line, 2);
    assert.strictEqual(location.range.start.character, 0);
    assert.strictEqual(location.range.end.character, 'body'.length);
});

test('go-to-definition returns null for a missing resource key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-definition-'));
    fs.writeFileSync(path.join(dir, 'messages.properties'), 'title=Welcome\n');

    const text = `<jasperReport name="R" resourceBundle="messages">
  <expression><![CDATA[$R{missing}]]></expression>
</jasperReport>`;
    assert.strictEqual(
        provider.provideDefinition(
            makeDoc(text, path.join(dir, 'report.jrxml')),
            positionAt(text, text.indexOf('$R{missing}') + 3)
        ),
        null
    );
});
