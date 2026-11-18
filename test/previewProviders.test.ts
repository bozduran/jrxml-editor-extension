// test/previewProviders.test.js
// The sort/clear confirmation settings control the modal prompt only: both
// destructive commands always open the diff preview. The providers require
// 'vscode' at load time, so a stub is installed before they are required and
// the registered command callbacks are exercised end to end.

import test from 'node:test';
import assert from 'node:assert';
import Module from 'node:module';
import { createRequire } from 'node:module';

// The test is an ES module while the compiled host modules are CommonJS, so
// the stub goes through Node's CJS loader: a static `import` would bypass it.
const require = createRequire(import.meta.url);

/** A `vscode.Position` carrying only the offset the providers touch. */
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

interface FakeUri {
    scheme?: string;
    path?: string;
    query?: string;
    toString(): string;
}

interface UriParts {
    scheme: string;
    path: string;
    query: string;
}

interface WorkspaceReplace {
    uri: FakeUri;
    range: FakeRange;
    text: string;
}

class FakeWorkspaceEdit {
    entries: WorkspaceReplace[];

    constructor() { this.entries = []; }

    replace(uri: FakeUri, range: FakeRange, text: string): void {
        this.entries.push({ uri, range, text });
    }
}

interface PromptRecord {
    message: string;
    options: { modal?: boolean } | undefined;
    items: string[];
}

interface PreviewState {
    settings: Record<string, unknown>;
    promptAnswer: string | undefined;
    diffCalls: unknown[][];
    prompts: PromptRecord[];
    warnings: string[];
    errors: string[];
    applied: unknown[];
}

const state: PreviewState = {
    settings:      {},
    promptAnswer:  'Apply',
    diffCalls:     [],
    prompts:       [],
    warnings:      [],
    errors:        [],
    applied:       [],
};

const commands = new Map<string, (...args: unknown[]) => unknown>();

/** The slice of the vscode API the providers and the preview helper import. */
interface FakeWindow {
    activeTextEditor: { document: FakeDocument } | null;
    showInformationMessage(
        message: string,
        options?: { modal?: boolean },
        ...items: string[]
    ): Promise<string | undefined>;
    showWarningMessage(message: string): void;
    showErrorMessage(message: string): void;
}

interface VscodeStub {
    Uri: { from(parts: UriParts): FakeUri };
    Range: typeof FakeRange;
    WorkspaceEdit: typeof FakeWorkspaceEdit;
    window: FakeWindow;
    workspace: {
        registerTextDocumentContentProvider(selector: unknown, provider: unknown): { dispose(): void };
        getConfiguration(section: string): { get(key: string, fallback: unknown): unknown };
        applyEdit(edit: FakeWorkspaceEdit): Promise<boolean>;
    };
    commands: {
        registerCommand(id: string, callback: (...args: unknown[]) => unknown): { dispose(): void };
        executeCommand(id: string, ...args: unknown[]): Promise<void>;
    };
}

const window: FakeWindow = {
    activeTextEditor: null,
    showInformationMessage: async (message, options, ...items) => {
        state.prompts.push({ message, options, items });
        return state.promptAnswer;
    },
    showWarningMessage: (message) => { state.warnings.push(message); },
    showErrorMessage: (message) => { state.errors.push(message); },
};

