// designViewPanel.ts
// Host side of the JRXML design view (view and edit).
//
// The panel follows the last shown .jrxml document: it rebuilds the model after
// a short debounce on edits, switches when another .jrxml becomes active, and
// reveals an element/band in the source when the webview asks for it. The
// document itself is rendered by the vscode-free designViewHtml module.

import * as vscode from 'vscode';
import * as path from 'path';

import { buildDesignModel, findSelectionTarget } from './designModel';
import type { DesignModel, SelectionTarget } from './designModel';
import { buildElementPatch } from './designEdit';
import { buildDesignViewHtml } from './designViewHtml';
import { getNonce } from './expressionPanelHtml';
import { isStale, STALE_MESSAGE } from './staleGuard';
import { parseDeclarations } from './jrxmlParser';
import type { ParseResult } from './jrxmlParser';
import { reportLanguage } from './reportLanguage';
import { resourceEntriesForDocument } from './resourceIndex';
import { visibleDeclarations } from './reportSymbols';
import { buildExpressionSuggestions, suggestionOptions } from './expressionSuggestions';
import type { ExpressionSuggestionResult } from './expressionSuggestions';
import { getCustomJavaMethods } from './completionProvider';

const VIEW_TYPE    = 'jrxmlDesignView';
const TITLE_PREFIX = 'JRXML Design: ';
const DEBOUNCE_MS  = 200;
const SELECTION_DEBOUNCE_MS = 60;
const MAX_COMPLETIONS = 300;

const EMPTY_COMPLETIONS: ExpressionSuggestionResult = {
    mode:    'general',
    prefix:  '',
    replace: { start: 0, end: 0 },
    items:   [],
};

/** The error model the webview renders when the report cannot be read. */
interface ErrorDesignModel {
    format: 'unknown';
    error: string;
    unsupported: null;
    report: null;
    bands: never[];
    warnings: never[];
    truncated: false;
    counts: { bands: number; elements: number };
}

/** One webview request; the protocol fields each command reads. */
interface DesignMessage {
    command?: string;
    elementOffset: number;
    baseVersion: number;
    patch?: unknown;
    offset?: unknown;
    end?: unknown;
    expression?: unknown;
    requestId?: unknown;
}

/** The update payload posted to the webview. */
interface UpdateMessage {
    command: 'update';
    model: DesignModel | null;
    fileName: string;
    version: number | null;
}

/** One design-view edit request, as the webview sends it. */
export interface DesignPatchMessage {
    elementOffset: number;
    baseVersion: number;
    patch?: unknown;
}

/** The result of validating and applying one design-view patch. */
export interface DesignPatchResult {
    ok: boolean;
    reason?: string;
    stale?: boolean;
    edits?: number;
}

function isJrxmlDocument(document: vscode.TextDocument | null | undefined): document is vscode.TextDocument {
    return !!document
        && typeof document.fileName === 'string'
        && document.fileName.endsWith('.jrxml');
}

function baseName(fileName: string): string {
    return path.basename(String(fileName || ''));
}

/** The message a thrown value carries, or its string form. */
function errorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
        const message = (err as { message?: unknown }).message;
        if (message) return String(message);
    }
    return String(err);
}

function errorModel(message: string): ErrorDesignModel {
    return {
        format:      'unknown',
        error:       message,
        unsupported: null,
        report:      null,
        bands:       [],
        warnings:    [],
        truncated:   false,
        counts:      { bands: 0, elements: 0 },
    };
}

function safeModel(text: string): DesignModel {
    try {
        return buildDesignModel(text);
    } catch (err) {
        // The webview contract renders an error model with report=null;
        // DesignModel describes the success shape the panel itself reads.
        return errorModel(`Design view error: ${errorMessage(err)}`) as unknown as DesignModel;
    }
}

/**
 * Suggestions for an expression typed in the design inspector. Uses the same
 * engine as the .jrxml editor, with declarations read from the open document.
 * Exported for the Extension Host suite.
 */
