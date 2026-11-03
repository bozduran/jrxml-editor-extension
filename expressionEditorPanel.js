// expressionEditorPanel.js
// Manages the WebviewPanel that shows / edits a JRXML expression.
// The HTML document itself is built by the vscode-free expressionPanelHtml module.
//
// The document is built once per panel. Switching expressions sends it a
// loadExpression message instead of replacing webview.html, so the user's
// unsaved text, cursor and scroll position survive. Drafts are kept per
// expression while the panel is open so A -> B -> A does not lose A's edits.

const vscode = require('vscode');
const { formatExpression } = require('./expressionFormatter');
const { buildPanelHtml, getNonce } = require('./expressionPanelHtml');
const { applyExpressionToEditor } = require('./expressionApply');
const { IfElsePanel } = require('./ifElsePanel');

class ExpressionEditorPanel {
    static currentPanel = undefined;
    static viewType     = 'jrxmlExpressionEditor';

    constructor(panel, extensionUri, expressionResult, sourceEditor) {
        this._panel            = panel;
        this._extensionUri     = extensionUri;
        this._expressionResult = expressionResult;
        this._sourceEditor     = sourceEditor;
        this._disposables      = [];
        this._drafts           = new Map();
        this._currentKey       = this._targetKey(expressionResult, sourceEditor);
        this._rawExpression    = expressionResult.expression;
        this._formattedExpression = this._format(this._rawExpression);
        this._autoFormat       = this._readAutoFormat();
        this._autoFormatTarget = this._autoFormatUpdateTarget();

        this._buildHtml();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    static createOrShow(extensionUri, expressionResult, sourceEditor, { preserveFocus = false } = {}) {
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

    _handleMessage(message) {
        try {
            switch (message.command) {
                case 'applyExpression':
                    this._applyToSource(message.expression);
                    break;
                case 'formatExpression':
                    this._sendFormatted(message.expression);
                    break;
                case 'copyExpression':
                    vscode.env.clipboard.writeText(message.expression);
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
                message: `Error: ${err.message || String(err)}`
            });
        }
    }

    _targetKey(expressionResult, sourceEditor) {
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

    _format(expression) {
        try {
            const cfg = vscode.workspace.getConfiguration('jrxml');
            const indentSize = cfg.get('indentSize', 4);
            return formatExpression(expression, indentSize);
        } catch (err) {
            console.error('[JRXML Expression Editor] Error during format — showing raw expression:', err);
            return expression;
        }
    }

    _readAutoFormat() {
        try {
            return vscode.workspace.getConfiguration('jrxml')
                .get('expressionEditor.autoFormat', false) === true;
        } catch (_err) {
            return false;
        }
    }

    _autoFormatUpdateTarget() {
        return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
    }

    _setAutoFormat(value) {
        this._autoFormat = value;
        this._autoFormatTarget = this._autoFormatUpdateTarget();
        vscode.workspace.getConfiguration('jrxml')
            .update('expressionEditor.autoFormat', value, this._autoFormatTarget)
            .then(undefined, err => {
                console.error('[JRXML Expression Editor] Could not persist auto-format:', err);
                vscode.window.showWarningMessage('Could not save the Auto-format setting.');
            });
    }

    _switchTo(expressionResult, sourceEditor) {
        const nextKey = this._targetKey(expressionResult, sourceEditor);
        this._expressionResult = expressionResult;
        this._sourceEditor     = sourceEditor;
        this._panel.title      = `Expression: <${expressionResult.tagName}>`;

        if (nextKey === this._currentKey) {
            // Same expression: keep the textarea exactly as it is. Only update
            // Reset's target if the file changed outside the panel.
            if (expressionResult.expression !== this._rawExpression) {
                this._rawExpression = expressionResult.expression;
                this._post({ command: 'updateRaw', raw: this._rawExpression });
            }
            return;
        }

        this._currentKey          = nextKey;
        this._rawExpression       = expressionResult.expression;
        this._formattedExpression = this._format(expressionResult.expression);

        const draft = this._drafts.get(nextKey);
        this._post({
            command: 'loadExpression',
            tagName: expressionResult.tagName,
            raw: this._rawExpression,
            formatted: this._formattedExpression,
            value: typeof draft === 'string' ? draft : this._formattedExpression,
        });
    }

    _post(message) {
        return this._panel.webview.postMessage(message);
    }

    async _applyToSource(newExpression) {
        let applied;
        try {
            applied = await applyExpressionToEditor(
                this._sourceEditor,
                this._expressionResult,
                newExpression
            );
        } catch (err) {
            console.error('[JRXML Expression Editor] Apply error:', err);
            vscode.window.showErrorMessage(`Failed to apply expression: ${err.message || err}`);
            return;
        }

        if (!applied.ok) {
            if (applied.severity === 'warning') vscode.window.showWarningMessage(applied.reason);
            else vscode.window.showErrorMessage(applied.reason);
            return;
        }

        this._expressionResult = applied.expressionResult;
        vscode.window.showInformationMessage(
            `Expression applied to <${this._expressionResult.tagName}>.`
        );
        // Close the panel — the expression is now in the file
        this.dispose();
    }

    /** Hand the current expression over to the if / else builder panel. */
    _openIfElseBuilder(expression) {
        IfElsePanel.createOrShow(this._extensionUri, {
            sourceEditor: this._sourceEditor,
            expressionResult: this._expressionResult,
            initialExpression: typeof expression === 'string' ? expression : null,
        });
    }

    _sendFormatted(expression) {
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
                warning: `Formatter error: ${err.message || String(err)}`
            });
        }
    }

    _buildHtml() {
        this._panel.title = `Expression: <${this._expressionResult.tagName}>`;
        this._panel.webview.html = this._getHtml(
            this._expressionResult.tagName,
            this._rawExpression,
            this._formattedExpression
        );
    }

    _getHtml(tagName, rawExpression, formattedExpression) {
        return buildPanelHtml({
            tagName,
            rawExpression,
            formattedExpression,
            autoFormat: this._autoFormat,
            nonce: getNonce(),
            cspSource: this._panel.webview.cspSource,
        });
    }

    dispose() {
        ExpressionEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}

module.exports = ExpressionEditorPanel;