/** Node's internal CJS loader hook: the only way to stub `vscode`. */
interface LoaderHost {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const loader = Module as unknown as LoaderHost;
const originalLoad = loader._load;
loader._load = (request: string, parent: unknown, isMain: boolean): unknown => {
    if (request === 'vscode') {
        const stub: VscodeStub = {
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
        return stub;
    }
    return originalLoad.call(loader, request, parent, isMain);
};

interface ProviderModule {
    register(context: { subscriptions: unknown[] }): void;
}

const clearProvider = require('../out/clearProvider.js') as ProviderModule;
const sortProvider = require('../out/sortProvider.js') as ProviderModule;
clearProvider.register({ subscriptions: [] });
sortProvider.register({ subscriptions: [] });

const SORT_TEXT = '<jasperReport name="R"><detail><band height="100">' +
    '<element kind="staticText" x="0" y="20" width="10" height="10"><text>B</text></element>' +
    '<element kind="staticText" x="0" y="10" width="10" height="10"><text>A</text></element>' +
    '</band></detail></jasperReport>';

const CLEAR_TEXT = '<jasperReport name="R">' +
    '<field name="unused" class="java.lang.String"/>' +
    '<detail><band height="10"/></detail></jasperReport>';

/** The slice of a `vscode.TextDocument` the providers touch. */
interface FakeDocument {
    fileName: string;
    uri: FakeUri;
    version: number;
    getText(): string;
    positionAt(offset: number): FakePosition;
}

function makeDocument(text: string, name = 'Report.jrxml'): FakeDocument {
    return {
        fileName: `/tmp/${name}`,
        uri:      { toString: () => `file:///tmp/${name}` },
        version:  1,
        getText:  () => text,
        positionAt: (offset) => ({ offset }),
    };
}

function reset(settings: Record<string, unknown>, text: string, answer: string | undefined): void {
    state.settings     = settings;
    state.promptAnswer = answer;
    state.diffCalls    = [];
    state.prompts      = [];
    state.warnings     = [];
    state.errors       = [];
    state.applied      = [];
    window.activeTextEditor = { document: makeDocument(text) };
}

function confirmations(): PromptRecord[] {
    return state.prompts.filter(prompt => prompt.options && prompt.options.modal);
}

test('sort confirmation setting skips the prompt, not the diff preview', async () => {
    reset({ 'sort.confirm': false }, SORT_TEXT, undefined);

    const command = commands.get('jrxml.sortElements');
    assert.ok(command, 'sort command must be registered');
    await command();

    assert.strictEqual(state.diffCalls.length, 1, 'the diff preview must always open');
    assert.strictEqual(confirmations().length, 0, 'confirmation must be disabled by the setting');
    assert.strictEqual(state.applied.length, 1, 'the sorted edit must be applied');
});

test('sort asks by default and respects a cancel', async () => {
    reset({ 'sort.confirm': true }, SORT_TEXT, undefined);

    const command = commands.get('jrxml.sortElements');
    assert.ok(command, 'sort command must be registered');
    await command();

    assert.strictEqual(state.diffCalls.length, 1, 'the diff preview must always open');
    assert.strictEqual(confirmations().length, 1, 'confirmation must be asked by default');
    assert.strictEqual(confirmations()[0].message, 'Apply the geometry sort?');
    assert.strictEqual(state.applied.length, 0, 'cancel must not apply the sort');
});

test('clear confirmation setting skips the prompt, not the diff preview', async () => {
    reset({ 'clear.confirm': false }, CLEAR_TEXT, undefined);

    const command = commands.get('jrxml.applyClearFixes');
    assert.ok(command, 'clear command must be registered');
    await command();

    assert.strictEqual(state.diffCalls.length, 1, 'the diff preview must always open');
    assert.strictEqual(confirmations().length, 0, 'confirmation must be disabled by the setting');
    assert.strictEqual(state.applied.length, 1, 'the clear edit must be applied');
});

test('clear asks by default and respects a cancel', async () => {
    reset({ 'clear.confirm': true }, CLEAR_TEXT, undefined);

    const command = commands.get('jrxml.applyClearFixes');
    assert.ok(command, 'clear command must be registered');
    await command();

    assert.strictEqual(state.diffCalls.length, 1, 'the diff preview must always open');
    assert.strictEqual(confirmations().length, 1, 'confirmation must be asked by default');
    assert.match(confirmations()[0].message, /^Apply \d+ clear fix/);
    assert.strictEqual(state.applied.length, 0, 'cancel must not apply the clear fixes');
});
