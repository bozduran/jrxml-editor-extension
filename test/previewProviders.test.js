// test/previewProviders.test.js
// The sort/clear confirmation settings control the modal prompt only: both
// destructive commands always open the diff preview. The providers require
// 'vscode' at load time, so a stub is installed before they are required and
// the registered command callbacks are exercised end to end.

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const state = {
    settings:      {},
    promptAnswer:  'Apply',
    diffCalls:     [],
    prompts:       [],
    warnings:      [],
    errors:        [],
    applied:       [],
};

class FakeRange {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

class FakeWorkspaceEdit {
    constructor() { this.entries = []; }
    replace(uri, range, text) { this.entries.push({ uri, range, text }); }
}

const commands = new Map();
const window = {
    activeTextEditor: null,
    showInformationMessage: async (message, options, ...items) => {
        state.prompts.push({ message, options, items });
        return state.promptAnswer;
    },
    showWarningMessage: (message) => { state.warnings.push(message); },
    showErrorMessage: (message) => { state.errors.push(message); },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return {
            Uri: {
                from: (parts) => ({
                    ...parts,
                    toString: () => `jrxml-preview:/${parts.path}?${parts.query}`,
                }),
            },
            Range: FakeRange,
            WorkspaceEdit: FakeWorkspaceEdit,
            window,
            workspace: {
                registerTextDocumentContentProvider: () => ({ dispose() {} }),
                getConfiguration: () => ({
                    get: (key, fallback) => (
                        Object.prototype.hasOwnProperty.call(state.settings, key)
                            ? state.settings[key]
                            : fallback
                    ),
                }),
                applyEdit: async (edit) => {
                    state.applied.push(edit);
                    return true;
                },
            },
            commands: {
                registerCommand: (id, callback) => {
                    commands.set(id, callback);
                    return { dispose() {} };
                },
                executeCommand: async (id, ...args) => {
                    if (id === 'vscode.diff') state.diffCalls.push(args);
                },
            },
        };
    }
    return originalLoad.call(this, request, ...rest);
};

require('../clearProvider').register({ subscriptions: [] });
require('../sortProvider').register({ subscriptions: [] });

const SORT_TEXT = '<jasperReport name="R"><detail><band height="100">' +
    '<element kind="staticText" x="0" y="20" width="10" height="10"><text>B</text></element>' +
    '<element kind="staticText" x="0" y="10" width="10" height="10"><text>A</text></element>' +
    '</band></detail></jasperReport>';

const CLEAR_TEXT = '<jasperReport name="R">' +
    '<field name="unused" class="java.lang.String"/>' +
    '<detail><band height="10"/></detail></jasperReport>';

function makeDocument(text, name = 'Report.jrxml') {
    return {
        fileName: `/tmp/${name}`,
        uri:      { toString: () => `file:///tmp/${name}` },
        version:  1,
        getText:  () => text,
        positionAt: (offset) => ({ offset }),
    };
}

function reset(settings, text, answer) {
    state.settings     = settings;
    state.promptAnswer = answer;
    state.diffCalls    = [];
    state.prompts      = [];
    state.warnings     = [];
    state.errors       = [];
    state.applied      = [];
    window.activeTextEditor = { document: makeDocument(text) };
}

function confirmations() {
    return state.prompts.filter(prompt => prompt.options && prompt.options.modal);
}

test('sort confirmation setting skips the prompt, not the diff preview', async () => {
    reset({ 'sort.confirm': false }, SORT_TEXT, undefined);

    await commands.get('jrxml.sortElements')();

    assert.strictEqual(state.diffCalls.length, 1, 'the diff preview must always open');
    assert.strictEqual(confirmations().length, 0, 'confirmation must be disabled by the setting');
    assert.strictEqual(state.applied.length, 1, 'the sorted edit must be applied');
});

test('sort asks by default and respects a cancel', async () => {
    reset({ 'sort.confirm': true }, SORT_TEXT, undefined);

    await commands.get('jrxml.sortElements')();

    assert.strictEqual(state.diffCalls.length, 1, 'the diff preview must always open');
    assert.strictEqual(confirmations().length, 1, 'confirmation must be asked by default');
    assert.strictEqual(confirmations()[0].message, 'Apply the geometry sort?');
    assert.strictEqual(state.applied.length, 0, 'cancel must not apply the sort');
});

test('clear confirmation setting skips the prompt, not the diff preview', async () => {
    reset({ 'clear.confirm': false }, CLEAR_TEXT, undefined);

    await commands.get('jrxml.applyClearFixes')();

    assert.strictEqual(state.diffCalls.length, 1, 'the diff preview must always open');
    assert.strictEqual(confirmations().length, 0, 'confirmation must be disabled by the setting');
    assert.strictEqual(state.applied.length, 1, 'the clear edit must be applied');
});

test('clear asks by default and respects a cancel', async () => {
    reset({ 'clear.confirm': true }, CLEAR_TEXT, undefined);

    await commands.get('jrxml.applyClearFixes')();

    assert.strictEqual(state.diffCalls.length, 1, 'the diff preview must always open');
    assert.strictEqual(confirmations().length, 1, 'confirmation must be asked by default');
    assert.match(confirmations()[0].message, /^Apply \d+ clear fix/);
    assert.strictEqual(state.applied.length, 0, 'cancel must not apply the clear fixes');
});
