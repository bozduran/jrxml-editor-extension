// diagnosticsProvider.ts
// VS Code adapter for the vscode-free analysis pipeline in diagnostics.ts.
//
// The rules, messages and severities live there so the editor, the
// "Validate Workspace" command and the CI script all run the same checks.

import * as vscode from 'vscode';
import { collectFindings } from './diagnostics';
import type { Finding, FindingSettings } from './diagnostics';
import { clearCache } from './jrxmlParser';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('jrxml');

/** Flat settings object for collectFindings, read from jrxml.* configuration. */
function settingsFromConfig(cfg: vscode.WorkspaceConfiguration): FindingSettings {
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

/** Accept file documents and in-memory/virtual ones (untitled, remote). */
function isJrxmlDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'jrxml'
        || (typeof document.fileName === 'string' && document.fileName.endsWith('.jrxml'));
}

function workspaceRoots(): string[] {
    return ((vscode.workspace && vscode.workspace.workspaceFolders) || [])
        .map(folder => folder.uri && folder.uri.fsPath)
        .filter((root): root is string => Boolean(root));
}

/** VS Code carries quick-fix payloads on Diagnostic.data, which @types/vscode 1.85 omits. */
interface DiagnosticWithData extends vscode.Diagnostic {
    data?: unknown;
}

function toDiagnostic(document: vscode.TextDocument, finding: Finding): vscode.Diagnostic {
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
    if (finding.data !== undefined) (diagnostic as DiagnosticWithData).data = finding.data;
    return diagnostic;
}

/**
 * Run every check on a document and update the diagnostic collection.
 */
function updateDiagnostics(document: vscode.TextDocument): Finding[] {
    if (!isJrxmlDocument(document)) {
        diagnosticCollection.delete(document.uri);
        return [];
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
    return findings;
}

// ── Registration helper ───────────────────────────────────────────────────────

function register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(diagnosticCollection);

    // Run on open
    if (vscode.window.activeTextEditor && isJrxmlDocument(vscode.window.activeTextEditor.document)) {
        updateDiagnostics(vscode.window.activeTextEditor.document);
    }

    // Run when a jrxml doc changes (debounced 500ms)
    let debounceTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (!isJrxmlDocument(e.document)) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => updateDiagnostics(e.document), 500);
        })
    );

    // Run when switching tabs
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && isJrxmlDocument(editor.document)) {
                updateDiagnostics(editor.document);
            }
        })
    );

    // Run on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (isJrxmlDocument(doc)) updateDiagnostics(doc);
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

export { register, updateDiagnostics };
