// issuesView.ts
// The "Issues (JRXML)" JRXML Activity Bar view.
//
// It is a live mirror of the JRXML diagnostics (source "JRXML": undeclared
// references, unbalanced parens, unclosed strings, unused declarations, the
// structural lint rules and textcheck) plus the file-level actions that are not
// diagnostics (currently the SQL -> jsonql migration). The geometry sort stays
// in the JRXML menu and Command Palette, not in this view.
//
// Reading vscode.languages.getDiagnostics() keeps the view in lock-step with
// the squiggles: there is no second copy of the diagnostic logic to drift.

import * as vscode from 'vscode';
import { groupIssues, countIssues } from './issuesModel';
import type { Issue, IssueGroup, IssueGroupView } from './issuesModel';
import { collectFileIssues, QUERY_KIND } from './fileIssues';
import { openExpressionEditorAt, openIfElseBuilderAt } from './expressionActions';

const VIEW_ID     = 'jrxmlIssues';
const JRMXL_SOURCE = 'JRXML';
const DEBOUNCE_MS = 300;

/** An issue record with the VS Code objects the tree and commands use. */
interface ViewIssue extends Issue {
    readonly uri?: vscode.Uri;
    readonly command?: vscode.Command;
}

/** The same grouping, narrowed to the view's issue records. */
interface ViewGroup extends Omit<IssueGroupView, 'items'> {
    readonly items: ViewIssue[];
}

/** A rendered group node, carrying the leaves the tree expands to. */
interface IssueTreeItem extends vscode.TreeItem {
    issue?: ViewIssue;
    _groupItems?: ViewIssue[];
}

function isJrxml(document: vscode.TextDocument | null | undefined): document is vscode.TextDocument {
    return !!document && document.fileName.endsWith('.jrxml');
}

function codeString(code: vscode.Diagnostic['code']): string {
    if (!code) return '';
    if (typeof code === 'string') return code;
    if (typeof code === 'object') return String(code.value || '');
    return '';
}

/** A vscode.Diagnostic as a plain Issue record. */
function diagnosticToIssue(diagnostic: vscode.Diagnostic, uri: vscode.Uri): ViewIssue {
    const group: IssueGroup = diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';
    return {
        group,
        label:    `Line ${diagnostic.range.start.line + 1}: ${diagnostic.message}`,
        message:  diagnostic.message,
        code:     codeString(diagnostic.code),
        line:     diagnostic.range.start.line,
        character: diagnostic.range.start.character,
        endLine:  diagnostic.range.end.line,
        endCharacter: diagnostic.range.end.character,
        uri,
    };
}

/** All issue records for one document: JRXML diagnostics + file actions. */
function collectIssueItems(document: vscode.TextDocument): ViewIssue[] {
    const uri   = document.uri;
    const items: ViewIssue[] = [];

    for (const diagnostic of vscode.languages.getDiagnostics(uri)) {
        if (diagnostic.source !== JRMXL_SOURCE) continue;
        items.push(diagnosticToIssue(diagnostic, uri));
    }

    for (const fileIssue of collectFileIssues(document.getText())) {
        if (fileIssue.kind !== QUERY_KIND) continue;
        items.push({
            group:   'action',
            label:   fileIssue.title,
            message: fileIssue.detail,
            code:    'jrxml.fileIssue.query',
            line:    0,
            character: 0,
            command: { command: fileIssue.command, title: fileIssue.title, arguments: [] },
        });
    }

    return items;
}

// ── Tree rendering ────────────────────────────────────────────────────────────

const GROUP_ICON: Readonly<Record<string, string>> = { error: 'error', warning: 'warning', action: 'lightbulb' };

function messageItem(message: string, icon: string): vscode.TreeItem {
    const item = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
    item.iconPath     = new vscode.ThemeIcon(icon || 'info');
    item.contextValue = 'jrxmlIssueMessage';
    return item;
}

function groupItem(group: ViewGroup): IssueTreeItem {
    const item: IssueTreeItem = new vscode.TreeItem(
        `${group.title} (${group.items.length})`,
        vscode.TreeItemCollapsibleState.Expanded
    );
    item.iconPath     = new vscode.ThemeIcon(GROUP_ICON[group.group] || 'info');
    item.contextValue = 'jrxmlIssueGroup';
    item._groupItems  = group.items;
    return item;
}

