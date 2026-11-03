// ifElsePanel.js
// Host side of the If / Else expression builder webview.
//
// The panel reads the attached .jrxml with the shared declaration parser so
// the webview never needs a file upload. The document itself is built by the
// vscode-free ifElsePanelHtml module.

const path = require('path');
const vscode = require('vscode');

const { parseDeclarations } = require('./jrxmlParser');
const { BUILTIN_VARIABLES, BUILTIN_PARAMETERS } = require('./jasperBuiltins');
const { makeSchema } = require('./ifElseBuilder');
const { buildIfElsePanelHtml, getNonce } = require('./ifElsePanelHtml');
const { findExpressionAtCursor } = require('./expressionUtils');
const { applyExpressionToEditor } = require('./expressionApply');

const VIEW_TYPE = 'jrxmlIfElseBuilder';
const PANEL_TITLE = 'If / Else Builder';
const SCHEMA_DEBOUNCE_MS = 300;

function isJrxmlDocument(document) {
    return !!document && document.fileName.endsWith('.jrxml');
}

function sameDocument(left, right) {
    return !!left && !!right && left.uri.toString() === right.uri.toString();
}

/** Find the expression tag under the editor cursor or selection. */
function findTargetAtEditor(editor) {
    if (!editor || !isJrxmlDocument(editor.document)) return null;
    const document = editor.document;
    for (const position of [editor.selection.active, editor.selection.start, editor.selection.end]) {
        const found = findExpressionAtCursor(document, position);
        if (found) return found;
    }
    return null;
}

/** Read the builder defaults from the jrxml settings section. */
function readOptions() {
    const config = vscode.workspace.getConfiguration('jrxml');
    return {
        nullSafe: config.get('ifElse.nullSafe', true) !== false,
        multiline: config.get('ifElse.multiline', true) !== false,
        style: config.get('ifElse.style', 'ternary') === 'functions' ? 'functions' : 'ternary',
    };
}

/**
 * Parse the report's fields/parameters/variables and add the JasperReports
 * built-ins. Errors are returned, never thrown into the panel.
 *
 * @param {import('vscode').TextDocument|null} document
 * @returns {{schema: object|null, error: string|null}}
 */
function readSchema(document) {
    if (!isJrxmlDocument(document) || document.isClosed) return { schema: null, error: null };
    try {
        const parsed = parseDeclarations(document);
        return {
            schema: makeSchema({
                fields: parsed.fields,
                parameters: parsed.parameters,
                variables: parsed.variables,
                builtinVariables: BUILTIN_VARIABLES,
                builtinParameters: BUILTIN_PARAMETERS,
            }),
            error: null,
        };
    } catch (err) {
        console.error('[JRXML If/Else Builder] Could not read the schema:', err);
        return { schema: null, error: err && err.message ? err.message : String(err) };
    }
}

class IfElsePanel {
    static currentPanel = undefined;
    static viewType = VIEW_TYPE;

    constructor(panel, extensionUri, { sourceEditor = null, expressionResult = null, initialExpression = null } = {}) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._sourceEditor = sourceEditor;
        this._expressionResult = expressionResult;
        this._schemaDocument = sourceEditor ? sourceEditor.document : null;
        this._initialExpression = initialExpression || null;
        this._options = readOptions();
        this._disposables = [];
        this._schemaDebounce = null;