function buildCompletionsForDocument(
    document: vscode.TextDocument,
    expression: string,
    offset: number
): ExpressionSuggestionResult {
    let decls: ParseResult | null = null;
    try {
        decls = parseDeclarations(document);
    } catch {
        decls = null;
    }

    const EMPTY_PARSE: ParseResult = {
        fields: [], parameters: [], variables: [],
        dataset: { fields: [], parameters: [], variables: [] },
        language: { language: 'java', declared: false, offset: -1, length: 0 },
        allFields: [], allParameters: [], allVariables: [],
        groups: [], styles: [], references: [], resourceReferences: [],
        resourceBundle: null, datasets: [], scopeRanges: [], outline: [],
    };

    const config = vscode.workspace.getConfiguration('jrxml');
    const options = suggestionOptions(config);
    if (((decls && decls.language) || reportLanguage(document.getText())).language !== 'java') options.typedCompletion = false;
    const result = buildExpressionSuggestions({
        text: expression,
        offset,
        // The inspector edits report-band elements, so only report-scope
        // declarations apply; dataset members need their own dataset run.
        declarations: visibleDeclarations(decls ?? EMPTY_PARSE),
        options,
        customMethods: getCustomJavaMethods(),
        resources: resourceEntriesForDocument(document, decls ? decls.resourceBundle : null),
    });

    result.items = result.items.slice(0, MAX_COMPLETIONS);
    return result;
}

/**
 * Validate and apply one webview edit request to `document`.
 * Exported so the Extension Host suite can exercise the real WorkspaceEdit path.
 */
