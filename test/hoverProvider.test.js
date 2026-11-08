// test/hoverProvider.test.js
// hoverProvider requires 'vscode' at load time, so a stub is installed before
// the module is required. The registered provider is exercised with a fake
// document: cursor position in, Hover markdown out.

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

class FakeRange {
    constructor(startLine, startCharacter, endLine, endCharacter) {
        this.start = { line: startLine, character: startCharacter };
        this.end   = { line: endLine, character: endCharacter };
    }
}

class FakeMarkdownString {
    constructor(value = '') { this.value = value; }
    appendMarkdown(text) { this.value += text; return this; }
}

class FakeHover {
    constructor(contents, range) {
        this.contents = contents;
        this.range = range;
    }
}

let registered = null;

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return {
            Range: FakeRange,
            MarkdownString: FakeMarkdownString,
            Hover: FakeHover,
            languages: {
                registerHoverProvider: (_selector, provider) => {
                    registered = provider;
                    return { dispose() {} };
                },
            },
        };
    }
    return originalLoad.call(this, request, ...rest);
};

require('../hoverProvider');
const provider = registered;

let seq = 0;

function makeDoc(text) {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1);
    }
    return {
        uri: { toString: () => `file:///hover-${seq++}.jrxml` },
        version: 1,
        getText: () => text,
        offsetAt(position) { return lineStarts[position.line] + position.character; },
        lineAt(position) {
            const line = typeof position === 'number' ? position : position.line;
            const start = lineStarts[line];
            const next  = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
            return { text: text.slice(start, next).replace(/\r?\n$/, '') };
        },
    };
}

function positionAt(text, offset) {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length - 1, character: before[before.length - 1].length };
}

function hoverAt(text, offset) {
    return provider.provideHover(makeDoc(text), positionAt(text, offset));
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
