// documentFormatter.js
// Document formatting for .jrxml: the hook's `format` + `textcheck` steps.
//
// Returns the combined edits as a DocumentFormattingEditProvider (Format
// Document), a `source.fixAll.jrxml` code action, and an opt-in format-on-save
// path. Only format + textcheck run here — never the destructive clear/sort
// steps.

const vscode = require('vscode');
const path   = require('path');
const { combinedFormatterEdits } = require('./xmlRules');

function readSettings() {
    const cfg = vscode.workspace.getConfiguration('jrxml');
    return {
        reportName:   cfg.get('format.reportName', true),
        positionType: cfg.get('format.positionType', true),
        textAdjust:   cfg.get('format.textAdjust', true),
        expression:   cfg.get('format.expression', true),
        textcheck:    cfg.get('textcheck.enabled', true),
    };
}

/** File base name without extension — the expected `jasperReport/@name`. */
function baseNameOf(document) {
    const name = path.basename(document.fileName);
    const dot  = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Formatting edits for a document, or null when there is nothing to do.
 * @returns {vscode.TextEdit[]|null}
 */
function computeEdits(document) {
    if (!document.fileName.endsWith('.jrxml')) return null;

    const edits = combinedFormatterEdits(document.getText(), baseNameOf(document), readSettings());
    if (edits.length === 0) return null;

    return edits.map(edit => vscode.TextEdit.replace(
        new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
        edit.replacement
    ));
}

// ── Format Document ───────────────────────────────────────────────────────────

const provider = vscode.languages.registerDocumentFormattingEditProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideDocumentFormattingEdits(document) {
            return computeEdits(document) || [];
        }
    }
);

// ── "Fix all" code action ─────────────────────────────────────────────────────

const fixAllKind = vscode.CodeActionKind.SourceFixAll.append('jrxml');

const fixAllProvider = vscode.languages.registerCodeActionsProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideCodeActions(document) {
            const edits = computeEdits(document);
            if (!edits) return [];

            const action = new vscode.CodeAction(
                'Fix all JRXML format and text issues',
                fixAllKind
            );
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(document.uri, edits);
            action.edit = workspaceEdit;
            return [action];
        }
    },
    { providedCodeActionKinds: [fixAllKind] }
);

// ── Opt-in format on save ─────────────────────────────────────────────────────

function registerFormatOnSave(context) {
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(event => {
            const cfg = vscode.workspace.getConfiguration('jrxml');
            if (!cfg.get('formatOnSave', false)) return;

            const edits = computeEdits(event.document);
            if (edits && edits.length) event.waitUntil(Promise.resolve(edits));
        })
    );
}

// ── "Fix all format and text issues" command ──────────────────────────────────

function registerFixAllCommand(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.fixAllFormat', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.document.fileName.endsWith('.jrxml')) {
                vscode.window.showWarningMessage('Open a .jrxml file first.');
                return;
            }

            const edits = computeEdits(editor.document);
            if (!edits || edits.length === 0) {
                vscode.window.showInformationMessage('Nothing to format.');
                return;
            }

            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(editor.document.uri, edits);
            if (await vscode.workspace.applyEdit(workspaceEdit)) {
                vscode.window.showInformationMessage('Applied JRXML format and text fixes.');
            }
        })
    );
}

module.exports = {
    provider,
    fixAllProvider,
    registerFormatOnSave,
    registerFixAllCommand,
    computeEdits,
    baseNameOf,
};