async function applyDesignPatch(
    document: vscode.TextDocument | null,
    message: DesignPatchMessage
): Promise<DesignPatchResult> {
    if (!document) {
        return { ok: false, reason: 'No report is open.' };
    }
    if (!message || !Number.isInteger(message.elementOffset)) {
        return { ok: false, reason: 'The edit request is invalid.' };
    }
    if (isStale(message.baseVersion, document.version)) {
        return { ok: false, stale: true, reason: STALE_MESSAGE };
    }

    const result = buildElementPatch(document.getText(), message.elementOffset, message.patch);
    if (result.error) {
        return { ok: false, reason: result.error };
    }
    if (result.edits.length === 0) {
        return { ok: true, edits: 0 };
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of result.edits) {
        workspaceEdit.replace(
            document.uri,
            new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
            edit.replacement
        );
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (!applied) {
        return { ok: false, reason: 'The edit could not be applied.' };
    }
    return { ok: true, edits: result.edits.length };
}

class DesignViewPanel {
    static currentPanel: DesignViewPanel | undefined = undefined;
    static viewType     = VIEW_TYPE;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[];
    private _uri: vscode.Uri | null;
    private _sourceColumn: vscode.ViewColumn;
    private _cache: { uri: string; version: number; model: DesignModel | null };
    private _timer: NodeJS.Timeout | undefined;
    private _selectionTimer: NodeJS.Timeout | undefined;
    private _selectionTarget: SelectionTarget | null;
    private _webviewReady: boolean;
    private _pending: UpdateMessage | null;
    private _lastUpdate: UpdateMessage | null;

    constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, editor: vscode.TextEditor | null | undefined) {
        this._panel        = panel;
        this._extensionUri = extensionUri;
        this._disposables  = [];
        this._uri          = null;
        this._sourceColumn = vscode.ViewColumn.Beside;
        this._cache        = { uri: '', version: -1, model: null };
        this._timer        = undefined;
        this._selectionTimer = undefined;
        this._selectionTarget = null;
        this._webviewReady = false;
        this._pending      = null;
        this._lastUpdate   = null;

        if (editor && isJrxmlDocument(editor.document)) {
            this._uri = editor.document.uri;
            if (editor.viewColumn) this._sourceColumn = editor.viewColumn;
        }

        this._renderInitial();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message: DesignMessage) => this._handleMessage(message),
            null,
            this._disposables
        );
        this._panel.onDidChangeViewState(
            () => {
                if (!this._panel.visible) return;
                this._refresh(false);
                this._sendCurrentSelection();
            },
            null,
            this._disposables
        );

        vscode.window.onDidChangeActiveTextEditor(
            active => this._onActiveEditor(active),
            null,
            this._disposables
        );
        vscode.window.onDidChangeTextEditorSelection(
            event => this._onSelectionChanged(event),
            null,
            this._disposables
        );
        vscode.workspace.onDidChangeTextDocument(
            event => this._onDocumentChanged(event),
            null,
            this._disposables
        );
        vscode.workspace.onDidCloseTextDocument(
            document => this._onDocumentClosed(document),
            null,
            this._disposables
        );
    }

    static createOrShow(extensionUri: vscode.Uri, editor: vscode.TextEditor | null | undefined): DesignViewPanel {
        const column = vscode.ViewColumn.Beside;

        if (DesignViewPanel.currentPanel) {
            DesignViewPanel.currentPanel._panel.reveal(column);
            DesignViewPanel.currentPanel._trackEditor(editor, true);
            return DesignViewPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            DesignViewPanel.viewType,
            'JRXML Design',
            column,
            {
                enableScripts:             true,
                retainContextWhenHidden:   true,
                localResourceRoots:        [],
            }
        );

        DesignViewPanel.currentPanel = new DesignViewPanel(panel, extensionUri, editor);
        return DesignViewPanel.currentPanel;
    }

    // ── Document tracking ───────────────────────────────────────────────────

    private _trackEditor(editor: vscode.TextEditor | null | undefined, force: boolean): void {
        if (!editor || !isJrxmlDocument(editor.document)) {
            this._refresh(force);
            return;
        }

        const nextUri = editor.document.uri.toString();
        const changed = !this._uri || this._uri.toString() !== nextUri;

        this._uri = editor.document.uri;
        if (editor.viewColumn) this._sourceColumn = editor.viewColumn;

        if (changed) this._selectionTarget = null;
        if (changed || force) this._refresh(force);
    }

    /** The tracked document, falling back to the active .jrxml editor. */
    private _document(): vscode.TextDocument | null {
        if (this._uri) {
            const tracked = vscode.workspace.textDocuments.find(
                document => document.uri.toString() === this._uri!.toString()
            );
            if (tracked) return tracked;
        }

        const editor = vscode.window.activeTextEditor;
        if (editor && isJrxmlDocument(editor.document)) {
            this._uri = editor.document.uri;
            if (editor.viewColumn) this._sourceColumn = editor.viewColumn;
            return editor.document;
        }
        return null;
    }

    // ── Rendering / updates ─────────────────────────────────────────────────

    private _renderInitial(): void {
        const document = this._document();
        let model: DesignModel | null = null;
        let fileName = '';

        const version = document ? document.version : null;

        if (document) {
            model    = safeModel(document.getText());
            fileName = baseName(document.fileName);
            this._cache = {
                uri:     document.uri.toString(),
                version: document.version,
                model,
            };
            this._panel.title = TITLE_PREFIX + fileName;

            const active = vscode.window.activeTextEditor;
            if (active && active.document.uri.toString() === document.uri.toString()) {
                this._selectionTarget = findSelectionTarget(
                    model,
                    document.offsetAt(active.selection.active)
                );
            }
        } else {
            this._panel.title = 'JRXML Design';
        }

        this._panel.webview.html = buildDesignViewHtml({
            model,
            fileName,
            version,
            nonce:     getNonce(),
            cspSource: this._panel.webview.cspSource,
        });

        this._lastUpdate = { command: 'update', model, fileName, version };
    }

    private _refresh(force = false): void {
        if (!this._panel) return;

        const document = this._document();
        if (!document) {
            this._cache = { uri: '', version: -1, model: null };
            this._selectionTarget = null;
            this._sendUpdate(null, null);
            return;
        }

        const uri      = document.uri.toString();
        const upToDate = this._cache.uri === uri && this._cache.version === document.version;
        if (!force && upToDate) return;

        const model = safeModel(document.getText());
        this._cache = { uri, version: document.version, model };
        this._sendUpdate(model, document);
    }

    private _sendUpdate(model: DesignModel | null, document: vscode.TextDocument | null): void {
        const fileName = document ? baseName(document.fileName) : '';
        const version  = document ? document.version : null;
        this._panel.title = document ? TITLE_PREFIX + fileName : 'JRXML Design';

        const message: UpdateMessage = { command: 'update', model, fileName, version };
        this._lastUpdate = message;

        if (this._webviewReady) {
            this._panel.webview.postMessage(message);
            this._pending = null;
            this._sendCurrentSelection();
        } else {
            this._pending = message;
        }
    }

    private _postError(err: unknown): void {
        const message = errorMessage(err);
        console.error('[JRXML Design View]', err);
        if (this._webviewReady) {
            this._panel.webview.postMessage({ command: 'error', message });
        }
    }

    private _scheduleRefresh(): void {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._refresh(false), DEBOUNCE_MS);
    }

    // ── Source selection sync ───────────────────────────────────────────────

    private _onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
        if (!this._panel.visible) return;
        if (!this._uri) return;
        if (event.textEditor.document.uri.toString() !== this._uri.toString()) return;

        clearTimeout(this._selectionTimer);
        this._selectionTimer = setTimeout(
            () => this._syncSelection(event.textEditor),
            SELECTION_DEBOUNCE_MS
        );
    }

    private _syncSelection(editor: vscode.TextEditor | null | undefined): void {
        if (!editor || !isJrxmlDocument(editor.document)) return;

        const offset = editor.document.offsetAt(editor.selection.active);
        const target = findSelectionTarget(this._cache.model, offset);
        this._selectionTarget = target;

        if (this._webviewReady) {
            this._panel.webview.postMessage({ command: 'select', target });
        }
    }

    private _sendCurrentSelection(): void {
        if (!this._webviewReady) return;

        const editor = vscode.window.activeTextEditor;
        if (editor && this._uri && editor.document.uri.toString() === this._uri.toString()) {
            this._syncSelection(editor);
            return;
        }

        this._panel.webview.postMessage({ command: 'select', target: this._selectionTarget || null });
    }

    // ── Edit application ────────────────────────────────────────────────────

    private async _applyEdit(message: DesignMessage): Promise<void> {
        const document = this._document();
        const model = this._cache.model;
        if (!model || model.error || model.unsupported) {
            this._rejectEdit('This report cannot be edited.');
            return;
        }

        const result = await applyDesignPatch(document, message);
        if (!result.ok) {
            if (result.stale) {
                vscode.window.showWarningMessage(STALE_MESSAGE);
                this._refresh(true);
            }
            this._rejectEdit(result.reason);
            return;
        }

        this._refresh(true);
    }

    private _rejectEdit(reason: string | undefined): void {
        if (!this._webviewReady) return;
        this._panel.webview.postMessage({ command: 'editRejected', reason });
    }

    private _sendCompletions(message: DesignMessage): void {
        if (!this._webviewReady) return;

        const requestId = message && message.requestId;
        let result = EMPTY_COMPLETIONS;

        try {
            const document = this._document();
            if (document && typeof message.expression === 'string') {
                result = buildCompletionsForDocument(document, message.expression, message.offset as number);
            }
        } catch (err) {
            console.error('[JRXML Design View] Completion failed:', err);
        }

        this._panel.webview.postMessage({
            command: 'completions',
            requestId,
            result,
        });
    }

    // ── Event handlers ──────────────────────────────────────────────────────

    private _onActiveEditor(editor: vscode.TextEditor | undefined): void {
        if (!editor || !isJrxmlDocument(editor.document)) return;

        const nextUri = editor.document.uri.toString();
        const changed = !this._uri || this._uri.toString() !== nextUri;

        this._uri = editor.document.uri;
        if (editor.viewColumn) this._sourceColumn = editor.viewColumn;

        if (changed) {
            this._selectionTarget = null;
            this._refresh(true);
        }
    }

    private _onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
        if (!isJrxmlDocument(event.document)) return;

        const uri    = event.document.uri.toString();
        const active = vscode.window.activeTextEditor;

        const isTracked = !!this._uri && this._uri.toString() === uri;
        const isActive  = !!active
            && active.document.uri.toString() === uri;

        if (!isTracked && !isActive) return;

        // Editing another .jrxml in the source editor makes it the report shown.
        if (isActive && !isTracked) {
            this._uri = event.document.uri;
            if (active.viewColumn) this._sourceColumn = active.viewColumn;
            this._selectionTarget = null;
        }

        this._scheduleRefresh();
    }

    private _onDocumentClosed(document: vscode.TextDocument): void {
        if (!this._uri || this._uri.toString() !== document.uri.toString()) return;

        this._uri   = null;
        this._cache = { uri: '', version: -1, model: null };
        this._selectionTarget = null;

        const active = vscode.window.activeTextEditor;
        if (active && isJrxmlDocument(active.document)) {
            this._uri = active.document.uri;
            if (active.viewColumn) this._sourceColumn = active.viewColumn;
            this._refresh(true);
            return;
        }

        this._sendUpdate(null, null);
    }

    // ── Webview messages ────────────────────────────────────────────────────

    private _handleMessage(message: DesignMessage): void {
        try {
            switch (message && message.command) {
                case 'ready':
                    this._webviewReady = true;
                    // The initial HTML already carries this model; resending it
                    // also covers a webview reload (moved to another group …).
                    if (this._pending || this._lastUpdate) {
                        this._panel.webview.postMessage(this._pending || this._lastUpdate);
                        this._pending = null;
                    }
                    this._sendCurrentSelection();
                    break;

                case 'refresh':
                    this._refresh(true);
                    break;

                case 'reveal':
                    this._reveal(message).catch(err => this._postError(err));
                    break;

                case 'applyEdit':
                    this._applyEdit(message).catch(err => this._rejectEdit(errorMessage(err)));
                    break;

                case 'complete':
                    this._sendCompletions(message);
                    break;

                default:
                    break;
            }
        } catch (err) {
            this._postError(err);
        }
    }

    private async _reveal(message: DesignMessage): Promise<void> {
        const document = this._document();
        if (!document) return;

        const textLength = document.getText().length;
        const offset = typeof message.offset === 'number' && Number.isInteger(message.offset) ? message.offset : 0;
        const end    = typeof message.end === 'number' && Number.isInteger(message.end) ? message.end : offset;

        const start = Math.max(0, Math.min(offset, textLength));
        const stop  = Math.max(start, Math.min(end, textLength));

        await vscode.window.showTextDocument(document, {
            viewColumn: this._sourceColumn || vscode.ViewColumn.Beside,
            preserveFocus: false,
            preview: false,
        });

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== document.uri.toString()) return;

        const range = new vscode.Range(document.positionAt(start), document.positionAt(stop));
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }

    dispose(): void {
        DesignViewPanel.currentPanel = undefined;
        clearTimeout(this._timer);
        clearTimeout(this._selectionTimer);
        this._panel.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables = [];
    }
}

function register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.openDesignView', async (resource?: unknown): Promise<void> => {
            let editor = vscode.window.activeTextEditor;

            if (resource instanceof vscode.Uri) {
                try {
                    const document = await vscode.workspace.openTextDocument(resource);
                    if (!isJrxmlDocument(document)) {
                        vscode.window.showWarningMessage('The design view works on .jrxml files only.');
                        return;
                    }
                    editor = await vscode.window.showTextDocument(document, { preview: false });
                } catch (err) {
                    vscode.window.showErrorMessage(
                        `Could not open the report: ${errorMessage(err)}`
                    );
                    return;
                }
            }

            if (!editor || !isJrxmlDocument(editor.document)) {
                vscode.window.showWarningMessage(
                    'Open a .jrxml file to see its design view.'
                );
                return;
            }

            DesignViewPanel.createOrShow(context.extensionUri, editor);
        })
    );
}

export {
    register,
    DesignViewPanel,
    applyDesignPatch,
    buildCompletionsForDocument,
    TITLE_PREFIX,
    isJrxmlDocument,
};
