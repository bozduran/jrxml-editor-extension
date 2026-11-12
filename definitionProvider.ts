// definitionProvider.ts
// Ctrl+Click on $F{name}, $P{name}, $V{name} → jumps to the declaration tag.

import * as vscode from 'vscode';
import { parseDeclarations } from './jrxmlParser';
import { findReferenceToken } from './expressionUtils';
import { resolveSymbol } from './reportSymbols';
import { resourcesForDocument } from './resourceIndex';
import { analyseSubreports } from './subreportIndex';
import type { AnalysedSubreport } from './subreportIndex';

function detectReferenceAtPosition(document: vscode.TextDocument, position: vscode.Position) {
    return findReferenceToken(document.lineAt(position).text, position.character);
}

function workspaceRoots(): string[] {
    return ((vscode.workspace && vscode.workspace.workspaceFolders) || [])
        .map(folder => folder.uri && folder.uri.fsPath)
        .filter((root): root is string => Boolean(root));
}

/** The resolved subreport whose path literal contains the cursor, or null. */
function subreportAt(document: vscode.TextDocument, position: vscode.Position): AnalysedSubreport | undefined {
    const offset = document.offsetAt(position);
    return analyseSubreports(document, workspaceRoots()).find(link =>
        !link.dynamic && link.target &&
        offset >= link.offset && offset <= link.offset + link.length);
}

const provider = vscode.languages.registerDefinitionProvider(
    { language: 'jrxml' },
    {
        provideDefinition(
            document: vscode.TextDocument,
            position: vscode.Position
        ): vscode.Location | null {
            const ref = detectReferenceAtPosition(document, position);
            if (!ref) {
                const subreport = subreportAt(document, position);
                if (!subreport || !subreport.target) return null;
                return new vscode.Location(
                    vscode.Uri.file(subreport.target),
                    new vscode.Range(0, 0, 0, 0)
                );
            }

            // Resource keys live in .properties files, not in the report.
            if (ref.sigil === 'R') {
                const index = resourcesForDocument(document);
                const entry = index && index.entries.get(ref.name);
                if (!entry) return null;

                const located = entry.defaultPosition || entry.locales.values().next().value;
                if (!located) return null;

                return new vscode.Location(
                    vscode.Uri.file(located.file),
                    new vscode.Range(
                        located.line, located.character,
                        located.line, located.character + entry.key.length
                    )
                );
            }

            const parsed = parseDeclarations(document);
            // Resolve in the declaration scope that owns the reference, so a
            // dataset field and a report field with the same name stay distinct.
            const symbol = resolveSymbol(parsed, {
                offset: document.offsetAt(position),
                lineText: document.lineAt(position).text,
                character: position.character,
            });
            const decl = symbol && symbol.declaration;
            if (!decl || !('nameOffset' in decl) || typeof decl.nameOffset !== 'number') return null;

            // Point to the name="..." attribute value inside the declaration tag
            const targetPos = document.positionAt(decl.nameOffset);
            const targetEnd = document.positionAt(decl.nameOffset + decl.name.length);

            return new vscode.Location(
                document.uri,
                new vscode.Range(targetPos, targetEnd)
            );
        }
    }
);

export { provider };
