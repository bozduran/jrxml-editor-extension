// test/issuesView.test.js
// exercises collectIssueItems (the view's data source) with a stubbed vscode.

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

let diagnostics = [];

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return {
            DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
            languages: { getDiagnostics: () => diagnostics },
        };
    }
    return originalLoad.call(this, request, ...rest);
};

const { collectIssueItems } = require('../issuesView');

const URI = { toString: () => 'file:///test/report.jrxml' };

function doc(text) {
    return { uri: URI, getText: () => text };
}

test('maps JRXML diagnostics by severity and ignores other sources', () => {
    diagnostics = [
        { source: 'JRXML', severity: 0, message: 'boom', code: 'jrxml.undeclaredReference',
          range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } } },
        { source: 'JRXML', severity: 1, message: 'careful', code: { value: 'jrxml.textcheck' },
          range: { start: { line: 9, character: 0 }, end: { line: 9, character: 3 } } },
        { source: 'other-extension', severity: 0, message: 'ignored', code: 'x',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
    ];

    const items = collectIssueItems(doc('<jasperReport name="R"/>'));
    assert.deepStrictEqual(items.map(i => i.group), ['error', 'warning']);
    assert.strictEqual(items[0].label, 'Line 5: boom');
    assert.strictEqual(items[0].code, 'jrxml.undeclaredReference');
    assert.strictEqual(items[1].code, 'jrxml.textcheck');
});

test('adds the SQL migration action and not the sort action', () => {
    diagnostics = [];
    const text = `<jasperReport name="R">
  <query language="sql"><![CDATA[SELECT 1]]></query>
</jasperReport>`;

    const items = collectIssueItems(doc(text));
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].group, 'action');
    assert.match(items[0].label, /SQL query can be migrated/);
    assert.strictEqual(items[0].command.command, 'jrxml.migrateSqlQuery');
});

test('a file with neither diagnostics nor actions yields no items', () => {
    diagnostics = [];
    assert.deepStrictEqual(collectIssueItems(doc('<jasperReport name="R"/>')), []);
});