function leafItem(issue: ViewIssue): IssueTreeItem {
    const item: IssueTreeItem = new vscode.TreeItem(issue.label, vscode.TreeItemCollapsibleState.None);
    item.tooltip = issue.code ? `${issue.message}\n\n(${issue.code})` : issue.message;
    item.issue   = issue;

    if (issue.command) {
        item.contextValue = 'jrxmlIssueAction';
        item.iconPath     = new vscode.ThemeIcon('database');
        item.command      = issue.command;
    } else {
        item.contextValue = 'jrxmlIssueDiagnostic';
        item.iconPath     = new vscode.ThemeIcon(issue.group === 'error' ? 'error' : 'warning');
        item.command      = { command: 'jrxml.issues.jumpToHit', title: 'Go to issue', arguments: [issue] };
    }
    return item;
}

class IssuesProvider {
    private readonly _onDidChangeTreeData: vscode.EventEmitter<IssueTreeItem | undefined | null | void>;
    readonly onDidChangeTreeData: vscode.Event<IssueTreeItem | undefined | null | void>;
    private _document: vscode.TextDocument | null;
    groups: ViewGroup[];

    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
        this._document = null;
        this.groups    = [];
    }

    refresh(): void {
        const editor = vscode.window.activeTextEditor;
        if (!isJrxml(editor?.document)) {
            this._document = null;
            this.groups    = [];
        } else {
            this._document = editor.document;
            this.groups    = groupIssues(collectIssueItems(editor.document)) as ViewGroup[];
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: IssueTreeItem): vscode.TreeItem { return element; }

    getChildren(element?: IssueTreeItem): vscode.TreeItem[] {
        if (element) return element._groupItems ? element._groupItems.map(leafItem) : [];
        // No report: return no items so the viewsWelcome content shows.
        if (!this._document) return [];
        if (this.groups.length === 0) return [messageItem('No issues found ✓', 'pass')];
        return this.groups.map(groupItem);
    }

    dispose(): void { this._onDidChangeTreeData.dispose(); }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/** Tree-item commands receive the TreeItem; item.command passes the issue. */
function toIssue(arg: unknown): ViewIssue | undefined {
    if (!arg) return undefined;
    // Command arguments are either a leaf TreeItem or an Issue record.
    const wrapped = (arg as { issue?: ViewIssue }).issue;
    return wrapped || (arg as ViewIssue);
}

function rangeOf(issue: ViewIssue): vscode.Range {
    return new vscode.Range(
        issue.line,
        issue.character,
        issue.endLine ?? issue.line,
        issue.endCharacter ?? issue.character
    );
}

async function jumpToHit(arg: unknown): Promise<void> {
    const issue = toIssue(arg);
    if (!issue || !issue.uri) return;

    const document = await vscode.workspace.openTextDocument(issue.uri);
    const editor   = await vscode.window.showTextDocument(document);

    const start = new vscode.Position(issue.line, issue.character);
    const end   = new vscode.Position(
        issue.endLine ?? issue.line,
        issue.endCharacter ?? issue.character
    );
    editor.selection = new vscode.Selection(start, start);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}

/** A quick-fix action that carries the edit it applies. */
type EditAction = vscode.CodeAction & { edit: vscode.WorkspaceEdit };

/** Quick-fix actions offered for one diagnostic range. */
async function quickFixesFor(uri: vscode.Uri, range: vscode.Range): Promise<EditAction[]> {
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        uri,
        range,
        vscode.CodeActionKind.QuickFix
    );
    return (actions || []).filter((action): action is EditAction => !!action && !!action.edit);
}

/** The lightbulb's preferred fix, else the first edit-bearing one. */
function pickFix(
    actions: readonly vscode.CodeAction[] | undefined,
    { preferredOnly = false }: { preferredOnly?: boolean } = {}
): EditAction | null {
    const withEdit = (actions || []).filter((action): action is EditAction => !!action && !!action.edit);
    const preferred = withEdit.find(action => action.isPreferred);
    if (preferred) return preferred;
    return preferredOnly ? null : (withEdit[0] || null);
}

