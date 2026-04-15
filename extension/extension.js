// JRXML Expression Editor - VS Code Extension
// extension.js

const vscode = require('vscode');
const ExpressionEditorPanel  = require('./expressionEditorPanel');
const { findExpressionAtCursor, EXPRESSION_TAGS } = require('./expressionUtils');
const { formatExpression }   = require('./expressionFormatter');
const { provider: completionProvider } = require('./completionProvider');
const { provider: hoverProvider }      = require('./hoverProvider');
const { provider: definitionProvider } = require('./definitionProvider');
const { provider: outlineProvider }    = require('./outlineProvider');
const { register: registerDiagnostics } = require('./diagnosticsProvider');
const { parseDeclarations } = require('./jrxmlParser');
const { provider: codeActionsProvider }  = require('./codeActionsProvider');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('JRXML Expression Editor activated');

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

    // ── On-Save full formatting ───────────────────────────────────────────────
    const onSaveListener = vscode.workspace.onWillSaveTextDocument((e) => {
        if (!e.document.fileName.endsWith('.jrxml')) return;
        const cfg = vscode.workspace.getConfiguration('jrxml');
        if (cfg.get('formatOnSave') === false) return;
        return;
        e.waitUntil(applyOnSaveFormatting(e.document));
    });

    // ── Language feature providers ────────────────────────────────────────────
    context.subscriptions.push(completionProvider);
    context.subscriptions.push(hoverProvider);
    context.subscriptions.push(definitionProvider);
    context.subscriptions.push(outlineProvider);

    // ── Diagnostics (unused + validation) ────────────────────────────────────
    registerDiagnostics(context);

    // ── Code actions (quick fixes) ────────────────────────────────────────────
    context.subscriptions.push(codeActionsProvider);

    // Internal command used by the "Go to declaration" quick fix
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.goToDeclaration', (uri, position) => {
            const parsed = parseDeclarations(
                vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())
            );
            if (!parsed) return;
            vscode.window.showTextDocument(uri).then(editor => {
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            });
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

    //context.subscriptions.push(openEditorCmd, statusBarItem)
    context.subscriptions.push(openEditorCmd, statusBarItem, onSaveListener);
}

// ── On-save formatter ─────────────────────────────────────────────────────────

async function applyOnSaveFormatting(document) {
    const text  = document.getText();
    const edits = [];

    const tagPattern = new RegExp(
        `(<(?:${EXPRESSION_TAGS.join('|')})(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/(?:${EXPRESSION_TAGS.join('|')})>)`,
        'g'
    );

    let match;
    while ((match = tagPattern.exec(text)) !== null) {
        const openTag  = match[1];
        const inner    = match[2];
        const closeTag = match[3];

        const hasCdata = /^\s*<!\[CDATA\[/.test(inner);
        const rawExpr  = inner.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');

        let formatted;
        try {
            const cfg      = vscode.workspace.getConfiguration('jrxml');
            const indentSize = cfg.get('indentSize', 4);
            formatted = formatExpression(rawExpr, indentSize);
        } catch (_) {
            continue;
        }

        if (formatted === rawExpr) continue;

        const newInner = hasCdata ? `<![CDATA[${formatted}]]>` : formatted;
        if (newInner === inner) continue;

        const innerStart = match.index + openTag.length;
        const innerEnd   = innerStart + inner.length;

        edits.push(vscode.TextEdit.replace(
            new vscode.Range(document.positionAt(innerStart), document.positionAt(innerEnd)),
            newInner
        ));
    }

    return edits;
}

function deactivate() {}

module.exports = { activate, deactivate };
