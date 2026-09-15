// sortProvider.js
// The hook's `sort` step as an explicit command with a diff preview.
//
// Sorting rewrites the whole file, so it is never silent: the command opens a
// diff of the current document against the sorted result and only applies it
// when the user confirms.

const vscode = require('vscode');
const path   = require('path');
const { discoverSortFix } = require('./xmlSort');

const SCHEME = 'jrxml-sort-preview';
const previews = new Map();

const contentProvider = vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
    provideTextDocumentContent(uri) {
        return previews.get(uri.toString()) || '';
    },
});

function register(context) {
    context.subscriptions.push(contentProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.sortElements', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.document.fileName.endsWith('.jrxml')) {
                vscode.window.showWarningMessage('Open a .jrxml file first.');
                return;
            }

            const document = editor.document;
            const fix = discoverSortFix(document.getText());
            if (!fix) {
                vscode.window.showInformationMessage('Elements are already ordered by position.');
                return;
            }

            const previewUri = vscode.Uri.from({
                scheme: SCHEME,
                path:   '/' + path.basename(document.fileName),
                query:  String(Date.now()),
            });
            previews.set(previewUri.toString(), fix.edit.replacement);

            try {
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    document.uri,
                    previewUri,
                    `Sort elements: ${path.basename(document.fileName)}`
                );

                const preview = vscode.workspace.getConfiguration('jrxml').get('sort.preview', true);
                if (preview) {
                    const choice = await vscode.window.showInformationMessage(
                        'Apply the geometry sort?',
                        { modal: true },
                        'Apply'
                    );
                    if (choice !== 'Apply') return;
                }

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
                previews.delete(previewUri.toString());
            }
        })
    );
}

module.exports = { register, SCHEME };
