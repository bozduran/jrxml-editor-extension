// test/outlineProvider.test.js
// The symbol tree must stay nested and ordered: VS Code rejects invalid trees.

import test from 'node:test';
import assert from 'node:assert';
import Module from 'node:module';
import { createRequire } from 'node:module';
import type { OutlineEntry } from '../out/jrxmlParser.js';

// outlineProvider requires 'vscode' at load time, so the stub is installed
// before the module is loaded. The compiled host module is CommonJS, so it is
// loaded through Node's CJS loader: a static `import` would bypass the stub.
const require = createRequire(import.meta.url);

/** A `vscode.Position` carrying only the offset the outline provider needs. */
interface FakePosition {
    offset: number;
}

class FakeRange {
    start: FakePosition;
    end: FakePosition;

    constructor(start: FakePosition, end: FakePosition) {
        this.start = start;
        this.end = end;
    }
}

class FakeDocumentSymbol {
    name: string;
    detail: string | undefined;
    kind: string;
    range: FakeRange;
    selectionRange: FakeRange;
    children: FakeDocumentSymbol[];

    constructor(name: string, detail: string | undefined, kind: string, range: FakeRange, selectionRange: FakeRange) {
        this.name = name;
        this.detail = detail;
        this.kind = kind;
        this.range = range;
        this.selectionRange = selectionRange;
        this.children = [];
    }
}

/** The slice of a `vscode.TextDocument` the outline provider touches. */
interface FakeDocument {
    uri?: { toString(): string };
    version?: number;
    getText(): string;
    positionAt(offset: number): FakePosition;
}

interface DocumentSymbolProvider {
    provideDocumentSymbols(document: FakeDocument): FakeDocumentSymbol[];
}

/** The slice of the vscode API the outline provider imports. */
interface VscodeStub {
    Range: typeof FakeRange;
    DocumentSymbol: typeof FakeDocumentSymbol;
    SymbolKind: object;
    languages: {
        registerDocumentSymbolProvider(selector: unknown, provider: DocumentSymbolProvider): { dispose(): void };
    };
}

/** Node's internal CJS loader hook: the only way to stub `vscode`. */
interface LoaderHost {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
}

let registered: DocumentSymbolProvider | null = null;

const loader = Module as unknown as LoaderHost;
const originalLoad = loader._load;
loader._load = (request: string, parent: unknown, isMain: boolean): unknown => {
    if (request === 'vscode') {
        const stub: VscodeStub = {
            Range: FakeRange,
            DocumentSymbol: FakeDocumentSymbol,
            SymbolKind: new Proxy({}, { get: (_target, property) => String(property) }),
            languages: {
                registerDocumentSymbolProvider: (_selector, provider) => {
                    registered = provider;
                    return { dispose() {} };
                },
            },
        };
        return stub;
    }
    return originalLoad.call(loader, request, parent, isMain);
};

interface OutlineProviderModule {
    nodesToSymbols(nodes: readonly OutlineEntry[], document: FakeDocument): FakeDocumentSymbol[];
}

const { nodesToSymbols } = require('../out/outlineProvider.js') as OutlineProviderModule;
assert.ok(registered, 'outlineProvider must register a provider');
const provider: DocumentSymbolProvider = registered;

function fakeDocument(text: string): FakeDocument {
    return {
        getText: () => text,
        positionAt: offset => ({ offset }),
    };
}

test('nodesToSymbols keeps parents and children nested', () => {
    const text = '<jasperReport></jasperReport>';
    const nodes: OutlineEntry[] = [{
        kind: 'report',
        name: 'R',
        offset: 0,
        end: text.length,
        children: [{
            kind: 'band',
            name: 'detail',
            offset: 5,
            end: 20,
            children: [{
                kind: 'textField',
                name: '$F{a}',
                offset: 8,
                end: 18,
                children: [],
            }],
        }],
    }];

    const symbols = nodesToSymbols(nodes, fakeDocument(text));

    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0].name, 'R');
    assert.strictEqual(symbols[0].children[0].name, 'detail');
    assert.strictEqual(symbols[0].children[0].children[0].name, '$F{a}');
    assert.ok(symbols[0].range.start.offset <= symbols[0].children[0].range.start.offset);
    assert.ok(symbols[0].children[0].range.start.offset <= symbols[0].children[0].children[0].range.start.offset);
});

test('the registered provider returns the parsed outline', () => {
    const text = '<jasperReport name="R"><detail><band height="20"><element kind="textField" x="0" y="0" width="10" height="10"><expression><![CDATA[$F{a}]]></expression></element></band></detail></jasperReport>';
    const symbols = provider.provideDocumentSymbols({
        uri: { toString: () => 'file:///outline.jrxml' },
        version: 1,
        getText: () => text,
        positionAt: offset => ({ offset }),
    });

    assert.strictEqual(symbols[0].name, 'R');
    assert.ok(JSON.stringify(symbols).includes('$F{a}'));
});
