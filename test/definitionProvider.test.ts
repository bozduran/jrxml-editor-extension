// test/definitionProvider.test.ts
// definitionProvider requires 'vscode' at load time, so a stub is installed
// before the module is loaded. The registered provider is exercised with a
// fake document: cursor position in, Location (or null) out.
//
// The test is an ES module while the compiled host module is CommonJS, so the
// stub goes through Node's CJS loader: createRequire keeps that path, which a
// static `import` would bypass.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** A `vscode.Position`. */
interface FakePosition {
    line: number;
    character: number;
}

/** A `vscode.Uri`, as far as these tests read it. */
interface FakeUri {
    fsPath?: string;
    toString(): string;
}

class FakeRange {
    start: FakePosition;
    end: FakePosition;

    // vscode.Range accepts either two Positions or four line/character numbers.
    constructor(start: FakePosition, end: FakePosition);
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    constructor(start: FakePosition | number, end: FakePosition | number, endLine?: number, endCharacter?: number) {
        if (typeof start === 'number') {
            this.start = { line: start, character: end as number };
            this.end   = { line: endLine as number, character: endCharacter as number };
        } else {
            this.start = start;
            this.end = end as FakePosition;
        }
    }
}

class FakeLocation {
    uri: FakeUri;
    range: FakeRange;

    constructor(uri: FakeUri, range: FakeRange) {
        this.uri = uri;
        this.range = range;
    }
}

/** The slice of a `vscode.TextDocument` the definition provider touches. */
interface FakeDocument {
    uri: { toString(): string };
    fileName: string;
    version: number;
    getText(): string;
    positionAt(offset: number): FakePosition;
    offsetAt(position: FakePosition): number;
    lineAt(position: FakePosition): { text: string };
}

/** The registered provider object the test exercises. */
interface DefinitionProvider {
    provideDefinition(document: FakeDocument, position: FakePosition): FakeLocation | null;
}

/** The slice of the vscode API the definition provider imports. */
interface VscodeStub {
    Range: typeof FakeRange;
    Location: typeof FakeLocation;
    Uri: { file(fsPath: string): FakeUri };
    languages: {
        registerDefinitionProvider(selector: unknown, provider: DefinitionProvider): { dispose(): void };
    };
    workspace: { workspaceFolders: null };
}

let registered: DefinitionProvider | null = null;

/** Node's internal CJS loader hook: the only way to stub `vscode`. */
interface LoaderHost {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const loader = Module as unknown as LoaderHost;
const originalLoad = loader._load;
loader._load = (request: string, parent: unknown, isMain: boolean): unknown => {
    if (request === 'vscode') {
        const stub: VscodeStub = {
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
        return stub;
    }
    return originalLoad.call(loader, request, parent, isMain);
};

require('../out/definitionProvider.js');
assert.ok(registered, 'definitionProvider must register a provider');
const provider: DefinitionProvider = registered;

let seq = 0;

/** Minimal TextDocument stub with the line/position APIs the provider uses. */
function makeDoc(text: string, fileName?: string): FakeDocument {
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

function positionAt(text: string, offset: number): FakePosition {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length - 1, character: before[before.length - 1].length };
}

function offsetAt(text: string, position: FakePosition): number {
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

test('Ctrl+Click on a subreport literal opens the target report', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-def-sub-'));
    const target = path.join(dir, 'detail.jrxml');
    fs.writeFileSync(target, '<jasperReport name="D"/>');

    const text = `<jasperReport name="M">
  <subreport>
    <subreportExpression><![CDATA["detail.jrxml"]]></subreportExpression>
  </subreport>
</jasperReport>`;
    const cursor = text.indexOf('detail.jrxml') + 3;

    const location = provider.provideDefinition(
        makeDoc(text, path.join(dir, 'master.jrxml')),
        positionAt(text, cursor)
    );

    assert.ok(location, 'expected the subreport source');
    assert.strictEqual(location.uri.fsPath, target);
});

test('returns null for a missing subreport target', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-def-sub-'));
    const text = `<jasperReport name="M">
  <subreport>
    <subreportExpression><![CDATA["missing.jrxml"]]></subreportExpression>
  </subreport>
</jasperReport>`;
    const cursor = text.indexOf('missing.jrxml') + 3;

    assert.strictEqual(
        provider.provideDefinition(
            makeDoc(text, path.join(dir, 'master.jrxml')),
            positionAt(text, cursor)
        ),
        null
    );
});
