// includeChainView.js
// The "Include Chain (JRXML)" Explorer view: for the open report, the top-down
// chain of templates that include it, ending at the open file.
//
// The graph itself lives in the vscode-free includeGraph module; this file adds
// the workspace scan, caching, refresh triggers and the tree rendering.

const vscode = require('vscode');
const { buildIndex, buildTree } = require('./includeGraph');

const VIEW_ID     = 'jrxmlIncludeChain';
const GLOB        = '**/*.jrxml';
const EXCLUDE     = '**/{node_modules,out,target,bin,.git,.vscode-test}/**';
const DEBOUNCE_MS = 300;

/** uriString → { mtime, text }; lets a refresh skip unchanged files. */
const diskCache = new Map();

let cachedFiles = null; // [{ path, text, uri }] as read from disk
let cacheFresh  = false;

function isJrxml(document) {
    return !!document && document.fileName.endsWith('.jrxml');
}

function relativePath(uri) {
    return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

async function readText(uri) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
}

async function scanWorkspace() {
    const uris  = await vscode.workspace.findFiles(GLOB, EXCLUDE);
    const files = [];

    for (const uri of uris) {
        const key    = uri.toString();
        const cached = diskCache.get(key);

        let stat = null;
        try {
            stat = await vscode.workspace.fs.stat(uri);
        } catch {
            continue; // disappeared mid-scan
        }

        let text;
        if (cached && cached.mtime === stat.mtime) {
            text = cached.text;
        } else {
            try {
                text = await readText(uri);
            } catch {
                continue;
            }
            diskCache.set(key, { mtime: stat.mtime, text });
        }

        files.push({ path: relativePath(uri), text, uri });
    }

    return files;
}

/** Files from disk (cached) with open documents' current text overlaid. */
async function currentFiles() {
    if (!cacheFresh || !cachedFiles) {
        cachedFiles = await scanWorkspace();
        cacheFresh  = true;
    }

    const files  = cachedFiles.map(file => ({ ...file }));
    const byPath = new Map(files.map(file => [file.path, file]));

    for (const document of vscode.workspace.textDocuments) {
        if (!isJrxml(document)) continue;

        const path = relativePath(document.uri);
        const file = byPath.get(path);

        if (file) {
            file.text = document.getText(); // unsaved edits count
        } else {
            const added = { path, text: document.getText(), uri: document.uri };
            files.push(added);
            byPath.set(path, added);
        }
    }

    return files;
}

function invalidate() {
    cacheFresh = false;
}

async function treeFor(uri) {
    const files = await currentFiles();
    const index = buildIndex(files.map(({ path, text }) => ({ path, text })));
    return { tree: buildTree(index, relativePath(uri)), files };
}

/** The top-down include chain for `uri`. Exported for the integration tests. */
async function computeTree(uri) {
    const { tree } = await treeFor(uri);
    return tree;
}

// ── Tree rendering ────────────────────────────────────────────────────────────

function messageItem(message) {
    const item = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
    item.iconPath     = new vscode.ThemeIcon('info');
    item.contextValue = 'jrxmlIncludeMessage';
    return item;
}

function fileItem(node, uriByPath) {
    const item = new vscode.TreeItem(
        node.path,
        node.children.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None
    );
    item.tooltip      = node.path;
    item.iconPath     = new vscode.ThemeIcon(node.current ? 'target' : 'file-code');
    item.contextValue = node.current ? 'jrxmlIncludeCurrent' : 'jrxmlIncludeFile';
    if (node.current) item.description = '(current file)';

    const uri = uriByPath.get(node.path);
    if (uri) item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };

    item.childItems = node.children.map(child => fileItem(child, uriByPath));
    return item;
}

class IncludeChainProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
    }

    refresh() { this._onDidChangeTreeData.fire(); }

    dispose() { this._onDidChangeTreeData.dispose(); }

    getTreeItem(item) { return item; }

    async getChildren(element) {
        if (element) return element.childItems || [];
        return this._roots();
    }

    async _roots() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isJrxml(editor.document)) {
            return [messageItem('Open a .jrxml file to see where it is included.')];
        }

        const document = editor.document;
        const target   = relativePath(document.uri);

        let tree, files;
        try {
            ({ tree, files } = await treeFor(document.uri));
        } catch (err) {
            return [messageItem(`Include chain failed: ${err.message || err}`)];
        }

        const uriByPath = new Map(files.filter(file => file.uri).map(file => [file.path, file.uri]));
        uriByPath.set(target, document.uri);

        if (tree.length === 1 && tree[0].current && tree[0].children.length === 0) {
            // Nothing calls the open file: show it with the hook's placeholder.
            const item = fileItem(tree[0], uriByPath);
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            item.childItems = [messageItem('(not referenced)')];
            return [item];
        }

        if (tree.length === 0) {
            // Not part of the workspace index (unsaved or outside the folder).
            const item = new vscode.TreeItem(target, vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath     = new vscode.ThemeIcon('target');
            item.description  = '(current file)';
            item.contextValue = 'jrxmlIncludeCurrent';
            item.command      = { command: 'vscode.open', title: 'Open', arguments: [document.uri] };
            item.childItems   = [messageItem('(not referenced)')];
            return [item];
        }

        return tree.map(node => fileItem(node, uriByPath));
    }
}

function register(context) {
    const provider = new IncludeChainProvider();
    const view = vscode.window.createTreeView(VIEW_ID, {
        treeDataProvider: provider,
        showCollapseAll:  true,
    });

    let timer;
    const schedule     = () => { clearTimeout(timer); timer = setTimeout(() => provider.refresh(), DEBOUNCE_MS); };
    const hardRefresh  = () => { invalidate(); provider.refresh(); };

    context.subscriptions.push(
        view,
        provider,

        vscode.commands.registerCommand('jrxml.refreshIncludeChain', hardRefresh),

        vscode.window.onDidChangeActiveTextEditor(() => provider.refresh()),
        vscode.workspace.onDidChangeTextDocument(event => { if (isJrxml(event.document)) schedule(); }),
        vscode.workspace.onDidSaveTextDocument(document => { if (isJrxml(document)) hardRefresh(); }),
        vscode.workspace.onDidCreateFiles(() => hardRefresh()),
        vscode.workspace.onDidDeleteFiles(() => hardRefresh()),
        vscode.workspace.onDidRenameFiles(() => hardRefresh()),
        vscode.workspace.onDidChangeWorkspaceFolders(() => hardRefresh()),

        { dispose: () => clearTimeout(timer) }
    );
}

module.exports = { register, computeTree, VIEW_ID };
