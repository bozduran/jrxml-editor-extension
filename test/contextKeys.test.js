// test/contextKeys.test.js
// The pure part of the context-key tracker: which JRXML actions have work to do.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return {};
    return originalLoad.call(this, request, ...rest);
};

const { computeContextKeys, KEYS } = require('../contextKeys');

function fixture(name) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

test('a plain report has no pending actions', () => {
    const keys = computeContextKeys('<jasperReport name="R"><detail><band height="10"/></detail></jasperReport>');
    assert.strictEqual(keys[KEYS.sort], false);
    assert.strictEqual(keys[KEYS.sql], false);
    assert.strictEqual(keys[KEYS.clear], false);
});

test('a SQL query sets the migration flag', () => {
    const keys = computeContextKeys(
        '<jasperReport name="R"><query language="sql"><![CDATA[SELECT 1]]></query></jasperReport>'
    );
    assert.strictEqual(keys[KEYS.sql], true);
});

test('unsorted geometry sets the sort flag', () => {
    const keys = computeContextKeys(fixture('SortEdgeReport.jrxml'));
    assert.strictEqual(keys[KEYS.sort], true);
});

test('unused declarations set the clear flag', () => {
    const keys = computeContextKeys(fixture('ClearEdgeReport.jrxml'));
    assert.strictEqual(keys[KEYS.clear], true);
});
