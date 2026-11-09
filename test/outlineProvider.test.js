// test/outlineProvider.test.js
// The symbol tree must stay nested and ordered: VS Code rejects invalid trees.

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

class FakeRange {
    constructor(start, end) { this.start = start; this.end = end; }
}

class FakeDocumentSymbol {
    constructor(name, detail, kind, range, selectionRange) {
        this.name = name;
        this.detail = detail;
        this.kind = kind;
        this.range = range;
        this.selectionRange = selectionRange;
        this.children = [];
    }
}

let registered = null;

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return {
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
    }
    return originalLoad.call(this, request, ...rest);
};

const { nodesToSymbols } = require('../out/outlineProvider');

function fakeDocument(text) {
    return {
        getText: () => text,
        positionAt: offset => ({ offset }),
    };
}

test('nodesToSymbols keeps parents and children nested', () => {
    const text = '<jasperReport></jasperReport>';
    const nodes = [{
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
    const symbols = registered.provideDocumentSymbols({
        uri: { toString: () => 'file:///outline.jrxml' },
        version: 1,
        getText: () => text,
        positionAt: offset => ({ offset }),
    });

    assert.strictEqual(symbols[0].name, 'R');
    assert.ok(JSON.stringify(symbols).includes('$F{a}'));
});
