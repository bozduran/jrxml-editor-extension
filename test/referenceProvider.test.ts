// test/referenceProvider.test.ts
// Find All References must respect the declaration scope: same-named report
// and dataset fields are different symbols.
//
// referenceProvider requires 'vscode' at load time, so a stub is installed
// before the module is loaded. The stub goes through Node's CJS loader:
// createRequire keeps that path, which a static `import` would bypass.

import test from 'node:test';
import assert from 'node:assert';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** A position in the cursor's coordinate space. */
interface CursorPosition {
    line: number;
    character: number;
}

/** The fake document's `positionAt` returns an offset, which the ranges keep. */
interface OffsetPosition {
    offset: number;
}

interface FakeUri {
    toString(): string;
}

class FakeRange {
    start: OffsetPosition;
    end: OffsetPosition;

    constructor(start: OffsetPosition, end: OffsetPosition) { this.start = start; this.end = end; }
}

class FakeLocation {
    uri: FakeUri;
    range: FakeRange;

    constructor(uri: FakeUri, range: FakeRange) { this.uri = uri; this.range = range; }
}

/** The slice of a `vscode.TextDocument` the reference provider touches. */
interface FakeDocument {
    uri: FakeUri;
    fileName: string;
    version: number;
    getText(): string;
    positionAt(offset: number): OffsetPosition;
    offsetAt(position: CursorPosition): number;
    lineAt(position: CursorPosition): { text: string };
}

/** The registered provider object the test exercises. */
interface ReferenceProvider {
    provideReferences(
        document: FakeDocument,
        position: CursorPosition,
        context: { includeDeclaration: boolean },
    ): FakeLocation[] | null;
}

/** The slice of the vscode API the reference provider imports. */
interface VscodeStub {
    Range: typeof FakeRange;
    Location: typeof FakeLocation;
    languages: {
        registerReferenceProvider(selector: unknown, provider: ReferenceProvider): { dispose(): void };
    };
    workspace: { workspaceFolders: null };
}

let registered: ReferenceProvider | null = null;

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
            languages: {
                registerReferenceProvider: (_selector, provider) => {
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

require('../out/referenceProvider.js');
assert.ok(registered, 'referenceProvider must register a provider');
const provider: ReferenceProvider = registered;

function makeDocument(text: string): FakeDocument {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1);
    }

    return {
        uri: { toString: () => 'file:///references.jrxml' },
        fileName: '/test/references.jrxml',
        version: 1,
        getText: () => text,
        positionAt: (offset: number): OffsetPosition => ({ offset }),
        offsetAt: (position: CursorPosition): number => lineStarts[position.line] + position.character,
        lineAt: (position: CursorPosition) => {
            const line = position.line;
            const start = lineStarts[line];
            const next = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
            return { text: text.slice(start, next).replace(/\r?\n$/, '') };
        },
    };
}

function positionAt(text: string, offset: number): CursorPosition {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length - 1, character: before[before.length - 1].length };
}

const SCOPED = `<jasperReport name="R">
  <field name="shared" class="java.lang.String"/>
  <expression><![CDATA[$F{shared}]]></expression>
  <dataset name="DS">
    <field name="shared" class="java.lang.Integer"/>
    <filterExpression><![CDATA[$F{shared}]]></filterExpression>
  </dataset>
</jasperReport>`;

function referenceOffsets(locations: readonly FakeLocation[]): number[] {
    return locations.map(location => location.range.start.offset);
}

test('find-all-references stays inside the reference scope', () => {
    const text = SCOPED;
    const doc = makeDocument(text);
    const reportRef = text.indexOf('$F{shared}');
    const datasetRef = text.lastIndexOf('$F{shared}');

    const reportLocations = provider.provideReferences(
        doc, positionAt(text, reportRef + 3), { includeDeclaration: true }
    );
    assert.ok(reportLocations, 'expected report-scope references');
    const reportOffsets = referenceOffsets(reportLocations);
    assert.ok(reportOffsets.includes(reportRef));
    assert.ok(reportOffsets.includes(text.indexOf('"shared"') + 1));
    assert.ok(!reportOffsets.includes(datasetRef));

    const datasetLocations = provider.provideReferences(
        doc, positionAt(text, datasetRef + 3), { includeDeclaration: true }
    );
    assert.ok(datasetLocations, 'expected dataset-scope references');
    const datasetOffsets = referenceOffsets(datasetLocations);
    assert.ok(datasetOffsets.includes(datasetRef));
    assert.ok(datasetOffsets.includes(text.lastIndexOf('"shared"') + 1));
    assert.ok(!datasetOffsets.includes(reportRef));
});

test('a declaration resolves to its own references', () => {
    const text = SCOPED;
    const doc = makeDocument(text);
    const declarationOffset = text.indexOf('"shared"') + 1;

    const locations = provider.provideReferences(
        doc, positionAt(text, declarationOffset), { includeDeclaration: false }
    );
    assert.ok(locations, 'expected declaration references');

    assert.deepStrictEqual(referenceOffsets(locations), [text.indexOf('$F{shared}')]);
});