async function applyFix(arg: unknown): Promise<void> {
    const issue = toIssue(arg);
    if (!issue || !issue.uri) return;

    const fixes = await quickFixesFor(issue.uri, rangeOf(issue));
    const fix   = pickFix(fixes);
    if (!fix) {
        vscode.window.showInformationMessage('No quick fix is available for this issue.');
        return;
    }
    if (await vscode.workspace.applyEdit(fix.edit)) {
        vscode.window.showInformationMessage(fix.title || 'Issue fixed.');
    }
}

function overlaps(a: vscode.Range, b: vscode.Range): boolean {
    return a.start.isBeforeOrEqual(b.end) && b.start.isBeforeOrEqual(a.end);
}

/**
 * Apply every preferred quick fix in the file in one undoable edit.
 *
 * Only the preferred action is used, so "remove unused declaration" (not
 * preferred) and constant-expression removal stay opt-in via the lightbulb.
 * Edits that overlap an already-collected one are skipped.
 */
async function fixAll(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!isJrxml(editor?.document)) {
        vscode.window.showWarningMessage('Open a .jrxml file first.');
        return;
    }

    const uri      = editor.document.uri;
    const diags    = vscode.languages.getDiagnostics(uri).filter(d => d.source === JRMXL_SOURCE);
    const merged   = new vscode.WorkspaceEdit();
    const accepted: { uri: vscode.Uri; range: vscode.Range }[] = [];
    let fixed = 0;

    for (const diagnostic of diags) {
        const fix = pickFix(await quickFixesFor(uri, diagnostic.range), { preferredOnly: true });
        if (!fix) continue;

        let used = false;
        for (const [editUri, edits] of fix.edit.entries()) {
            for (const textEdit of edits) {
                if (accepted.some(other => other.uri === editUri && overlaps(other.range, textEdit.range))) continue;

                merged.replace(editUri, textEdit.range, textEdit.newText);
                accepted.push({ uri: editUri, range: textEdit.range });
                used = true;
            }
        }
        if (used) fixed++;
    }

    if (merged.size === 0) {
        vscode.window.showInformationMessage('No automatic fixes are available for this file.');
        return;
    }
    if (await vscode.workspace.applyEdit(merged)) {
        vscode.window.showInformationMessage(`Fixed ${fixed} issue${fixed === 1 ? '' : 's'}.`);
    }
}

async function copyMessage(arg: unknown): Promise<void> {
    const issue = toIssue(arg);
    if (issue?.message) await vscode.env.clipboard.writeText(issue.message);
}

async function copyCode(arg: unknown): Promise<void> {
    const issue = toIssue(arg);
    if (issue?.code) await vscode.env.clipboard.writeText(issue.code);
}

// ── Issue navigation ──────────────────────────────────────────────────────────

interface IssueRange {
    start: { line: number; character: number };
    end: { line: number; character: number };
}

function comparePosition(
    a: { line: number; character: number },
    b: { line: number; character: number }
): number {
    if (a.line !== b.line) return a.line - b.line;
    return a.character - b.character;
}

/** JRXML diagnostic ranges for a document, sorted by position. */
function issueRanges(uri: vscode.Uri): IssueRange[] {
    return vscode.languages.getDiagnostics(uri)
        .filter(diagnostic => diagnostic.source === JRMXL_SOURCE)
        .map(diagnostic => ({
            start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
            end:   { line: diagnostic.range.end.line,   character: diagnostic.range.end.character },
        }))
        .sort((a, b) => comparePosition(a.start, b.start));
}

/**
 * The range to move to from `cursor`, or null when there are none. Wraps
 * around the file in both directions.
 */
function pickNavigationTarget(
    ranges: readonly IssueRange[] | null | undefined,
    cursor: { line: number; character: number },
    direction: number
): IssueRange | null {
    if (!ranges || ranges.length === 0) return null;

    if (direction >= 0) {
        return ranges.find(range => comparePosition(range.start, cursor) > 0) || ranges[0];
    }
    return [...ranges].reverse().find(range => comparePosition(range.start, cursor) < 0)
        || ranges[ranges.length - 1];
}

