// test/referenceProvider.test.js
// Find All References must respect the declaration scope: same-named report
// and dataset fields are different symbols.

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

class FakeRange {
    constructor(start, end) { this.start = start; this.end = end; }
}

class FakeLocation {
    constructor(uri, range) { this.uri = uri; this.range = range; }
}

let registered = null;

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return {
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
    }
    return originalLoad.call(this, request, ...rest);
};

require('../referenceProvider');
const provider = registered;

function makeDocument(text) {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1);
    }

    return {
        uri: { toString: () => 'file:///references.jrxml' },
        fileName: '/test/references.jrxml',
        version: 1,
        getText: () => text,
        positionAt: offset => ({ offset }),
        offsetAt: position => lineStarts[position.line] + position.character,
        lineAt: position => {
            const line = position.line;
            const start = lineStarts[line];
            const next = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
            return { text: text.slice(start, next).replace(/\r?\n$/, '') };
        },
    };
}

function positionAt(text, offset) {
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

function referenceOffsets(locations) {
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
    const reportOffsets = referenceOffsets(reportLocations);
    assert.ok(reportOffsets.includes(reportRef));
    assert.ok(reportOffsets.includes(text.indexOf('"shared"') + 1));
    assert.ok(!reportOffsets.includes(datasetRef));

    const datasetLocations = provider.provideReferences(
        doc, positionAt(text, datasetRef + 3), { includeDeclaration: true }
    );
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

    assert.deepStrictEqual(referenceOffsets(locations), [text.indexOf('$F{shared}')]);
});
