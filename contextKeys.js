// contextKeys.js
// Maintains the `jrxml.has*` context keys used to gate the destructive commands
// in the JRXML editor/explorer context menu, so "Clear", "Sort" and "Migrate
// SQL" only appear when they would actually do something.

const vscode = require('vscode');
const { collectFileIssues, SORT_KIND, QUERY_KIND } = require('./fileIssues');
const { discoverClearFixes } = require('./xmlClear');

const KEYS = {
    sort:  'jrxml.hasSortIssue',
    sql:   'jrxml.hasSqlMigration',
    clear: 'jrxml.hasClearFixes',
};

const DEBOUNCE_MS = 300;

function isJrxml(document) {
    return !!document && document.fileName.endsWith('.jrxml');
}

/** Pure: which actions the given text has available. */
function computeContextKeys(text) {
    const issues = collectFileIssues(text);
    return {
        [KEYS.sort]:  issues.some(issue => issue.kind === SORT_KIND),
        [KEYS.sql]:   issues.some(issue => issue.kind === QUERY_KIND),
        [KEYS.clear]: discoverClearFixes(text).some(group => group.fixes.some(fix => fix.edit)),
    };
}

async function applyKeys(keys) {
    for (const [key, value] of Object.entries(keys)) {
        await vscode.commands.executeCommand('setContext', key, value);
    }
}

function register(context) {
    let timer;

    const update = () => {
        const document = vscode.window.activeTextEditor?.document;
        if (!isJrxml(document)) {
            applyKeys({ [KEYS.sort]: false, [KEYS.sql]: false, [KEYS.clear]: false });
            return;
        }
        applyKeys(computeContextKeys(document.getText()));
    };

    const schedule = () => { clearTimeout(timer); timer = setTimeout(update, DEBOUNCE_MS); };

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

module.exports = { register, computeContextKeys, isJrxml, KEYS };
