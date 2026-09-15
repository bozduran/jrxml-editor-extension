// expressionEditorPanel.js
// Manages the WebviewPanel that shows / edits a JRXML expression.
// The HTML document itself is built by the vscode-free expressionPanelHtml module.

const vscode = require('vscode');
const { formatExpression } = require('./expressionFormatter');
const { hasCdata, wrapExpression } = require('./expressionUtils');
const { buildPanelHtml, getNonce } = require('./expressionPanelHtml');

class ExpressionEditorPanel {
    static currentPanel = undefined;
    static viewType     = 'jrxmlExpressionEditor';

    constructor(panel, extensionUri, expressionResult, sourceEditor) {
        this._panel         = panel;
        this._extensionUri  = extensionUri;
        this._expressionResult = expressionResult;
        this._sourceEditor  = sourceEditor;
        this._disposables   = [];

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    static createOrShow(extensionUri, expressionResult, sourceEditor) {
        const column = vscode.ViewColumn.Beside;

        if (ExpressionEditorPanel.currentPanel) {
            ExpressionEditorPanel.currentPanel._expressionResult = expressionResult;
            ExpressionEditorPanel.currentPanel._sourceEditor     = sourceEditor;
            ExpressionEditorPanel.currentPanel._panel.reveal(column);
            ExpressionEditorPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ExpressionEditorPanel.viewType,
            'JRXML Expression Editor',
            column,
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
            }
        } catch (err) {
            console.error('[JRXML Expression Editor] Error handling message:', err);
            this._panel.webview.postMessage({
                command: 'editorError',
                message: `Error: ${err.message || String(err)}`
            });
        }
    }

    _applyToSource(newExpression) {
        const editor = this._sourceEditor;
        if (!editor) { vscode.window.showWarningMessage('Source editor is no longer open.'); return; }

        const tagName = this._expressionResult.tagName;

        // Always re-scan the CURRENT document text — never use the stale
        // range/fullMatch from when the panel first opened. This prevents
        // double-application on repeated Apply clicks.
        const doc  = editor.document;
        const text = doc.getText();

        const tagPattern = new RegExp(
            `(<${tagName}(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/${tagName}>)`,
            'g'
        );

        // Pick the occurrence closest to the original cursor position
        const originalOffset = doc.offsetAt(this._expressionResult.range.start);
        let bestMatch    = null;
        let bestDistance = Infinity;
        let m;

        while ((m = tagPattern.exec(text)) !== null) {
            const dist = Math.abs(m.index - originalOffset);
            if (dist < bestDistance) {
                bestDistance = dist;
                bestMatch    = { index: m.index, openTag: m[1], innerOld: m[2], closeTag: m[3] };
            }
        }

        if (!bestMatch) {
            vscode.window.showErrorMessage(
                `Could not find <${tagName}> in the document. It may have been moved or renamed.`
            );
            return;
        }

        const { openTag, innerOld, closeTag } = bestMatch;
        const matchStart = bestMatch.index;
        const matchEnd   = matchStart + openTag.length + innerOld.length + closeTag.length;

        // Preserve CDATA wrapping if the original used it
        const useCdata = hasCdata(innerOld);
        const newInner = wrapExpression(newExpression, useCdata);
        const newTag   = openTag + newInner + closeTag;

        const liveRange = new vscode.Range(
            doc.positionAt(matchStart),
            doc.positionAt(matchEnd)
        );

        editor.edit(editBuilder => {
            editBuilder.replace(liveRange, newTag);
        }).then(success => {
            if (success) {
                // Update stored result so the next Apply still finds the right spot
                this._expressionResult = {
                    ...this._expressionResult,
                    expression: newExpression,
                    fullMatch:  newTag,
                    range: new vscode.Range(
                        doc.positionAt(matchStart),
                        doc.positionAt(matchStart + newTag.length)
                    )
                };
                vscode.window.showInformationMessage(`Expression applied to <${tagName}>.`);
                // Close the panel — the expression is now in the file
                this.dispose();
            } else {
                vscode.window.showErrorMessage('Failed to apply expression.');
            }
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

    _update() {
        let formatted = this._expressionResult.expression;
        try {
            const cfg = vscode.workspace.getConfiguration('jrxml');
            const indentSize = cfg.get('indentSize', 4);
            formatted = formatExpression(this._expressionResult.expression, indentSize);
        } catch (err) {
            console.error('[JRXML Expression Editor] Error during initial format — showing raw expression:', err);
            // Fall through: formatted stays as raw expression
        }

        this._panel.title = `Expression: <${this._expressionResult.tagName}>`;
        this._panel.webview.html = this._getHtml(
            this._expressionResult.tagName,
            this._expressionResult.expression,
            formatted
        );
    }

    _getHtml(tagName, rawExpression, formattedExpression) {
        return buildPanelHtml({
            tagName,
            rawExpression,
            formattedExpression,
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
