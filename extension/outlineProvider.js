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
    staticText: vscode.SymbolKind.Constant,
    image:      vscode.SymbolKind.File,
};

/**
 * Convert our internal OutlineNode tree into VS Code DocumentSymbol tree.
 * @param {import('./jrxmlParser').OutlineNode[]} nodes
 * @param {vscode.TextDocument} document
 * @returns {vscode.DocumentSymbol[]}
 */
function nodesToSymbols(nodes, document) {
    return nodes.map(node => {
        const pos    = document.positionAt(node.offset);
        const range  = new vscode.Range(pos, pos);
        const kind   = KIND_MAP[node.kind] ?? vscode.SymbolKind.Object;

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

module.exports = { provider };
