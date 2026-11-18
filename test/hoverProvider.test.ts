// test/hoverProvider.test.ts
// hoverProvider requires 'vscode' at load time, so a stub is installed before
// the module is loaded. The registered provider is exercised with a fake
// document: cursor position in, Hover markdown out.
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

class FakeRange {
    start: FakePosition;
    end: FakePosition;

    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
        this.start = { line: startLine, character: startCharacter };
        this.end   = { line: endLine, character: endCharacter };
    }
}

class FakeMarkdownString {
    value: string;

    constructor(value = '') { this.value = value; }

    appendMarkdown(text: string): this { this.value += text; return this; }
}

class FakeHover {
    contents: FakeMarkdownString;
    range: FakeRange | undefined;

    constructor(contents: FakeMarkdownString, range: FakeRange | undefined) {
        this.contents = contents;
        this.range = range;
    }
}

interface HoverProvider {
    provideHover(document: FakeDocument, position: FakePosition): FakeHover | null | undefined;
}

/** The slice of a `vscode.TextDocument` the hover provider touches. */
interface FakeDocument {
    uri: { toString(): string };
    fileName: string;
    version: number;
    getText(): string;
    offsetAt(position: FakePosition): number;
    lineAt(position: FakePosition | number): { text: string };
}

/** The slice of the vscode API the hover provider imports. */
interface VscodeStub {
    Range: typeof FakeRange;
    MarkdownString: typeof FakeMarkdownString;
    Hover: typeof FakeHover;
    languages: {
        registerHoverProvider(selector: unknown, provider: HoverProvider): { dispose(): void };
    };
    workspace: { workspaceFolders: null };
}

let registered: HoverProvider | null = null;

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
            MarkdownString: FakeMarkdownString,
            Hover: FakeHover,
            languages: {
                registerHoverProvider: (_selector, provider) => {
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

require('../out/hoverProvider.js');
assert.ok(registered, 'hoverProvider must register a provider');
const provider: HoverProvider = registered;

let seq = 0;

function makeDoc(text: string, fileName?: string): FakeDocument {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charAt(i) === '\n') lineStarts.push(i + 1);
    }
    const startOf = (line: number): number => lineStarts[line] ?? text.length;
    return {
        uri: { toString: () => `file:///hover-${seq++}.jrxml` },
        fileName: fileName || '/test/report.jrxml',
        version: 1,
        getText: () => text,
        offsetAt(position) { return startOf(position.line) + position.character; },
        lineAt(position) {
            const line = typeof position === 'number' ? position : position.line;
            const start = startOf(line);
            const next  = line + 1 < lineStarts.length ? startOf(line + 1) : text.length;
            return { text: text.slice(start, next).replace(/\r?\n$/, '') };
        },
    };
}

function positionAt(text: string, offset: number): FakePosition {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length - 1, character: (before[before.length - 1] ?? '').length };
}

function hoverAt(text: string, offset: number, fileName?: string): FakeHover | null | undefined {
    return provider.provideHover(makeDoc(text, fileName), positionAt(text, offset));
}

test('hover resolves the dataset declaration when a report and dataset name collide', () => {
    const text = `<jasperReport name="R">
  <field name="shared" class="java.lang.String"/>
  <dataset name="DS">
    <field name="shared" class="java.lang.Integer"/>
    <filterExpression><![CDATA[$F{shared}]]></filterExpression>
  </dataset>
</jasperReport>`;

    const hover = hoverAt(text, text.indexOf('$F{shared}') + 3);
    assert.ok(hover, 'expected a hover');
    assert.match(hover.contents.value, /java\.lang\.Integer/);
    assert.doesNotMatch(hover.contents.value, /java\.lang\.String/);
});

test('hover explains a master declaration that a dataset cannot see', () => {
    const text = `<jasperReport name="R">
  <field name="MasterField" class="java.lang.String"/>
  <dataset name="DS">
    <field name="DSField" class="java.lang.Integer"/>
    <filterExpression><![CDATA[$F{MasterField}]]></filterExpression>
  </dataset>
</jasperReport>`;

    const hover = hoverAt(text, text.indexOf('$F{MasterField}') + 3);
    assert.ok(hover, 'expected a hover');
    assert.match(hover.contents.value, /not available inside dataset/);
    assert.match(hover.contents.value, /report scope/i);
});

test('hover shows the $P!{} form used by query fragments', () => {
    const text = `<jasperReport name="R">
  <parameter name="Clause" class="java.lang.String"/>
  <query language="sql"><![CDATA[WHERE x = $P!{Clause}]]></query>
</jasperReport>`;

    const hover = hoverAt(text, text.indexOf('$P!{Clause}') + 4);
    assert.ok(hover, 'expected a hover');
    assert.match(hover.contents.value, /\$P!\{Clause\}/);
    assert.match(hover.contents.value, /java\.lang\.String/);
});

test('hover shows the resource value for $R{} keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-hover-'));
    fs.writeFileSync(path.join(dir, 'messages.properties'), 'title=Welcome aboard\n');
    fs.writeFileSync(path.join(dir, 'messages_fr.properties'), 'title=Bienvenue\n');

    const text = `<jasperReport name="R" resourceBundle="messages">
  <expression><![CDATA[$R{title}]]></expression>
</jasperReport>`;
    const hover = hoverAt(text, text.indexOf('$R{title}') + 3, path.join(dir, 'report.jrxml'));

    assert.ok(hover, 'expected a hover');
    assert.match(hover.contents.value, /Welcome aboard/);
    assert.match(hover.contents.value, /Bienvenue/);
});

test('hover explains a missing resource key or bundle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-hover-'));
    fs.writeFileSync(path.join(dir, 'messages.properties'), 'title=Welcome\n');

    const missingKey = `<jasperReport name="R" resourceBundle="messages">
  <expression><![CDATA[$R{missing}]]></expression>
</jasperReport>`;
    const hover = hoverAt(missingKey, missingKey.indexOf('$R{missing}') + 3, path.join(dir, 'report.jrxml'));
    assert.ok(hover, 'expected a hover');
    assert.match(hover.contents.value, /not found in resource bundle/i);

    const noBundle = '<jasperReport name="R"><expression><![CDATA[$R{title}]]></expression></jasperReport>';
    const noBundleHover = hoverAt(noBundle, noBundle.indexOf('$R{title}') + 3);
    assert.ok(noBundleHover, 'expected a hover');
    assert.match(noBundleHover.contents.value, /no resource bundle/i);
});
