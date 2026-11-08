// resourceIndex.js
// Resolves a report document to its indexed resource bundle.
//
// Kept separate from resourceBundle.js so the pure index can be tested without
// VS Code; this module only supplies the workspace roots and the report path.

const vscode = require('vscode');
const { bundleAttribute, loadResourceBundle } = require('./resourceBundle');

/**
 * The bundle index for a report document, or null when it declares none or
 * none of its .properties files can be found.
 */
function resourcesForDocument(document, attr = null) {
    if (!document || typeof document.fileName !== 'string' || !document.fileName) return null;

    const bundle = attr || bundleAttribute(document.getText());
    if (!bundle) return null;

    const roots = ((vscode.workspace && vscode.workspace.workspaceFolders) || [])
        .map(folder => folder.uri && folder.uri.fsPath)
        .filter(Boolean);

    return loadResourceBundle(document.fileName, bundle.name, roots);
}

/** Flat entry list for the suggestion engine. */
function resourceEntriesForDocument(document, attr = null) {
    const index = resourcesForDocument(document, attr);
    return index ? [...index.entries.values()] : null;
}

module.exports = { resourcesForDocument, resourceEntriesForDocument };
