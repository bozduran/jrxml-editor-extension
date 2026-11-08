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
function resourcesForDocument(document) {
    if (!document || typeof document.fileName !== 'string' || !document.fileName) return null;

    const attr = bundleAttribute(document.getText());
    if (!attr) return null;

    const roots = (vscode.workspace.workspaceFolders || [])
        .map(folder => folder.uri && folder.uri.fsPath)
        .filter(Boolean);

    return loadResourceBundle(document.fileName, attr.name, roots);
}

/** Flat entry list for the suggestion engine. */
function resourceEntriesForDocument(document) {
    const index = resourcesForDocument(document);
    return index ? [...index.entries.values()] : null;
}

module.exports = { resourcesForDocument, resourceEntriesForDocument };
