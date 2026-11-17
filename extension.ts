// JRXML Expression Editor - VS Code Extension
// extension.ts

import * as vscode from 'vscode';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- single-value CommonJS module, required as-is by the host suite
import ExpressionEditorPanel  = require('./expressionEditorPanel');
import { findExpressionAtCursor } from './expressionUtils';
import { provider as completionProvider } from './completionProvider';
import { provider as hoverProvider }      from './hoverProvider';
import { provider as definitionProvider } from './definitionProvider';
import { provider as referenceProvider }    from './referenceProvider';
import { provider as outlineProvider }    from './outlineProvider';
import { register as registerDiagnostics, refreshOpenReports } from './diagnosticsProvider';
import { clearJavaProjectIndex } from './javaProjectIndex';
import { provider as codeActionsProvider }  from './codeActionsProvider';
import { register as registerIssuesView } from './issuesView';
import { register as registerContextKeys } from './contextKeys';
import {
    provider as documentFormatter,
    fixAllProvider,
    registerFormatOnSave,
    registerFixAllCommand,
} from './documentFormatter';
import { register as registerSort } from './sortProvider';
import { register as registerClear } from './clearProvider';
import { register as registerSettingsPanel } from './settingsPanel';
import { register as registerTutorial } from './tutorialPanel';
import { register as registerIncludeChain } from './includeChainView';
import { register as registerIfElsePanel } from './ifElsePanel';
import { register as registerExpressionActions } from './expressionActions';
import { register as registerDesignView } from './designViewPanel';
import { register as registerWorkspaceValidation } from './workspaceValidation';
import { register as registerBuildBridge } from './buildBridge';
import { provider as previewProvider } from './preview';

function activate(context: vscode.ExtensionContext): void {
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

    // ── Language feature providers ────────────────────────────────────────────
    context.subscriptions.push(
        completionProvider,
        hoverProvider,
        definitionProvider,
        referenceProvider,
        outlineProvider,
        codeActionsProvider,
        documentFormatter,
        fixAllProvider,
    );

    // ── Opt-in format on save (format + textcheck only) ───────────────────────
    registerFormatOnSave(context);

    // ── "Fix all format and text issues" command (context menu) ──────────────
    registerFixAllCommand(context);

    // ── Format Document command used by the JRXML menu ────────────────────────
    // Menu items must reference a command contributed by this extension; the
    // wrapper keeps the built-in `editor.action.formatDocument` out of the
    // manifest (which VS Code flags as an undefined command).
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.formatDocument', async (): Promise<void> => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.document.fileName.endsWith('.jrxml')) {
                vscode.window.showWarningMessage('The JRXML formatter works on .jrxml files only.');
                return;
            }
            await vscode.commands.executeCommand('editor.action.formatDocument');
        })
    );

    // ── Context keys that gate Clear/Sort/SQL in the JRXML menu ──────────────
    registerContextKeys(context);

    // ── Explicit geometry sort (whole-file, previewed) ────────────────────────
    registerSort(context);

    // ── Clear fixes + SQL migration (destructive, previewed) ─────────────────
    registerClear(context);

    // ── Dedicated settings panel ─────────────────────────────────────────────
    registerSettingsPanel(context);

    // ── Built-in tutorial (opened from Settings) ─────────────────────────────
    registerTutorial(context);

    // ── If / Else expression builder panel (reads the open .jrxml schema) ────
    registerIfElsePanel(context);

    // ── Shared "open the expression here" actions (issues + code actions) ────
    registerExpressionActions(context);

    // ── Include-chain view (where the open report is called from) ─────────────
    registerIncludeChain(context);

    // ── Read-only design view (Jaspersoft Studio style) ───────────────────────
    registerDesignView(context);
    registerWorkspaceValidation(context);
    registerBuildBridge(context);

    // Diff previews for whole-file rewrites
    context.subscriptions.push(previewProvider);

    // The Java project index is cached; drop it when sources or the scan
    // setting change, and re-run the open reports that may depend on it.
    const invalidateJava = (): void => {
        clearJavaProjectIndex();
        refreshOpenReports();
    };
    const touchesJava = (paths: readonly string[]): boolean =>
        paths.some(fsPath => fsPath.endsWith('.java'));

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => invalidateJava()),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (touchesJava([doc.fileName])) invalidateJava();
        }),
        vscode.workspace.onDidCreateFiles(e => {
            if (touchesJava(e.files.map(file => file.fsPath))) invalidateJava();
        }),
        vscode.workspace.onDidDeleteFiles(e => {
            if (touchesJava(e.files.map(file => file.fsPath))) invalidateJava();
        }),
        vscode.workspace.onDidRenameFiles(e => {
            if (touchesJava(e.files.flatMap(file => [file.oldUri.fsPath, file.newUri.fsPath]))) invalidateJava();
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('jrxml.java.sourcePaths')) invalidateJava();
        })
    );

    // ── Diagnostics and issues ───────────────────────────────────────────────
    registerIssuesView(context);
    registerDiagnostics(context);

    // Internal command used by the "Go to declaration" quick fix. Uses
    // openTextDocument so it also works for files that are not currently open.
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.goToDeclaration', async (
            uri: vscode.Uri,
            position?: vscode.Position | number | null
        ): Promise<void> => {
            const document = await vscode.workspace.openTextDocument(uri);
            const target = (position && typeof position === 'object' && typeof position.line === 'number')
                ? new vscode.Position(position.line, position.character)
                : document.positionAt(typeof position === 'number' ? position : 0);

            const editor = await vscode.window.showTextDocument(document);
            editor.selection = new vscode.Selection(target, target);
            editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenter);
        })
    );

    // ── Status bar button ─────────────────────────────────────────────────────
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'jrxml.openExpressionEditor';
    statusBarItem.text    = '$(edit) JRXML Expr';
    statusBarItem.tooltip = 'Open JRXML Expression Editor';

    const updateStatusBar = (editor: vscode.TextEditor | undefined): void => {
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
        if (result) ExpressionEditorPanel.createOrShow(context.extensionUri, result, e.textEditor, { preserveFocus: true });
    }, null, context.subscriptions);

    context.subscriptions.push(openEditorCmd, statusBarItem);
}

function deactivate(): void {}

export { activate, deactivate };
