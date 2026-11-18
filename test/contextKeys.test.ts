// test/contextKeys.test.ts
// The pure part of the context-key tracker: which JRXML actions have work to do.
//
// contextKeys requires 'vscode' at load time, so a stub is installed before the
// module is loaded. The stub goes through Node's CJS loader: createRequire
// keeps that path, which a static `import` would bypass.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { TEST_DIR } from './support.ts';

const require = createRequire(import.meta.url);

/** Node's internal CJS loader hook: the only way to stub `vscode`. */
interface LoaderHost {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const loader = Module as unknown as LoaderHost;
const originalLoad = loader._load;
loader._load = (request: string, parent: unknown, isMain: boolean): unknown => {
    if (request === 'vscode') return {};
    return originalLoad.call(loader, request, parent, isMain);
};

const { computeContextKeys, KEYS } = require('../out/contextKeys.js') as typeof import('../out/contextKeys.js');

function fixture(name: string): string {
    return fs.readFileSync(path.join(TEST_DIR, 'fixtures', name), 'utf8');
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
