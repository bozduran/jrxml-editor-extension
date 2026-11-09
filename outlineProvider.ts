// outlineProvider.ts
// Provides the report structure tree in VS Code's Outline panel (and breadcrumbs).
// Shows: Report → Declarations (fields/params/vars) → Bands → Groups

import * as vscode from 'vscode';
import { parseDeclarations } from './jrxmlParser';
import type { OutlineEntry } from './jrxmlParser';

// Map our kind strings to VS Code SymbolKind icons
const KIND_MAP: Readonly<Record<string, vscode.SymbolKind>> = {
    report:     vscode.SymbolKind.File,
    group:      vscode.SymbolKind.Module,
    band:       vscode.SymbolKind.Namespace,
    field:      vscode.SymbolKind.Field,
    parameter:  vscode.SymbolKind.TypeParameter,
    variable:   vscode.SymbolKind.Variable,
    textField:  vscode.SymbolKind.String,
    staticText: vscode.SymbolKind.String,
    dataset:    vscode.SymbolKind.Namespace,
    style:      vscode.SymbolKind.Interface,
    frame:      vscode.SymbolKind.Module,
    image:      vscode.SymbolKind.File,
    subreport:  vscode.SymbolKind.File,
    line:       vscode.SymbolKind.Object,
    rectangle:  vscode.SymbolKind.Object,
    ellipse:    vscode.SymbolKind.Object,
    break:      vscode.SymbolKind.Event,
    chart:      vscode.SymbolKind.Array,
    table:      vscode.SymbolKind.Array,
    list:       vscode.SymbolKind.Array,
    crosstab:   vscode.SymbolKind.Array,
};

/**
 * Convert our internal OutlineEntry tree into VS Code DocumentSymbol tree.
 *
 * Every node carries an explicit `[offset, end]` span so that a parent's range
 * contains its children's ranges — VS Code rejects symbol trees that violate
 * this, and selection/breadcrumb navigation depends on it.
 */
function nodesToSymbols(
    nodes: readonly OutlineEntry[],
    document: vscode.TextDocument
): vscode.DocumentSymbol[] {
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
    { language: 'jrxml' },
    {
        provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
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

export { provider, nodesToSymbols };
