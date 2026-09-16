// JRXML Expression Editor - VS Code Extension
// extension.js

const vscode = require('vscode');
const ExpressionEditorPanel  = require('./expressionEditorPanel');
const { findExpressionAtCursor } = require('./expressionUtils');
const { provider: completionProvider, clearCustomJavaCache } = require('./completionProvider');
const { provider: hoverProvider }      = require('./hoverProvider');
const { provider: definitionProvider } = require('./definitionProvider');
const { provider: outlineProvider }    = require('./outlineProvider');
const { register: registerDiagnostics } = require('./diagnosticsProvider');
const { provider: codeActionsProvider }  = require('./codeActionsProvider');
const { register: registerBestPractices } = require('./bestPracticesProvider');
const { register: registerIssuesView } = require('./issuesView');
const {
    provider: documentFormatter,
    fixAllProvider,
    registerFormatOnSave,
} = require('./documentFormatter');
const { register: registerSort } = require('./sortProvider');
const { register: registerClear } = require('./clearProvider');
const { register: registerSettingsPanel } = require('./settingsPanel');
const { register: registerIncludeChain } = require('./includeChainView');
const { provider: previewProvider } = require('./preview');
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // ── Command: open expression editor ──────────────────────────────────────
    const openEditorCmd = vscode.commands.registerCommand(
        'jrxml.openExpressionEditor',
        () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor found.'); return; }
            if (!editor.document.fileName.endsWith('.jrxml')) {
                vscode.window.showWarningMessage('This command works on .jrxml files only.');
                return;
            }
            const result = findExpressionAtCursor(editor.document, editor.selection.active);
            if (!result) {
                vscode.window.showInformationMessage(
                    'Place your cursor inside a JRXML expression tag (<textFieldExpression>, etc.) and try again.'
                );
                return;
            }
            ExpressionEditorPanel.createOrShow(context.extensionUri, result, editor);
        }
    );

    // ── Language feature providers ────────────────────────────────────────────
    context.subscriptions.push(
        completionProvider,
        hoverProvider,
        definitionProvider,
        outlineProvider,
        codeActionsProvider,
        documentFormatter,
        fixAllProvider,
    );

    // ── Opt-in format on save (format + textcheck only) ───────────────────────
    registerFormatOnSave(context);

    // ── Explicit geometry sort (whole-file, previewed) ────────────────────────
    registerSort(context);

    // ── Clear fixes + SQL migration (destructive, previewed) ─────────────────
    registerClear(context);

    // ── Dedicated settings panel ─────────────────────────────────────────────
    registerSettingsPanel(context);

    // ── Include-chain view (where the open report is called from) ─────────────
    registerIncludeChain(context);

    // Diff previews for whole-file rewrites
    context.subscriptions.push(previewProvider);

    // The Java helper scan is cached; invalidate it when sources change.
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => clearCustomJavaCache()),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.fileName.endsWith('.java')) clearCustomJavaCache();
        }),
        vscode.workspace.onDidCreateFiles(e => {
            if (e.files.some(f => f.fsPath.endsWith('.java'))) clearCustomJavaCache();
        }),
        vscode.workspace.onDidDeleteFiles(e => {
            if (e.files.some(f => f.fsPath.endsWith('.java'))) clearCustomJavaCache();
        }),
        vscode.workspace.onDidRenameFiles(e => {
            if (e.files.some(f => f.newUri.fsPath.endsWith('.java') || f.oldUri.fsPath.endsWith('.java'))) {
                clearCustomJavaCache();
            }
        })
    );

    // ── Best practices + diagnostics ──────────────────────────────────────────
    registerIssuesView(context);
    registerBestPractices(context);
    registerDiagnostics(context);

    // Internal command used by the "Go to declaration" quick fix. Uses
    // openTextDocument so it also works for files that are not currently open.
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.goToDeclaration', async (uri, position) => {
            const document = await vscode.workspace.openTextDocument(uri);
            const target = (position && typeof position.line === 'number')
                ? new vscode.Position(position.line, position.character)
                : document.positionAt(typeof position === 'number' ? position : 0);

            const editor = await vscode.window.showTextDocument(document);
            editor.selection = new vscode.Selection(target, target);
            editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenter);
        })
    );

    // ── Status bar button ─────────────────────────────────────────────────────
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'jrxml.openExpressionEditor';
    statusBarItem.text    = '$(edit) JRXML Expr';
    statusBarItem.tooltip = 'Open JRXML Expression Editor';

    const updateStatusBar = (editor) => {
        if (editor && editor.document.fileName.endsWith('.jrxml')) statusBarItem.show();
        else statusBarItem.hide();
    };
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar, null, context.subscriptions);
    updateStatusBar(vscode.window.activeTextEditor);

    // ── Auto-open panel on cursor move (if setting enabled) ───────────────────
    vscode.window.onDidChangeTextEditorSelection((e) => {
        const cfg = vscode.workspace.getConfiguration('jrxml');
        if (!cfg.get('autoOpenEditor')) return;
        if (!e.textEditor.document.fileName.endsWith('.jrxml')) return;
        const result = findExpressionAtCursor(e.textEditor.document, e.selections[0].active);
        if (result) ExpressionEditorPanel.createOrShow(context.extensionUri, result, e.textEditor);
    }, null, context.subscriptions);

    context.subscriptions.push(openEditorCmd, statusBarItem);
}

function deactivate() {}

module.exports = { activate, deactivate };
