// clearProvider.js
// The hook's `clear` step as explicit commands.
//
//   jrxml.applyClearFixes  — delete unused declarations, sync descriptions and
//                            fix jsonql properties, previewed before applying
//   jrxml.migrateSqlQuery  — ask for the jsonql expression and rewrite the
//                            <query language="sql"> element
//
// Clear is destructive, so it is never automatic: the user runs a command, sees
// a diff, and confirms.

const vscode = require('vscode');
const path   = require('path');
const { discoverClearFixes, queryMigrationEdits } = require('./xmlClear');
const preview = require('./preview');

function applyEdits(document, edits) {
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
        workspaceEdit.replace(
            document.uri,
            new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
            edit.replacement
        );
    }
    return vscode.workspace.applyEdit(workspaceEdit);
}

async function confirm(message) {
    if (!vscode.workspace.getConfiguration('jrxml').get('clear.preview', true)) return true;
    const choice = await vscode.window.showInformationMessage(message, { modal: true }, 'Apply');
    return choice === 'Apply';
}

async function previewThenApply(document, text, title, edits, message) {
    const previewUri = preview.put(path.basename(document.fileName), text);
    try {
        await vscode.commands.executeCommand(
            'vscode.diff',
            document.uri,
            previewUri,
            `${title}: ${path.basename(document.fileName)}`
        );
        if (!(await confirm(message))) return false;
        return await applyEdits(document, edits);
    } finally {
        preview.drop(previewUri);
    }
}

function activeJrxmlDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.jrxml')) {
        vscode.window.showWarningMessage('Open a .jrxml file first.');
        return null;
    }
    return editor.document;
}

/** Target language for SQL query migration (default jsonql). */
function readTargetLanguage() {
    const value = vscode.workspace.getConfiguration('jrxml').get('migrate.targetLanguage', 'jsonql');
    return (typeof value === 'string' && value.trim()) ? value.trim() : 'jsonql';
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.applyClearFixes', async () => {
            const document = activeJrxmlDocument();
            if (!document) return;

            const groups = discoverClearFixes(document.getText());
            const fixes = groups.flatMap(g => g.fixes).filter(f => f.edit);
            if (fixes.length === 0) {
                vscode.window.showInformationMessage('Nothing to clear.');
                return;
            }

            const summary = groups
                .filter(g => g.fixes.some(f => f.edit))
                .map(g => `${g.label} (${g.fixes.filter(f => f.edit).length})`)
                .join(', ');

            const proposed = await proposedText(document, fixes.map(f => f.edit));
            const applied = await previewThenApply(
                document,
                proposed,
                'Clear fixes',
                fixes.map(f => f.edit),
                `Apply ${fixes.length} clear fix(es)? ${summary}`
            );
            if (applied) vscode.window.showInformationMessage(`Applied clear fixes: ${summary}.`);
        }),

        vscode.commands.registerCommand('jrxml.migrateSqlQuery', async () => {
            const document = activeJrxmlDocument();
            if (!document) return;

            const migration = discoverClearFixes(document.getText())
                .find(g => g.label === 'query migration');
            if (!migration) {
                vscode.window.showInformationMessage('No SQL <query> to migrate.');
                return;
            }

            const targetLanguage = readTargetLanguage();

            const expression = await vscode.window.showInputBox({
                prompt: `${targetLanguage} expression to replace the SQL query`,
                placeHolder: targetLanguage === 'jsonql' ? 'e.g. { "select": [...] }' : undefined,
                ignoreFocusOut: true,
            });
            // An empty answer applies nothing (matches the hook).
            if (!expression) return;

            const edits = queryMigrationEdits(migration.fixes[0].query, expression, targetLanguage);
            if (edits.length === 0) {
                vscode.window.showWarningMessage('Nothing to migrate in this query.');
                return;
            }

            const proposed = await proposedText(document, edits);
            const applied = await previewThenApply(
                document,
                proposed,
                'Migrate SQL query',
                edits,
                `Apply the ${targetLanguage} migration?`
            );
            if (applied) vscode.window.showInformationMessage(`Query migrated to ${targetLanguage}.`);
        })
    );
}

/** Apply edits in memory so the preview shows the exact result. */
async function proposedText(document, edits) {
    const { applyEdits: apply } = require('./edits');
    return apply(document.getText(), edits);
}

module.exports = { register };
