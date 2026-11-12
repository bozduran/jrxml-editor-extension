// clearProvider.ts
// The hook's `clear` step as explicit commands.
//
//   jrxml.applyClearFixes  — delete unused declarations, sync descriptions and
//                            fix jsonql properties, previewed before applying
//   jrxml.migrateSqlQuery  — ask for the jsonql expression and rewrite the
//                            <query language="sql"> element
//
// Clear is destructive, so it is never automatic: the user runs a command, sees
// a diff, and confirms (unless jrxml.clear.confirm is off).

import * as vscode from 'vscode';
import * as path from 'path';
import { discoverClearFixes, queryMigrationEdits } from './xmlClear';
import type { ClearFix } from './xmlClear';
import * as preview from './preview';
import { applyEdits as applyTextEdits } from './edits';
import type { Edit } from './edits';

/** A clear fix that actually carries an edit. */
type EditableFix = ClearFix & { edit: Edit };

function applyEdits(document: vscode.TextDocument, edits: readonly Edit[]): Thenable<boolean> {
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

async function confirm(message: string): Promise<boolean> {
    if (!vscode.workspace.getConfiguration('jrxml').get('clear.confirm', true)) return true;
    const choice = await vscode.window.showInformationMessage(message, { modal: true }, 'Apply');
    return choice === 'Apply';
}

async function previewThenApply(
    document: vscode.TextDocument,
    version: number,
    text: string,
    title: string,
    edits: readonly Edit[],
    message: string
): Promise<boolean> {
    const previewUri = preview.put(path.basename(document.fileName), text);
    try {
        await vscode.commands.executeCommand(
            'vscode.diff',
            document.uri,
            previewUri,
            `${title}: ${path.basename(document.fileName)}`
        );
        if (!(await confirm(message))) return false;

        // The edits were computed before the diff and the prompt; a WorkspaceEdit
        // applies its ranges to the document as it is now, so refuse to apply
        // them if the file moved on in the meantime.
        if (!preview.ensureUnchanged(document, version)) return false;

        return await applyEdits(document, edits);
    } finally {
        preview.drop(previewUri);
    }
}

function activeJrxmlDocument(): vscode.TextDocument | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.jrxml')) {
        vscode.window.showWarningMessage('Open a .jrxml file first.');
        return null;
    }
    return editor.document;
}

/** Target language for SQL query migration (default jsonql). */
function readTargetLanguage(): string {
    const value = vscode.workspace.getConfiguration('jrxml').get('migrate.targetLanguage', 'jsonql');
    return (typeof value === 'string' && value.trim()) ? value.trim() : 'jsonql';
}

function register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.applyClearFixes', async (): Promise<void> => {
            const document = activeJrxmlDocument();
            if (!document) return;

            const version = document.version;
            const groups = discoverClearFixes(document.getText());
            const fixes = groups
                .flatMap(g => g.fixes)
                .filter((fix): fix is EditableFix => !!fix.edit)
                .map(fix => fix.edit);
            if (fixes.length === 0) {
                vscode.window.showInformationMessage('Nothing to clear.');
                return;
            }

            const summary = groups
                .filter(g => g.fixes.some(f => f.edit))
                .map(g => `${g.label} (${g.fixes.filter(f => f.edit).length})`)
                .join(', ');

            const proposed = await proposedText(document, fixes);
            const applied = await previewThenApply(
                document,
                version,
                proposed,
                'Clear fixes',
                fixes,
                `Apply ${fixes.length} clear fix(es)? ${summary}`
            );
            if (applied) vscode.window.showInformationMessage(`Applied clear fixes: ${summary}.`);
        }),

        vscode.commands.registerCommand('jrxml.migrateSqlQuery', async (): Promise<void> => {
            const document = activeJrxmlDocument();
            if (!document) return;

            const version = document.version;
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
                version,
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
async function proposedText(document: vscode.TextDocument, edits: readonly Edit[]): Promise<string> {
    return applyTextEdits(document.getText(), edits);
}

export { register };
