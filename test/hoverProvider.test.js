// test/hoverProvider.test.js
// hoverProvider requires 'vscode' at load time, so a stub is installed before
// the module is required. The registered provider is exercised with a fake
// document: cursor position in, Hover markdown out.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
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
            workspace: { workspaceFolders: null },
        };
    }
    return originalLoad.call(this, request, ...rest);
};

require('../out/hoverProvider');
const provider = registered;

let seq = 0;

function makeDoc(text, fileName) {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1);
    }
    return {
        uri: { toString: () => `file:///hover-${seq++}.jrxml` },
        fileName: fileName || '/test/report.jrxml',
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

function hoverAt(text, offset, fileName) {
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
    assert.match(hover.contents.value, /not found in resource bundle/i);

    const noBundle = '<jasperReport name="R"><expression><![CDATA[$R{title}]]></expression></jasperReport>';
    const noBundleHover = hoverAt(noBundle, noBundle.indexOf('$R{title}') + 3);
    assert.match(noBundleHover.contents.value, /no resource bundle/i);
});
