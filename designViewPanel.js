// designViewPanel.js
// Host side of the JRXML design view (view and edit).
//
// The panel follows the last shown .jrxml document: it rebuilds the model after
// a short debounce on edits, switches when another .jrxml becomes active, and
// reveals an element/band in the source when the webview asks for it. The
// document itself is rendered by the vscode-free designViewHtml module.

const vscode = require('vscode');
const path   = require('path');

const { buildDesignModel, findSelectionTarget } = require('./designModel');
const { buildElementPatch } = require('./designEdit');
const { buildDesignViewHtml } = require('./designViewHtml');
const { getNonce } = require('./expressionPanelHtml');
const { isStale, STALE_MESSAGE } = require('./staleGuard');
const { parseDeclarations, resolveDeclarationScope } = require('./jrxmlParser');
const { reportLanguage } = require('./reportLanguage');
const { resourceEntriesForDocument } = require('./resourceIndex');
const { buildExpressionSuggestions, suggestionOptions } = require('./expressionSuggestions');
const { getCustomJavaMethods } = require('./completionProvider');

const VIEW_TYPE    = 'jrxmlDesignView';
const TITLE_PREFIX = 'JRXML Design: ';
const DEBOUNCE_MS  = 200;
const SELECTION_DEBOUNCE_MS = 60;
const MAX_COMPLETIONS = 300;

const EMPTY_COMPLETIONS = {
    mode:    'general',
    prefix:  '',
    replace: { start: 0, end: 0 },
    items:   [],
};

function isJrxmlDocument(document) {
    return !!document
        && typeof document.fileName === 'string'
        && document.fileName.endsWith('.jrxml');
}

function baseName(fileName) {
    return path.basename(String(fileName || ''));
}

