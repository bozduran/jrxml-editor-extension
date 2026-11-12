// referenceProvider.ts
// "Find All References" for $F{...} / $P{...} / $V{...} in the current file.
// References in a different declaration scope are a different symbol: a
// subdataset field named `amount` is not the report field named `amount`.

import * as vscode from 'vscode';
import { parseDeclarations } from './jrxmlParser';
import { resolveSymbol, occurrences, declarationInAnyScope } from './reportSymbols';

const provider = vscode.languages.registerReferenceProvider(
    { language: 'jrxml' },
    {
        provideReferences(
            document: vscode.TextDocument,
            position: vscode.Position,
            context: vscode.ReferenceContext
        ): vscode.Location[] | null {
            try {
                const parsed = parseDeclarations(document);
                const symbol = resolveSymbol(parsed, {
                    offset: document.offsetAt(position),
                    lineText: document.lineAt(position).text,
                    character: position.character,
                });
                if (!symbol) return null;

                const locations: vscode.Location[] = [];
                const seen = new Set<number>();

                for (const reference of occurrences(parsed, symbol)) {
                    if (seen.has(reference.offset)) continue;
                    seen.add(reference.offset);

                    // occurrences() only returns references that carry a span.
                    const end = reference.end ?? reference.offset + reference.name.length;
                    locations.push(new vscode.Location(
                        document.uri,
                        new vscode.Range(
                            document.positionAt(reference.offset),
                            document.positionAt(end)
                        )
                    ));
                }

                if (context && context.includeDeclaration) {
                    const declaration = symbol.scope.kind === 'unknown'
                        ? declarationInAnyScope(parsed, symbol.token)
                        : symbol.declaration;
                    if (declaration && 'nameOffset' in declaration && typeof declaration.nameOffset === 'number') {
                        locations.push(new vscode.Location(
                            document.uri,
                            new vscode.Range(
                                document.positionAt(declaration.nameOffset),
                                document.positionAt(declaration.nameOffset + declaration.name.length)
                            )
                        ));
                    }
                }

                return locations.length > 0 ? locations : null;
            } catch (err) {
                console.error('[JRXML] Reference provider error:', err);
                return null;
            }
        },
    }
);

export { provider };
