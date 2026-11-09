// includeChainView.ts
// The "Include Chain (JRXML)" JRXML Activity Bar view: for the open report, the top-down
// chain of templates that include it, ending at the open file.
//
// The graph itself lives in the vscode-free includeGraph module; this file adds
// the workspace scan, caching, refresh triggers and the tree rendering.

import * as vscode from 'vscode';
import { buildIndex, buildTree } from './includeGraph';
import type { IncludeTreeNode } from './includeGraph';
import { EXCLUDE_GLOB as EXCLUDE } from './workspaceFiles';

export const VIEW_ID     = 'jrxmlIncludeChain';
const GLOB        = '**/*.jrxml';
const DEBOUNCE_MS = 300;

/** A report as read from disk, or from an open document. */
interface ReportTextFile {
    path: string;
    text: string;
    uri: vscode.Uri;
}

/** A tree item that carries its lazily attached children. */
interface IncludeTreeItem extends vscode.TreeItem {
    childItems?: IncludeTreeItem[];
}

/** uriString → { mtime, text }; lets a refresh skip unchanged files. */
const diskCache = new Map<string, { mtime: number; text: string }>();

let cachedFiles: ReportTextFile[] | null = null; // as read from disk
let cacheFresh  = false;

function isJrxml(document: vscode.TextDocument | null | undefined): boolean {
    return !!document && document.fileName.endsWith('.jrxml');
}

function relativePath(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

async function readText(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
}

async function scanWorkspace(): Promise<ReportTextFile[]> {
    const uris  = await vscode.workspace.findFiles(GLOB, EXCLUDE);
    const files: ReportTextFile[] = [];

    for (const uri of uris) {
        const key    = uri.toString();
        const cached = diskCache.get(key);

        let stat: vscode.FileStat | null = null;
        try {
            stat = await vscode.workspace.fs.stat(uri);
        } catch {
            continue; // disappeared mid-scan
        }

        let text: string;
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
async function currentFiles(): Promise<ReportTextFile[]> {
    if (!cacheFresh || !cachedFiles) {
        cachedFiles = await scanWorkspace();
        cacheFresh  = true;
    }

    const files  = cachedFiles.map(file => ({ ...file }));
    const byPath = new Map<string, ReportTextFile>(
        files.map((file): [string, ReportTextFile] => [file.path, file])
    );

    for (const document of vscode.workspace.textDocuments) {
        if (!isJrxml(document)) continue;

        const path = relativePath(document.uri);
        const file = byPath.get(path);

        if (file) {
            file.text = document.getText(); // unsaved edits count
        } else {
            const added: ReportTextFile = { path, text: document.getText(), uri: document.uri };
            files.push(added);
            byPath.set(path, added);
        }
    }

    return files;
}

function invalidate(): void {
    cacheFresh = false;
}

async function treeFor(uri: vscode.Uri): Promise<{ tree: IncludeTreeNode[]; files: ReportTextFile[] }> {
    const files = await currentFiles();
    const index = buildIndex(files.map(({ path, text }) => ({ path, text })));
    return { tree: buildTree(index, relativePath(uri)), files };
}

/** The top-down include chain for `uri`. Exported for the integration tests. */
export async function computeTree(uri: vscode.Uri): Promise<IncludeTreeNode[]> {
    const { tree } = await treeFor(uri);
    return tree;
}

// ── Tree rendering ────────────────────────────────────────────────────────────

function messageItem(message: string): IncludeTreeItem {
    const item = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
    item.iconPath     = new vscode.ThemeIcon('info');
    item.contextValue = 'jrxmlIncludeMessage';
    return item;
}

function fileItem(node: IncludeTreeNode, uriByPath: Map<string, vscode.Uri>): IncludeTreeItem {
    const item: IncludeTreeItem = new vscode.TreeItem(
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

class IncludeChainProvider implements vscode.TreeDataProvider<IncludeTreeItem> {
    _onDidChangeTreeData: vscode.EventEmitter<IncludeTreeItem | undefined | null | void>;
    onDidChangeTreeData: vscode.Event<IncludeTreeItem | undefined | null | void>;

    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
    }

    refresh(): void { this._onDidChangeTreeData.fire(); }

    dispose(): void { this._onDidChangeTreeData.dispose(); }

    getTreeItem(item: IncludeTreeItem): vscode.TreeItem { return item; }

    async getChildren(element?: IncludeTreeItem): Promise<IncludeTreeItem[]> {
        if (element) return element.childItems || [];
        return this._roots();
    }

    async _roots(): Promise<IncludeTreeItem[]> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isJrxml(editor.document)) {
            return [messageItem('Open a .jrxml file to see where it is included.')];
        }

        const document = editor.document;
        const target   = relativePath(document.uri);

        let tree: IncludeTreeNode[];
        let files: ReportTextFile[];
        try {
            ({ tree, files } = await treeFor(document.uri));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return [messageItem(`Include chain failed: ${message}`)];
        }

        const uriByPath = new Map<string, vscode.Uri>(
            files.filter(file => file.uri).map((file): [string, vscode.Uri] => [file.path, file.uri])
        );
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
            const item = new vscode.TreeItem(target, vscode.TreeItemCollapsibleState.Expanded) as IncludeTreeItem;
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

export function register(context: vscode.ExtensionContext): void {
    const provider = new IncludeChainProvider();
    const view = vscode.window.createTreeView(VIEW_ID, {
        treeDataProvider: provider,
        showCollapseAll:  true,
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule     = (): void => { clearTimeout(timer); timer = setTimeout(() => provider.refresh(), DEBOUNCE_MS); };
    const hardRefresh  = (): void => { invalidate(); provider.refresh(); };

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