        const { schema, error } = readSchema(this._schemaDocument);
        this._schema = schema;
        this._schemaError = error;
        this._schemaFingerprint = this._fingerprint(schema, error);
        this._activeFile = this._activeFilePayload();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );

        vscode.window.onDidChangeActiveTextEditor(
            editor => this._handleActiveEditorChange(editor),
            null,
            this._disposables
        );
        vscode.workspace.onDidSaveTextDocument(
            document => {
                if (sameDocument(document, this._schemaDocument)) this._postSchema();
            },
            null,
            this._disposables
        );
        vscode.workspace.onDidChangeTextDocument(
            event => this._handleDocumentChange(event.document),
            null,
            this._disposables
        );
        vscode.workspace.onDidCloseTextDocument(
            document => {
                if (!sameDocument(document, this._schemaDocument)) return;
                this._postNotice('warn', `${path.basename(document.fileName)} was closed. Names are from the last read.`);
            },
            null,
            this._disposables
        );

        this._update();
    }

    static createOrShow(extensionUri, {
        sourceEditor = null,
        expressionResult = null,
        initialExpression = null,
    } = {}) {
        const column = vscode.ViewColumn.Beside;

        if (IfElsePanel.currentPanel) {
            const panel = IfElsePanel.currentPanel;
            panel._attach(sourceEditor, expressionResult);
            panel._panel.reveal(column);
            panel._postSchema();
            panel._postTarget();
            panel._postActiveFile();

            if (initialExpression && initialExpression.trim()) {
                panel._post({
                    command: 'loadExpression',
                    text: initialExpression,
                    tagName: panel._expressionResult ? panel._expressionResult.tagName : null,
                });
            } else {
                panel._postNotice('info', 'Builder already open — schema and apply target refreshed.');
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            PANEL_TITLE,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [],
            }
        );

        IfElsePanel.currentPanel = new IfElsePanel(panel, extensionUri, {
            sourceEditor,
            expressionResult,
            initialExpression,
        });
    }

    // ── Webview document ─────────────────────────────────────────────────────

    _update() {
        this._panel.title = PANEL_TITLE;
        this._panel.webview.html = buildIfElsePanelHtml({
            fileName: this._schemaDocument ? path.basename(this._schemaDocument.fileName) : null,
            schema: this._schema,
            schemaError: this._schemaError,
            expression: this._initialExpression,
            targetTagName: this._expressionResult ? this._expressionResult.tagName : null,
            canApply: !!this._expressionResult,
            options: this._options,
            activeFile: this._activeFile,
            nonce: getNonce(),
            cspSource: this._panel.webview.cspSource,
        });
    }

    _post(message) {
        return this._panel.webview.postMessage(message);
    }

    _postNotice(level, message) {
        this._post({ command: 'notice', level, message });
    }

    _postTarget() {
        this._post({
            command: 'target',
            canApply: !!this._expressionResult,
            tagName: this._expressionResult ? this._expressionResult.tagName : null,
        });
    }

    // ── Schema ───────────────────────────────────────────────────────────────

    _fingerprint(schema, error) {
        return JSON.stringify({ schema: schema || null, error: error || null });
    }

    _postSchema() {
        if (this._schemaDocument && !this._schemaDocument.isClosed) {
            const { schema, error } = readSchema(this._schemaDocument);
            this._schema = schema;
            this._schemaError = error;
            this._schemaFingerprint = this._fingerprint(schema, error);
        }
        this._postSchemaPayload();
    }

    _postSchemaPayload() {
        this._post({
            command: 'schema',
            fileName: this._schemaDocument ? path.basename(this._schemaDocument.fileName) : null,
            schema: this._schema,
            error: this._schemaError,
        });
    }

    _refreshSchemaIfChanged() {
        if (!this._schemaDocument || this._schemaDocument.isClosed) return;
        const { schema, error } = readSchema(this._schemaDocument);
        const fingerprint = this._fingerprint(schema, error);
        if (fingerprint === this._schemaFingerprint) return;
        this._schema = schema;
        this._schemaError = error;
        this._schemaFingerprint = fingerprint;
        this._postSchemaPayload();
    }

    _handleDocumentChange(document) {
        if (!sameDocument(document, this._schemaDocument)) return;
        if (this._schemaDebounce) clearTimeout(this._schemaDebounce);
        this._schemaDebounce = setTimeout(() => {
            this._schemaDebounce = null;
            this._refreshSchemaIfChanged();
        }, SCHEMA_DEBOUNCE_MS);
    }

    // ── Attachment / target ──────────────────────────────────────────────────

    _attach(sourceEditor, expressionResult) {
        if (!sourceEditor) return;
        this._sourceEditor = sourceEditor;
        this._expressionResult = expressionResult || null;

        const document = sourceEditor.document;
        if (!sameDocument(document, this._schemaDocument)) {
            this._schemaDocument = document;
            const { schema, error } = readSchema(document);
            this._schema = schema;
            this._schemaError = error;
            this._schemaFingerprint = this._fingerprint(schema, error);
        }
    }

    _activeFilePayload() {
        const editor = vscode.window.activeTextEditor;
        const document = editor ? editor.document : null;
        const isJrxml = isJrxmlDocument(document);
        return {
            fileName: isJrxml ? path.basename(document.fileName) : null,
            isJrxml,
            differs: isJrxml && !sameDocument(document, this._schemaDocument),
        };
    }

    _postActiveFile() {
        this._activeFile = this._activeFilePayload();
        this._post({ command: 'activeFile', ...this._activeFile });
    }

    _handleActiveEditorChange(editor) {
        if (!this._schemaDocument && editor && isJrxmlDocument(editor.document)) {
            this._schemaDocument = editor.document;
            this._postSchema();
            this._postNotice(
                'info',
                `Schema loaded from ${path.basename(editor.document.fileName)}. Place the cursor inside an expression tag, then use “Use active file” to apply.`
            );
        }
        this._postActiveFile();
    }

    _useActiveFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isJrxmlDocument(editor.document)) {
            this._postNotice('warn', 'The active editor is not a .jrxml file.');
            vscode.window.showWarningMessage('Open a .jrxml file to use it as the builder source.');
            return;
        }

        const target = findTargetAtEditor(editor);
        this._sourceEditor = editor;
        this._expressionResult = target;
        this._schemaDocument = editor.document;

        const { schema, error } = readSchema(editor.document);
        this._schema = schema;
        this._schemaError = error;
        this._schemaFingerprint = this._fingerprint(schema, error);

        this._postSchemaPayload();
        this._postTarget();
        this._postActiveFile();

        const fileName = path.basename(editor.document.fileName);
        if (target) {
            this._post({ command: 'loadExpression', text: target.expression, tagName: target.tagName });
            this._postNotice('info', `Attached to ${fileName} <${target.tagName}>.`);
        } else {
            this._postNotice('info', `Attached to ${fileName}. Place the cursor inside an expression tag to apply.`);
        }
    }

    _reload() {
        if (this._schemaDocument && this._schemaDocument.isClosed) {
            this._postNotice('warn', 'The attached report was closed. Open a .jrxml file and click “Use active file”.');
            return;
        }

        if (!this._schemaDocument) {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !isJrxmlDocument(editor.document)) {
                this._postNotice('warn', 'No .jrxml report is attached. Open one and click “Use active file”.');
                return;
            }
            this._schemaDocument = editor.document;
            this._postSchema();
            this._postActiveFile();
            this._postNotice('info', `Schema loaded from ${path.basename(editor.document.fileName)}.`);
            return;
        }

        this._postSchema();
        this._postNotice('info', `Schema reloaded from ${path.basename(this._schemaDocument.fileName)}.`);
    }

    // ── Messages from the webview ────────────────────────────────────────────

    async _handleMessage(message) {
        try {
            switch (message.command) {
                case 'applyExpression':
                    await this._apply(message.text);
                    break;

                case 'copyExpression':
                    await vscode.env.clipboard.writeText(String(message.text == null ? '' : message.text));
                    vscode.window.showInformationMessage('Expression copied to clipboard.');
                    break;

                case 'requestSchema':
                    this._reload();
                    break;

                case 'useActiveFile':
                    this._useActiveFile();
                    break;

                default:
                    break;
            }
        } catch (err) {
            const reason = err && err.message ? err.message : String(err);
            console.error('[JRXML If/Else Builder] Message error:', err);
            this._postNotice('error', reason);
        }
    }

    async _apply(text) {
        const applied = await applyExpressionToEditor(
            this._sourceEditor,
            this._expressionResult,
            String(text == null ? '' : text)
        );

        if (!applied.ok) {
            this._post({ command: 'applyResult', ok: false, message: applied.reason });
            if (applied.severity === 'warning') vscode.window.showWarningMessage(applied.reason);
            else vscode.window.showErrorMessage(applied.reason);
            return;
        }

        this._expressionResult = applied.expressionResult;
        this._postTarget();
        this._post({
            command: 'applyResult',
            ok: true,
            message: `Applied to <${this._expressionResult.tagName}>.`,
        });
        vscode.window.showInformationMessage(
            `Expression applied to <${this._expressionResult.tagName}>.`
        );
    }

    dispose() {
        if (this._schemaDebounce) {
            clearTimeout(this._schemaDebounce);
            this._schemaDebounce = null;
        }
        IfElsePanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables = [];
    }
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.openIfElseBuilder', () => {
            const editor = vscode.window.activeTextEditor;

            if (!editor || !isJrxmlDocument(editor.document)) {
                IfElsePanel.createOrShow(context.extensionUri, {});
                vscode.window.showInformationMessage(
                    'Open a .jrxml file to read its fields, parameters and variables. You can still build and copy an expression.'
                );
                return;
            }

            const target = findTargetAtEditor(editor);
            const selectionText = editor.document.getText(editor.selection).trim();
            const initialExpression = selectionText || (target ? target.expression : null);

            IfElsePanel.createOrShow(context.extensionUri, {
                sourceEditor: editor,
                expressionResult: target,
                initialExpression,
            });

            if (!target) {
                vscode.window.showInformationMessage(
                    'The builder is not attached to an expression tag. Place the cursor inside one and click “Use active file” to apply.'
                );
            }
        })
    );
}

module.exports = { register, IfElsePanel, findTargetAtEditor, readSchema };
