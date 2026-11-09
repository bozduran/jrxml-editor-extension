// contextKeys.ts
// Maintains the `jrxml.has*` context keys used to gate the destructive commands
// in the JRXML editor/explorer context menu, so "Clear", "Sort" and "Migrate
// SQL" only appear when they would actually do something.

import * as vscode from 'vscode';
import { collectFileIssues, SORT_KIND, QUERY_KIND } from './fileIssues';
import { discoverClearFixes } from './xmlClear';

const KEYS = {
    sort:  'jrxml.hasSortIssue',
    sql:   'jrxml.hasSqlMigration',
    clear: 'jrxml.hasClearFixes',
};

const DEBOUNCE_MS = 300;

function isJrxml(document: vscode.TextDocument | null | undefined): document is vscode.TextDocument {
    return !!document && document.fileName.endsWith('.jrxml');
}

/** Pure: which actions the given text has available. */
function computeContextKeys(text: string): Record<string, boolean> {
    const issues = collectFileIssues(text);
    return {
        [KEYS.sort]:  issues.some(issue => issue.kind === SORT_KIND),
        [KEYS.sql]:   issues.some(issue => issue.kind === QUERY_KIND),
        [KEYS.clear]: discoverClearFixes(text).some(group => group.fixes.some(fix => fix.edit)),
    };
}

async function applyKeys(keys: Record<string, boolean>): Promise<void> {
    for (const [key, value] of Object.entries(keys)) {
        await vscode.commands.executeCommand('setContext', key, value);
    }
}

function register(context: vscode.ExtensionContext): void {
    let timer: NodeJS.Timeout | undefined;

    const update = (): void => {
        const document = vscode.window.activeTextEditor?.document;
        if (!isJrxml(document)) {
            applyKeys({ [KEYS.sort]: false, [KEYS.sql]: false, [KEYS.clear]: false });
            return;
        }
        applyKeys(computeContextKeys(document.getText()));
    };

    const schedule = (): void => { clearTimeout(timer); timer = setTimeout(update, DEBOUNCE_MS); };

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => update()),
        vscode.workspace.onDidChangeTextDocument(event => { if (isJrxml(event.document)) schedule(); }),
        vscode.workspace.onDidSaveTextDocument(document => { if (isJrxml(document)) update(); }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('jrxml')) update();
        }),
        { dispose: () => clearTimeout(timer) }
    );

    update();
}

export { register, computeContextKeys, isJrxml, KEYS };
