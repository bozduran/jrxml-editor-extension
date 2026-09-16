// issuesView.js
// The "Issues (JRXML)" Explorer view, shown above Best Practices.
//
// It is a live mirror of the JRXML diagnostics (source "JRXML": undeclared
// references, unbalanced parens, unclosed strings, unused declarations, the
// structural lint rules and textcheck) plus the file-level actions that are not
// diagnostics (currently the SQL -> jsonql migration). Rules with their own
// workflow (sort, best practices) stay in their own views.
//
// Reading vscode.languages.getDiagnostics() keeps the view in lock-step with
// the squiggles: there is no second copy of the diagnostic logic to drift.

const vscode = require('vscode');
const { groupIssues, countIssues } = require('./issuesModel');
const { collectFileIssues, QUERY_KIND } = require('./fileIssues');

const VIEW_ID     = 'jrxmlIssues';
const JRMXL_SOURCE = 'JRXML';
const DEBOUNCE_MS = 300;

function isJrxml(document) {
    return !!document && document.fileName.endsWith('.jrxml');
}

function codeString(code) {
    if (!code) return '';
    return typeof code === 'string' ? code : (code.value || '');
}

/** A vscode.Diagnostic as a plain Issue record. */
function diagnosticToIssue(diagnostic, uri) {
    const group = diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';
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
function collectIssueItems(document) {
    const uri   = document.uri;
    const items = [];

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

const GROUP_ICON = { error: 'error', warning: 'warning', action: 'lightbulb' };

function messageItem(message, icon) {
    const item = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
    item.iconPath     = new vscode.ThemeIcon(icon || 'info');
    item.contextValue = 'jrxmlIssueMessage';
    return item;
}

function groupItem(group) {
    const item = new vscode.TreeItem(
        `${group.title} (${group.items.length})`,
        vscode.TreeItemCollapsibleState.Expanded
    );
    item.iconPath     = new vscode.ThemeIcon(GROUP_ICON[group.group] || 'info');
    item.contextValue = 'jrxmlIssueGroup';
    item._groupItems  = group.items;
    return item;
}

function leafItem(issue) {
    const item = new vscode.TreeItem(issue.label, vscode.TreeItemCollapsibleState.None);
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
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
        this._document = null;
        this.groups    = [];
    }

    refresh() {
        const editor = vscode.window.activeTextEditor;
        if (!isJrxml(editor?.document)) {
            this._document = null;
            this.groups    = [];
        } else {
            this._document = editor.document;
            this.groups    = groupIssues(collectIssueItems(editor.document));
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) { return element; }

    getChildren(element) {
        if (element) return element._groupItems ? element._groupItems.map(leafItem) : [];
        if (!this._document) return [messageItem('Open a .jrxml file to see issues.')];
        if (this.groups.length === 0) return [messageItem('No issues found ✓', 'pass')];
        return this.groups.map(groupItem);
    }

    dispose() { this._onDidChangeTreeData.dispose(); }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function jumpToHit(issue) {
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

function updateBadge(view, count) {
    view.badge = count > 0
        ? { value: count, tooltip: `${count} issue${count === 1 ? '' : 's'}` }
        : undefined;
}

// ── Registration ──────────────────────────────────────────────────────────────

function register(context) {
    const provider = new IssuesProvider();
    const view = vscode.window.createTreeView(VIEW_ID, {
        treeDataProvider: provider,
        showCollapseAll:  true,
    });

    let timer;
    const refresh  = () => { provider.refresh(); updateBadge(view, countIssues(provider.groups)); };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, DEBOUNCE_MS); };

    context.subscriptions.push(
        view,
        provider,

        vscode.commands.registerCommand('jrxml.refreshIssues', refresh),
        vscode.commands.registerCommand('jrxml.issues.jumpToHit', jumpToHit),

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

module.exports = { register, collectIssueItems, VIEW_ID };
