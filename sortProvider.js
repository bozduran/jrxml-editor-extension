// sortProvider.js
// The hook's `sort` step as an explicit command with a diff preview.
//
// Sorting rewrites the whole file, so it is never silent: the command opens a
// diff of the current document against the sorted result and only applies it
// when the user confirms (unless jrxml.sort.preview is off).

const vscode = require('vscode');
const path   = require('path');
const { discoverSortFix } = require('./xmlSort');
const preview = require('./preview');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.sortElements', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.document.fileName.endsWith('.jrxml')) {
                vscode.window.showWarningMessage('Open a .jrxml file first.');
                return;
            }

            const document = editor.document;
            const version  = document.version;
            const fix = discoverSortFix(document.getText());
            if (!fix) {
                vscode.window.showInformationMessage('Elements are already ordered by position.');
                return;
            }

            const previewUri = preview.put(path.basename(document.fileName), fix.edit.replacement);
            try {
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    document.uri,
                    previewUri,
                    `Sort elements: ${path.basename(document.fileName)}`
                );

                if (vscode.workspace.getConfiguration('jrxml').get('sort.preview', true)) {
                    const choice = await vscode.window.showInformationMessage(
                        'Apply the geometry sort?',
                        { modal: true },
                        'Apply'
                    );
                    if (choice !== 'Apply') return;
                }

                // A WorkspaceEdit applies against the current text, so refuse to
                // apply edits computed before the preview/confirmation wait.
                if (!preview.ensureUnchanged(document, version)) return;

                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(
                        document.positionAt(fix.edit.start),
                        document.positionAt(fix.edit.end)
                    ),
                    fix.edit.replacement
                );

                if (await vscode.workspace.applyEdit(edit)) {
                    vscode.window.showInformationMessage(`Sorted elements.\n${fix.description}`);
                } else {
                    vscode.window.showErrorMessage('Failed to apply the sort.');
                }
            } finally {
                preview.drop(previewUri);
            }
        })
    );
}

module.exports = { register };
