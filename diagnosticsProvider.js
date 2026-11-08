// diagnosticsProvider.js
// VS Code adapter for the vscode-free analysis pipeline in diagnostics.js.
//
// The rules, messages and severities live there so the editor, the
// "Validate Workspace" command and the CI script all run the same checks.

const vscode = require('vscode');
const { collectFindings } = require('./diagnostics');
const { clearCache } = require('./jrxmlParser');

const diagnosticCollection = vscode.languages.createDiagnosticCollection('jrxml');

/** Flat settings object for collectFindings, read from jrxml.* configuration. */
function settingsFromConfig(cfg) {
    return {
        unused:             cfg.get('showUnusedWarnings', true),
        expressions:        cfg.get('validateExpressions', true),
        booleanEquals:      cfg.get('lint.booleanEquals', true),
        constantPrintWhen:  cfg.get('lint.constantPrintWhen', true),
        removeLineWhenBlank: cfg.get('lint.removeLineWhenBlank', true),
        markupTagWithoutMarkup: cfg.get('lint.markupTagWithoutMarkup', true),
        variableOrder:      cfg.get('lint.variableOrder', true),
        duplicateNames:     cfg.get('lint.duplicateNames', true),
        layout:             cfg.get('lint.layout', true),
        queries:            cfg.get('lint.queries', true),
        textcheck:          cfg.get('textcheck.diagnostics', true),
    };
}

function workspaceRoots() {
    return ((vscode.workspace && vscode.workspace.workspaceFolders) || [])
        .map(folder => folder.uri && folder.uri.fsPath)
        .filter(Boolean);
}

function toDiagnostic(document, finding) {
    const start = document.positionAt(finding.offset);
    const end   = document.positionAt(finding.offset + finding.length);
    const severity = finding.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning;

    const diagnostic = new vscode.Diagnostic(
        new vscode.Range(start, end), finding.message, severity
    );
    diagnostic.source = 'JRXML';
    diagnostic.code   = finding.code;
    if (finding.data !== undefined) diagnostic.data = finding.data;
    return diagnostic;
}

/**
 * Run every check on a document and update the diagnostic collection.
 * @param {vscode.TextDocument} document
 */
function updateDiagnostics(document) {
    if (!document.fileName.endsWith('.jrxml')) {
        diagnosticCollection.delete(document.uri);
        return;
    }

    const findings = collectFindings({
        text: document.getText(),
        fileName: document.fileName,
        settings: settingsFromConfig(vscode.workspace.getConfiguration('jrxml')),
        workspaceRoots: workspaceRoots(),
    });

    diagnosticCollection.set(
        document.uri,
        findings.map(finding => toDiagnostic(document, finding))
    );
}

// ── Registration helper ───────────────────────────────────────────────────────

function register(context) {
    context.subscriptions.push(diagnosticCollection);

    // Run on open
    if (vscode.window.activeTextEditor?.document.fileName.endsWith('.jrxml')) {
        updateDiagnostics(vscode.window.activeTextEditor.document);
    }

    // Run when a jrxml doc changes (debounced 500ms)
    let debounceTimer;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (!e.document.fileName.endsWith('.jrxml')) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => updateDiagnostics(e.document), 500);
        })
    );

    // Run when switching tabs
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor?.document.fileName.endsWith('.jrxml')) {
                updateDiagnostics(editor.document);
            }
        })
    );

    // Run on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.fileName.endsWith('.jrxml')) updateDiagnostics(doc);
        })
    );

    // Clean up when a file is closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnosticCollection.delete(doc.uri);
            clearCache(doc.uri);
        }),
        // Cancel a pending debounce when the extension deactivates
        { dispose: () => clearTimeout(debounceTimer) }
    );
}

module.exports = { register, updateDiagnostics, settingsFromConfig };
