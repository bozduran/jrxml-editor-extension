// test/issuesView.test.ts
// exercises collectIssueItems (the view's data source) with a stubbed vscode.
//
// The test is an ES module while the compiled host module is CommonJS, so the
// stub goes through Node's CJS loader: createRequire keeps that path, which a
// static `import` would bypass.

import test from 'node:test';
import assert from 'node:assert';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** A `vscode.Position`. */
interface FakePosition {
    line: number;
    character: number;
}

/** The range endpoints the view compares. */
interface ComparablePosition extends FakePosition {
    isBeforeOrEqual(other: FakePosition): boolean;
}

interface FakeRange {
    start: ComparablePosition;
    end: ComparablePosition;
}

interface FakeDiagnostic {
    source: string;
    severity: number;
    message: string;
    code?: string | { value: string };
    range: {
        start: FakePosition;
        end: FakePosition;
    };
}

/** The slice of a `vscode.TextDocument` collectIssueItems touches. */
interface FakeDocument {
    uri: { toString(): string };
    getText(): string;
}

/** The fields the tests read from a collected issue. */
interface ViewItem {
    group: string;
    label: string;
    message: string;
    code?: string;
    line: number;
    character: number;
    command?: { command: string };
}

/** A quick-fix action as the picker sees it. */
interface FixAction {
    title?: string;
    edit?: unknown;
    isPreferred?: boolean;
}

/** The slice of the vscode API issuesView imports. */
interface VscodeStub {
    DiagnosticSeverity: { Error: number; Warning: number; Information: number; Hint: number };
    languages: { getDiagnostics(uri: FakeDocument['uri']): FakeDiagnostic[] };
}

let diagnostics: FakeDiagnostic[] = [];

/** Node's internal CJS loader hook: the only way to stub `vscode`. */
interface LoaderHost {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const loader = Module as unknown as LoaderHost;
const originalLoad = loader._load;
loader._load = (request: string, parent: unknown, isMain: boolean): unknown => {
    if (request === 'vscode') {
        const stub: VscodeStub = {
            DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
            languages: { getDiagnostics: () => diagnostics },
        };
        return stub;
    }
    return originalLoad.call(loader, request, parent, isMain);
};

interface IssuesViewModule {
    collectIssueItems(document: FakeDocument): ViewItem[];
    pickFix(actions: readonly FixAction[] | undefined, options?: { preferredOnly?: boolean }): FixAction | null;
    overlaps(a: FakeRange, b: FakeRange): boolean;
    pickNavigationTarget(
        ranges: readonly FakeRange[] | null | undefined,
        cursor: FakePosition,
        direction: number
    ): FakeRange | null;
}

const issuesView = require('../out/issuesView.js') as IssuesViewModule;
const { collectIssueItems, pickFix, overlaps, pickNavigationTarget } = issuesView;

const URI = { toString: () => 'file:///test/report.jrxml' };

function doc(text: string): FakeDocument {
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
    const command = items[0].command;
    assert.ok(command, 'the action item must carry a command');
    assert.strictEqual(command.command, 'jrxml.migrateSqlQuery');
});

test('a file with neither diagnostics nor actions yields no items', () => {
    diagnostics = [];
    assert.deepStrictEqual(collectIssueItems(doc('<jasperReport name="R"/>')), []);
});

// ── fix selection / overlap ───────────────────────────────────────────────────

test('pickFix prefers the preferred action', () => {
    const plain    = { title: 'plain', edit: {} };
    const preferred = { title: 'preferred', edit: {}, isPreferred: true };
    assert.strictEqual(pickFix([plain, preferred]), preferred);
});

test('pickFix falls back to the first edit-bearing action', () => {
    const plain = { title: 'plain', edit: {} };
    assert.strictEqual(pickFix([{ title: 'no edit' }, plain]), plain);
});

test('pickFix with preferredOnly ignores non-preferred and edit-less actions', () => {
    assert.strictEqual(pickFix([{ edit: {} }], { preferredOnly: true }), null);
    assert.strictEqual(pickFix([{ isPreferred: true }], { preferredOnly: true }), null);
    assert.strictEqual(pickFix(undefined), null);
});

const pos = (line: number, character: number): ComparablePosition => ({
    line,
    character,
    isBeforeOrEqual(other: FakePosition): boolean {
        return line < other.line || (line === other.line && character <= other.character);
    },
});
const range = (sl: number, sc: number, el: number, ec: number): FakeRange =>
    ({ start: pos(sl, sc), end: pos(el, ec) });

test('overlaps detects overlapping and touching ranges', () => {
    assert.strictEqual(overlaps(range(0, 0, 0, 5), range(0, 3, 0, 8)), true);
    assert.strictEqual(overlaps(range(0, 0, 0, 5), range(0, 5, 0, 9)), true, 'touching endpoints');
    assert.strictEqual(overlaps(range(0, 0, 0, 5), range(0, 6, 0, 9)), false);
    assert.strictEqual(overlaps(range(0, 0, 1, 0), range(1, 0, 2, 0)), true);
    assert.strictEqual(overlaps(range(0, 0, 1, 0), range(1, 1, 2, 0)), false);
});

// ── navigation ────────────────────────────────────────────────────────────────

const at = (line: number, character: number): FakePosition => ({ line, character });
const startOf = (target: FakeRange | null): [number, number] => {
    assert.ok(target, 'expected a navigation target');
    return [target.start.line, target.start.character];
};

test('pickNavigationTarget returns null without issues', () => {
    assert.strictEqual(pickNavigationTarget([], at(0, 0), 1), null);
    assert.strictEqual(pickNavigationTarget(undefined, at(0, 0), 1), null);
});

test('next goes to the following issue, wrapping at the end', () => {
    const ranges = [range(1, 0, 1, 1), range(5, 0, 5, 1), range(9, 0, 9, 1)];
    assert.deepStrictEqual(startOf(pickNavigationTarget(ranges, at(0, 0), 1)), [1, 0]);
    assert.deepStrictEqual(startOf(pickNavigationTarget(ranges, at(1, 0), 1)), [5, 0]);
    assert.deepStrictEqual(startOf(pickNavigationTarget(ranges, at(9, 5), 1)), [1, 0]);
});

test('previous goes to the preceding issue, wrapping at the start', () => {
    const ranges = [range(1, 0, 1, 1), range(5, 0, 5, 1), range(9, 0, 9, 1)];
    assert.deepStrictEqual(startOf(pickNavigationTarget(ranges, at(10, 0), -1)), [9, 0]);
    assert.deepStrictEqual(startOf(pickNavigationTarget(ranges, at(5, 0), -1)), [1, 0]);
    assert.deepStrictEqual(startOf(pickNavigationTarget(ranges, at(0, 0), -1)), [9, 0]);
});