function errorModel(message) {
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

function safeModel(text) {
    try {
        return buildDesignModel(text);
    } catch (err) {
        return errorModel(`Design view error: ${err && err.message ? err.message : String(err)}`);
    }
}

/**
 * Suggestions for an expression typed in the design inspector. Uses the same
 * engine as the .jrxml editor, with declarations read from the open document.
 * Exported for the Extension Host suite.
 */
function buildCompletionsForDocument(document, expression, offset) {
    let decls;
    try {
        decls = parseDeclarations(document);
    } catch (_) {
        decls = {
            allFields: [], allParameters: [], allVariables: [],
            fields: [], parameters: [], variables: [],
        };
    }

    const config = vscode.workspace.getConfiguration('jrxml');
    const options = suggestionOptions(config);
    if ((decls.language || reportLanguage(document.getText())).language !== 'java') options.typedCompletion = false;
    const result = buildExpressionSuggestions({
        text: expression,
        offset,
        // The inspector edits report-band elements, so only report-scope
        // declarations apply; dataset members need their own dataset run.
        declarations: resolveDeclarationScope(decls, -1),
        options,
        customMethods: getCustomJavaMethods(),
        resources: resourceEntriesForDocument(document, decls.resourceBundle),
    });

    result.items = result.items.slice(0, MAX_COMPLETIONS);
    return result;
}

/**
 * Validate and apply one webview edit request to `document`.
 * Exported so the Extension Host suite can exercise the real WorkspaceEdit path.
 *
 * @returns {Promise<{ok:boolean, reason?:string, stale?:boolean, edits?:number}>}
 */
async function applyDesignPatch(document, message) {
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
    static currentPanel = undefined;
    static viewType     = VIEW_TYPE;

    constructor(panel, extensionUri, editor) {
        this._panel        = panel;
        this._extensionUri = extensionUri;
        this._disposables  = [];
        this._uri          = null;
        this._sourceColumn = vscode.ViewColumn.Beside;
        this._cache        = { uri: '', version: -1, model: null };
        this._timer        = null;
        this._selectionTimer = null;
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
            message => this._handleMessage(message),
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

    static createOrShow(extensionUri, editor) {
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

    _trackEditor(editor, force) {
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
    _document() {
        if (this._uri) {
            const tracked = vscode.workspace.textDocuments.find(
                document => document.uri.toString() === this._uri.toString()
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

    _renderInitial() {
        const document = this._document();
        let model    = null;
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

    _refresh(force = false) {
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

    _sendUpdate(model, document) {
        const fileName = document ? baseName(document.fileName) : '';
        const version  = document ? document.version : null;
        this._panel.title = document ? TITLE_PREFIX + fileName : 'JRXML Design';

        const message = { command: 'update', model, fileName, version };
        this._lastUpdate = message;

        if (this._webviewReady) {
            this._panel.webview.postMessage(message);
            this._pending = null;
            this._sendCurrentSelection();
        } else {
            this._pending = message;
        }
    }

    _postError(err) {
        const message = err && err.message ? err.message : String(err);
        console.error('[JRXML Design View]', err);
        if (this._webviewReady) {
            this._panel.webview.postMessage({ command: 'error', message });
        }
    }

    _scheduleRefresh() {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._refresh(false), DEBOUNCE_MS);
    }

    // ── Source selection sync ───────────────────────────────────────────────

    _onSelectionChanged(event) {
        if (!this._panel.visible) return;
        if (!this._uri) return;
        if (event.textEditor.document.uri.toString() !== this._uri.toString()) return;

        clearTimeout(this._selectionTimer);
        this._selectionTimer = setTimeout(
            () => this._syncSelection(event.textEditor),
            SELECTION_DEBOUNCE_MS
        );
    }

    _syncSelection(editor) {
        if (!editor || !isJrxmlDocument(editor.document)) return;

        const offset = editor.document.offsetAt(editor.selection.active);
        const target = findSelectionTarget(this._cache.model, offset);
        this._selectionTarget = target;

        if (this._webviewReady) {
            this._panel.webview.postMessage({ command: 'select', target });
        }
    }

    _sendCurrentSelection() {
        if (!this._webviewReady) return;

        const editor = vscode.window.activeTextEditor;
        if (editor && this._uri && editor.document.uri.toString() === this._uri.toString()) {
            this._syncSelection(editor);
            return;
        }

        this._panel.webview.postMessage({ command: 'select', target: this._selectionTarget || null });
    }

    // ── Edit application ────────────────────────────────────────────────────

    async _applyEdit(message) {
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

    _rejectEdit(reason) {
        if (!this._webviewReady) return;
        this._panel.webview.postMessage({ command: 'editRejected', reason });
    }

    _sendCompletions(message) {
        if (!this._webviewReady) return;

        const requestId = message && message.requestId;
        let result = EMPTY_COMPLETIONS;

        try {
            const document = this._document();
            if (document && typeof message.expression === 'string') {
                result = buildCompletionsForDocument(document, message.expression, message.offset);
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

    _onActiveEditor(editor) {
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

    _onDocumentChanged(event) {
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

    _onDocumentClosed(document) {
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

    _handleMessage(message) {
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
                    this._applyEdit(message).catch(err => this._rejectEdit(
                        err && err.message ? err.message : String(err)
                    ));
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

    async _reveal(message) {
        const document = this._document();
        if (!document) return;

        const textLength = document.getText().length;
        const offset = Number.isInteger(message.offset) ? message.offset : 0;
        const end    = Number.isInteger(message.end) ? message.end : offset;

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

    dispose() {
        DesignViewPanel.currentPanel = undefined;
        clearTimeout(this._timer);
        clearTimeout(this._selectionTimer);
        this._panel.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables = [];
    }
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.openDesignView', async (resource) => {
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
                        `Could not open the report: ${err && err.message ? err.message : String(err)}`
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

module.exports = {
    register,
    DesignViewPanel,
    applyDesignPatch,
    buildCompletionsForDocument,
    TITLE_PREFIX,
    isJrxmlDocument,
};
