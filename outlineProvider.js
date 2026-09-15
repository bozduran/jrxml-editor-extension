// outlineProvider.js
// Provides the report structure tree in VS Code's Outline panel (and breadcrumbs).
// Shows: Report → Declarations (fields/params/vars) → Bands → Groups

const vscode = require('vscode');
const { parseDeclarations } = require('./jrxmlParser');

// Map our kind strings to VS Code SymbolKind icons
const KIND_MAP = {
    report:     vscode.SymbolKind.File,
    group:      vscode.SymbolKind.Module,
    band:       vscode.SymbolKind.Namespace,
    field:      vscode.SymbolKind.Field,
    parameter:  vscode.SymbolKind.TypeParameter,
    variable:   vscode.SymbolKind.Variable,
    textField:  vscode.SymbolKind.String,
};

/**
 * Convert our internal OutlineNode tree into VS Code DocumentSymbol tree.
 *
 * Every node carries an explicit `[offset, end]` span so that a parent's range
 * contains its children's ranges — VS Code rejects symbol trees that violate
 * this, and selection/breadcrumb navigation depends on it.
 *
 * @param {import('./jrxmlParser').OutlineNode[]} nodes
 * @param {vscode.TextDocument} document
 * @returns {vscode.DocumentSymbol[]}
 */
function nodesToSymbols(nodes, document) {
    return nodes.map(node => {
        const start = document.positionAt(node.offset);
        const end   = document.positionAt(Math.max(node.offset, node.end ?? node.offset));
        const range = new vscode.Range(start, end);
        const kind  = KIND_MAP[node.kind] ?? vscode.SymbolKind.Object;

        const symbol = new vscode.DocumentSymbol(
            node.name,
            node.kind,
            kind,
            range,
            range
        );

        if (node.children && node.children.length > 0) {
            symbol.children = nodesToSymbols(node.children, document);
        }

        return symbol;
    });
}

const provider = vscode.languages.registerDocumentSymbolProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideDocumentSymbols(document) {
            try {
                const parsed = parseDeclarations(document);
                return nodesToSymbols(parsed.outline, document);
            } catch (err) {
                console.error('[JRXML] Outline error:', err);
                return [];
            }
        }
    }
);

module.exports = { provider, nodesToSymbols };
