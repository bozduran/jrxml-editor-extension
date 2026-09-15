// preview.js
// Shared virtual-document provider for diff previews (sort, clear, …).
//
// The extension previews whole-file rewrites before applying them: a diff is
// opened between the real document and a read-only virtual document holding the
// proposed result.

const vscode = require('vscode');

const SCHEME = 'jrxml-preview';
const contents = new Map();

const provider = vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
    provideTextDocumentContent(uri) {
        return contents.get(uri.toString()) || '';
    },
});

/** Register `content` and return a URI that renders it in a diff. */
function put(name, content) {
    const uri = vscode.Uri.from({
        scheme: SCHEME,
        path:   '/' + name,
        query:  String(Date.now()) + '-' + Math.random().toString(36).slice(2),
    });
    contents.set(uri.toString(), content);
    return uri;
}

/** Release a preview URI created by `put`. */
function drop(uri) {
    contents.delete(uri.toString());
}

module.exports = { provider, put, drop, SCHEME };
