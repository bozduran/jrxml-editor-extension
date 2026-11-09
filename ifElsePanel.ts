// ifElsePanel.ts
// Host side of the If / Else expression builder webview.
//
// The panel reads the attached .jrxml with the shared declaration parser so
// the webview never needs a file upload. The document itself is built by the
// vscode-free ifElsePanelHtml module.

import * as path from 'path';
import * as vscode from 'vscode';

import { parseDeclarations } from './jrxmlParser';
import { BUILTIN_VARIABLES, BUILTIN_PARAMETERS } from './jasperBuiltins';
import { makeSchema } from './ifElseBuilder';
import type { BuilderSchema, NormalizedOptions } from './ifElseBuilder';
import { buildIfElsePanelHtml, getNonce } from './ifElsePanelHtml';
import type { IfElseActiveFile } from './ifElsePanelHtml';
import { findExpressionAtCursor } from './expressionUtils';
import type { ExpressionAtCursor } from './expressionUtils';
import { applyExpressionToEditor } from './expressionApply';
import type { ExpressionTarget } from './expressionApply';

const VIEW_TYPE = 'jrxmlIfElseBuilder';
const PANEL_TITLE = 'If / Else Builder';
const SCHEMA_DEBOUNCE_MS = 300;

/** The source editor and expression a panel is attached to. */
export interface IfElsePanelOpenOptions {
    sourceEditor?: vscode.TextEditor | null;
    expressionResult?: ExpressionTarget | null;
    initialExpression?: string | null;
}

/** One message posted by the if / else webview. */
interface IfElseMessage {
    command?: string;
    text?: unknown;
}

function isJrxmlDocument(document: vscode.TextDocument | null | undefined): document is vscode.TextDocument {
    return !!document && document.fileName.endsWith('.jrxml');
}

function sameDocument(left: vscode.TextDocument | null | undefined, right: vscode.TextDocument | null | undefined): boolean {
    return !!left && !!right && left.uri.toString() === right.uri.toString();
}

/** The message a thrown value carries, or its string form. */
function errorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
        const message = (err as { message?: unknown }).message;
        if (message) return String(message);
    }
    return String(err);
}

/** Find the expression tag under the editor cursor or selection. */
function findTargetAtEditor(editor: vscode.TextEditor | null | undefined): ExpressionAtCursor | null {
    if (!editor || !isJrxmlDocument(editor.document)) return null;
    const document = editor.document;
    for (const position of [editor.selection.active, editor.selection.start, editor.selection.end]) {
        const found = findExpressionAtCursor(document, position);
        if (found) return found;
    }
    return null;
}

/** Read the builder defaults from the jrxml settings section. */
function readOptions(): NormalizedOptions {
    const config = vscode.workspace.getConfiguration('jrxml');
    return {
        nullSafe: config.get<boolean>('ifElse.nullSafe', true) !== false,
        multiline: config.get<boolean>('ifElse.multiline', true) !== false,
        style: config.get<string>('ifElse.style', 'ternary') === 'functions' ? 'functions' : 'ternary',
    };
}

/**
 * Parse the report's fields/parameters/variables and add the JasperReports
 * built-ins. Errors are returned, never thrown into the panel.
 */
function readSchema(document: vscode.TextDocument | null): { schema: BuilderSchema | null; error: string | null } {
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
        return { schema: null, error: errorMessage(err) };
    }
}

class IfElsePanel {
    static currentPanel: IfElsePanel | undefined = undefined;
    static viewType = VIEW_TYPE;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _sourceEditor: vscode.TextEditor | null;
    private _expressionResult: ExpressionTarget | null | undefined;
    private _schemaDocument: vscode.TextDocument | null;
    private _initialExpression: string | null;
    private readonly _options: NormalizedOptions;
    private _disposables: vscode.Disposable[];
    private _schemaDebounce: NodeJS.Timeout | null;
    private _schema: BuilderSchema | null;
    private _schemaError: string | null;
    private _schemaFingerprint: string;
    private _activeFile: IfElseActiveFile;

    constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, {
        sourceEditor = null,
        expressionResult = null,
        initialExpression = null,
    }: IfElsePanelOpenOptions = {}) {
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
            (message: IfElseMessage) => this._handleMessage(message),
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

    static createOrShow(extensionUri: vscode.Uri, {
        sourceEditor = null,
        expressionResult = null,
        initialExpression = null,
    }: IfElsePanelOpenOptions = {}): void {
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

    private _update(): void {
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

    private _post(message: unknown): Thenable<boolean> {
        return this._panel.webview.postMessage(message);
    }

    private _postNotice(level: string, message: string): Thenable<boolean> {
        return this._post({ command: 'notice', level, message });
    }

    private _postTarget(): void {
        this._post({
            command: 'target',
            canApply: !!this._expressionResult,
            tagName: this._expressionResult ? this._expressionResult.tagName : null,
        });
    }

    // ── Schema ───────────────────────────────────────────────────────────────

    private _fingerprint(schema: BuilderSchema | null, error: string | null): string {
        return JSON.stringify({ schema: schema || null, error: error || null });
    }

    private _postSchema(): void {
        if (this._schemaDocument && !this._schemaDocument.isClosed) {
            const { schema, error } = readSchema(this._schemaDocument);
            this._schema = schema;
            this._schemaError = error;
            this._schemaFingerprint = this._fingerprint(schema, error);
        }
        this._postSchemaPayload();
    }

    private _postSchemaPayload(): void {
        this._post({
            command: 'schema',
            fileName: this._schemaDocument ? path.basename(this._schemaDocument.fileName) : null,
            schema: this._schema,
            error: this._schemaError,
        });
    }

    private _refreshSchemaIfChanged(): void {
        if (!this._schemaDocument || this._schemaDocument.isClosed) return;
        const { schema, error } = readSchema(this._schemaDocument);
        const fingerprint = this._fingerprint(schema, error);
        if (fingerprint === this._schemaFingerprint) return;
        this._schema = schema;
        this._schemaError = error;
        this._schemaFingerprint = fingerprint;
        this._postSchemaPayload();
    }

    private _handleDocumentChange(document: vscode.TextDocument): void {
        if (!sameDocument(document, this._schemaDocument)) return;
        if (this._schemaDebounce) clearTimeout(this._schemaDebounce);
        this._schemaDebounce = setTimeout(() => {
            this._schemaDebounce = null;
            this._refreshSchemaIfChanged();
        }, SCHEMA_DEBOUNCE_MS);
    }

    // ── Attachment / target ──────────────────────────────────────────────────

    private _attach(sourceEditor: vscode.TextEditor | null, expressionResult?: ExpressionTarget | null): void {
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

    private _activeFilePayload(): IfElseActiveFile {
        const editor = vscode.window.activeTextEditor;
        const document = editor ? editor.document : null;
        const isJrxml = isJrxmlDocument(document);
        return {
            fileName: isJrxml ? path.basename(document.fileName) : null,
            isJrxml,
            differs: isJrxml && !sameDocument(document, this._schemaDocument),
        };
    }

    private _postActiveFile(): void {
        this._activeFile = this._activeFilePayload();
        this._post({ command: 'activeFile', ...this._activeFile });
    }

    private _handleActiveEditorChange(editor: vscode.TextEditor | undefined): void {
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

    private _useActiveFile(): void {
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

    private _reload(): void {
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

    private async _handleMessage(message: IfElseMessage): Promise<void> {
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
            const reason = errorMessage(err);
            console.error('[JRXML If/Else Builder] Message error:', err);
            this._postNotice('error', reason);
        }
    }

    private async _apply(text: unknown): Promise<void> {
        const applied = await applyExpressionToEditor(
            this._sourceEditor ?? undefined,
            this._expressionResult,
            String(text == null ? '' : text)
        );

        if (!applied.ok) {
            this._post({ command: 'applyResult', ok: false, message: applied.reason });
            if (applied.severity === 'warning') vscode.window.showWarningMessage(applied.reason ?? '');
            else vscode.window.showErrorMessage(applied.reason ?? '');
            return;
        }

        this._expressionResult = applied.expressionResult;
        // A successful apply always carries the refreshed target.
        const target = this._expressionResult as ExpressionTarget;
        this._postTarget();
        this._post({
            command: 'applyResult',
            ok: true,
            message: `Applied to <${target.tagName}>.`,
        });
        vscode.window.showInformationMessage(
            `Expression applied to <${target.tagName}>.`
        );
    }

    dispose(): void {
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

function register(context: vscode.ExtensionContext): void {
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

export { register, IfElsePanel, findTargetAtEditor, readSchema };