async function navigate(direction: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!isJrxml(editor?.document)) {
        vscode.window.showWarningMessage('Open a .jrxml file first.');
        return;
    }

    const target = pickNavigationTarget(issueRanges(editor.document.uri), editor.selection.active, direction);
    if (!target) {
        vscode.window.showInformationMessage('No JRXML issues in this file.');
        return;
    }

    const start = new vscode.Position(target.start.line, target.start.character);
    const end   = new vscode.Position(target.end.line, target.end.character);
    editor.selection = new vscode.Selection(start, start);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}

function updateBadge(view: vscode.TreeView<IssueTreeItem>, count: number): void {
    view.badge = count > 0
        ? { value: count, tooltip: `${count} issue${count === 1 ? '' : 's'}` }
        : undefined;
}

// ── Registration ──────────────────────────────────────────────────────────────

function register(context: vscode.ExtensionContext): void {
    const provider = new IssuesProvider();
    const view = vscode.window.createTreeView(VIEW_ID, {
        treeDataProvider: provider,
        showCollapseAll:  true,
    });

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    statusBar.name    = 'JRXML Issues';
    statusBar.command = `${VIEW_ID}.focus`;

    let timer: NodeJS.Timeout | undefined;
    const refresh = (): void => {
        provider.refresh();
        const count = countIssues(provider.groups);
        updateBadge(view, count);

        if (count > 0) {
            statusBar.text    = `$(warning) ${count}`;
            statusBar.tooltip = `${count} JRXML issue${count === 1 ? '' : 's'} — click to open Issues (JRXML)`;
            statusBar.show();
        } else {
            statusBar.hide();
        }
    };
    const schedule = (): void => { clearTimeout(timer); timer = setTimeout(refresh, DEBOUNCE_MS); };

    const editInExpressionEditor = async (arg: unknown): Promise<void> => {
        const issue = toIssue(arg);
        if (!issue || !issue.uri) {
            vscode.window.showInformationMessage('Run this from an issue in the Issues (JRXML) view.');
            return;
        }
        await openExpressionEditorAt(context.extensionUri, issue.uri, issue.line, issue.character);
    };
    const editInIfElseBuilder = async (arg: unknown): Promise<void> => {
        const issue = toIssue(arg);
        if (!issue || !issue.uri) {
            vscode.window.showInformationMessage('Run this from an issue in the Issues (JRXML) view.');
            return;
        }
        await openIfElseBuilderAt(context.extensionUri, issue.uri, issue.line, issue.character);
    };

    context.subscriptions.push(
        view,
        provider,
        statusBar,

        vscode.commands.registerCommand('jrxml.refreshIssues', refresh),
        vscode.commands.registerCommand('jrxml.issues.jumpToHit', jumpToHit),
        vscode.commands.registerCommand('jrxml.issues.applyFix', applyFix),
        vscode.commands.registerCommand('jrxml.issues.fixAll', fixAll),
        vscode.commands.registerCommand('jrxml.issues.copyMessage', copyMessage),
        vscode.commands.registerCommand('jrxml.issues.copyCode', copyCode),
        vscode.commands.registerCommand('jrxml.issues.editInExpressionEditor', editInExpressionEditor),
        vscode.commands.registerCommand('jrxml.issues.editInIfElseBuilder', editInIfElseBuilder),
        vscode.commands.registerCommand('jrxml.nextIssue', () => navigate(1)),
        vscode.commands.registerCommand('jrxml.previousIssue', () => navigate(-1)),

        // Diagnostics are pushed by diagnosticsProvider; this keeps us in sync.
        vscode.languages.onDidChangeDiagnostics(() => refresh()),
        vscode.window.onDidChangeActiveTextEditor(() => refresh()),
        // File-level actions are not diagnostics, so recompute on edits.
        vscode.workspace.onDidChangeTextDocument(event => { if (isJrxml(event.document)) schedule(); }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('jrxml')) refresh();
        }),

        { dispose: () => clearTimeout(timer) }
    );

    refresh();
}

export { register, collectIssueItems, pickFix, overlaps, pickNavigationTarget, VIEW_ID };
