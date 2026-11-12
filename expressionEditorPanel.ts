// expressionEditorPanel.ts
// Manages the WebviewPanel that shows / edits a JRXML expression.
// The HTML document itself is built by the vscode-free expressionPanelHtml module.
//
// The document is built once per panel. Switching expressions sends it a
// loadExpression message instead of replacing webview.html, so the user's
// unsaved text, cursor and scroll position survive. Drafts are kept per
// expression while the panel is open so A -> B -> A does not lose A's edits.

import * as vscode from 'vscode';
import { formatExpression } from './expressionFormatter';
import { buildPanelHtml, getNonce } from './expressionPanelHtml';
import { applyExpressionToEditor } from './expressionApply';
import type { ExpressionTarget } from './expressionApply';
import { IfElsePanel } from './ifElsePanel';

/** One message posted by the expression webview. */
interface EditorMessage {
    command?: string;
    expression: string;
    text?: unknown;
    value?: unknown;
}

/** The message a thrown value carries, or its string form. */
function errorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
        const message = (err as { message?: unknown }).message;
        if (message) return String(message);
    }
    return String(err);
}

class ExpressionEditorPanel {
    static currentPanel: ExpressionEditorPanel | undefined = undefined;
    static viewType     = 'jrxmlExpressionEditor';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _expressionResult: ExpressionTarget;
    private _sourceEditor: vscode.TextEditor | null | undefined;
    private _disposables: vscode.Disposable[];
    private readonly _drafts: Map<string, string>;
    private _currentKey: string;
    private _rawExpression: string;
    private _formattedExpression: string;
    private _autoFormat: boolean;
    private _autoFormatTarget: vscode.ConfigurationTarget;

    constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        expressionResult: ExpressionTarget,
        sourceEditor: vscode.TextEditor | null | undefined
    ) {
        this._panel            = panel;
        this._extensionUri     = extensionUri;
        this._expressionResult = expressionResult;
        this._sourceEditor     = sourceEditor;
        this._disposables      = [];
        this._drafts           = new Map();
        this._currentKey       = this._targetKey(expressionResult, sourceEditor);
        this._rawExpression    = expressionResult.expression ?? '';
        this._formattedExpression = this._format(this._rawExpression);
        this._autoFormat       = this._readAutoFormat();
        this._autoFormatTarget = this._autoFormatUpdateTarget();

        this._buildHtml();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            (message: EditorMessage) => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    static createOrShow(
        extensionUri: vscode.Uri,
        expressionResult: ExpressionTarget,
        sourceEditor: vscode.TextEditor | null | undefined,
        { preserveFocus = false }: { preserveFocus?: boolean } = {}
    ): void {
        const column = vscode.ViewColumn.Beside;

        if (ExpressionEditorPanel.currentPanel) {
            const panel = ExpressionEditorPanel.currentPanel;
            panel._switchTo(expressionResult, sourceEditor);
            panel._panel.reveal(column, preserveFocus);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ExpressionEditorPanel.viewType,
            `Expression: <${expressionResult.tagName}>`,
            { viewColumn: column, preserveFocus },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        ExpressionEditorPanel.currentPanel = new ExpressionEditorPanel(
            panel, extensionUri, expressionResult, sourceEditor
        );
    }

    private _handleMessage(message: EditorMessage): void {
        try {
            switch (message.command) {
                case 'applyExpression':
                    void this._applyToSource(message.expression);
                    break;
                case 'formatExpression':
                    this._sendFormatted(message.expression);
                    break;
                case 'copyExpression':
                    void vscode.env.clipboard.writeText(message.expression);
                    vscode.window.showInformationMessage('Expression copied to clipboard.');
                    break;
                case 'openIfElseBuilder':
                    this._openIfElseBuilder(message.expression);
                    break;
                case 'draft':
                    this._drafts.set(this._currentKey, String(message.text == null ? '' : message.text));
                    break;
                case 'autoFormat':
                    this._setAutoFormat(message.value === true);
                    break;
            }
        } catch (err) {
            console.error('[JRXML Expression Editor] Error handling message:', err);
            this._panel.webview.postMessage({
                command: 'editorError',
                message: `Error: ${errorMessage(err)}`
            });
        }
    }

    private _targetKey(
        expressionResult: ExpressionTarget | null | undefined,
        sourceEditor: vscode.TextEditor | null | undefined
    ): string {
        if (!expressionResult) return '';
        if (!expressionResult.range || !sourceEditor || !sourceEditor.document) {
            return expressionResult.tagName || '';
        }

        const document = sourceEditor.document;
        const offset = typeof document.offsetAt === 'function'
            ? document.offsetAt(expressionResult.range.start)
            : -1;
        return `${document.uri.toString()}|${expressionResult.tagName}|${offset}`;
    }

    private _format(expression: string): string {
        try {
            const cfg = vscode.workspace.getConfiguration('jrxml');
            const indentSize = cfg.get('indentSize', 4);
            return formatExpression(expression, indentSize);
        } catch (err) {
            console.error('[JRXML Expression Editor] Error during format — showing raw expression:', err);
            return expression;
        }
    }

    private _readAutoFormat(): boolean {
        try {
            return vscode.workspace.getConfiguration('jrxml')
                .get<boolean>('expressionEditor.autoFormat', false) === true;
        } catch {
            return false;
        }
    }

    private _autoFormatUpdateTarget(): vscode.ConfigurationTarget {
        return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
    }

    private _setAutoFormat(value: boolean): void {
        this._autoFormat = value;
        this._autoFormatTarget = this._autoFormatUpdateTarget();
        vscode.workspace.getConfiguration('jrxml')
            .update('expressionEditor.autoFormat', value, this._autoFormatTarget)
            .then(undefined, (err: unknown) => {
                console.error('[JRXML Expression Editor] Could not persist auto-format:', err);
                vscode.window.showWarningMessage('Could not save the Auto-format setting.');
            });
    }

    private _switchTo(
        expressionResult: ExpressionTarget,
        sourceEditor: vscode.TextEditor | null | undefined
    ): void {
        const nextKey = this._targetKey(expressionResult, sourceEditor);
        this._expressionResult = expressionResult;
        this._sourceEditor     = sourceEditor;
        this._panel.title      = `Expression: <${expressionResult.tagName}>`;

        if (nextKey === this._currentKey) {
            // Same expression: keep the textarea exactly as it is. Only update
            // Reset's target if the file changed outside the panel.
            if (expressionResult.expression !== this._rawExpression) {
                this._rawExpression = expressionResult.expression ?? '';
                this._post({ command: 'updateRaw', raw: this._rawExpression });
            }
            return;
        }

        this._currentKey          = nextKey;
        this._rawExpression       = expressionResult.expression ?? '';
        this._formattedExpression = this._format(this._rawExpression);

        const draft = this._drafts.get(nextKey);
        this._post({
            command: 'loadExpression',
            tagName: expressionResult.tagName,
            raw: this._rawExpression,
            formatted: this._formattedExpression,
            value: typeof draft === 'string' ? draft : this._formattedExpression,
        });
    }

    private _post(message: unknown): Thenable<boolean> {
        return this._panel.webview.postMessage(message);
    }

    private async _applyToSource(newExpression: string): Promise<void> {
        let applied;
        try {
            applied = await applyExpressionToEditor(
                this._sourceEditor ?? undefined,
                this._expressionResult,
                newExpression
            );
        } catch (err) {
            console.error('[JRXML Expression Editor] Apply error:', err);
            vscode.window.showErrorMessage(`Failed to apply expression: ${errorMessage(err)}`);
            return;
        }

        if (!applied.ok) {
            if (applied.severity === 'warning') vscode.window.showWarningMessage(applied.reason ?? '');
            else vscode.window.showErrorMessage(applied.reason ?? '');
            return;
        }

        this._expressionResult = applied.expressionResult as ExpressionTarget;
        vscode.window.showInformationMessage(
            `Expression applied to <${this._expressionResult.tagName}>.`
        );
        // Close the panel — the expression is now in the file
        this.dispose();
    }

    /** Hand the current expression over to the if / else builder panel. */
    private _openIfElseBuilder(expression: string): void {
        IfElsePanel.createOrShow(this._extensionUri, {
            sourceEditor: this._sourceEditor,
            expressionResult: this._expressionResult,
            initialExpression: typeof expression === 'string' ? expression : null,
        });
    }

    private _sendFormatted(expression: string): void {
        try {
            const cfg = vscode.workspace.getConfiguration('jrxml');
            const indentSize = cfg.get('indentSize', 4);
            const formatted = formatExpression(expression, indentSize);
            this._panel.webview.postMessage({ command: 'expressionFormatted', expression: formatted });
        } catch (err) {
            console.error('[JRXML Expression Editor] Formatter error:', err);
            // Send original expression back unchanged — panel stays alive
            this._panel.webview.postMessage({
                command: 'expressionFormatted',
                expression: expression,
                warning: `Formatter error: ${errorMessage(err)}`
            });
        }
    }

    private _buildHtml(): void {
        this._panel.title = `Expression: <${this._expressionResult.tagName}>`;
        this._panel.webview.html = this._getHtml(
            this._expressionResult.tagName,
            this._rawExpression,
            this._formattedExpression
        );
    }

    private _getHtml(tagName: string, rawExpression: string, formattedExpression: string): string {
        return buildPanelHtml({
            tagName,
            rawExpression,
            formattedExpression,
            autoFormat: this._autoFormat,
            nonce: getNonce(),
            cspSource: this._panel.webview.cspSource,
        });
    }

    dispose(): void {
        ExpressionEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}

export = ExpressionEditorPanel;
