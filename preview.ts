// preview.ts
// Shared virtual-document provider for diff previews (sort, clear, …).
//
// The extension previews whole-file rewrites before applying them: a diff is
// opened between the real document and a read-only virtual document holding the
// proposed result.

import * as vscode from 'vscode';
import { isStale, STALE_MESSAGE } from './staleGuard';

export const SCHEME = 'jrxml-preview';
const contents = new Map<string, string>();

export const provider = vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
    provideTextDocumentContent(uri: vscode.Uri): string {
        return contents.get(uri.toString()) || '';
    },
});

/** Register `content` and return a URI that renders it in a diff. */
export function put(name: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({
        scheme: SCHEME,
        path:   '/' + name,
        query:  String(Date.now()) + '-' + Math.random().toString(36).slice(2),
    });
    contents.set(uri.toString(), content);
    return uri;
}

/** Release a preview URI created by `put`. */
export function drop(uri: vscode.Uri): void {
    contents.delete(uri.toString());
}

/**
 * Guard for destructive applies: returns false (and warns) when the document
 * changed since `discoveredVersion` was captured.
 */
export function ensureUnchanged(document: vscode.TextDocument, discoveredVersion: number): boolean {
    if (!isStale(discoveredVersion, document.version)) return true;
    vscode.window.showWarningMessage(STALE_MESSAGE);
    return false;
}
