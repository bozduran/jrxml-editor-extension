// referenceProvider.js
// "Find All References" for $F{...} / $P{...} / $V{...} in the current file.
// References in a different declaration scope are a different symbol: a
// subdataset field named `amount` is not the report field named `amount`.

const vscode = require('vscode');
const { parseDeclarations } = require('./jrxmlParser');
const { resolveSymbol, occurrences, declarationInAnyScope } = require('./reportSymbols');

const provider = vscode.languages.registerReferenceProvider(
    { language: 'jrxml' },
    {
        provideReferences(document, position, context) {
            try {
                const parsed = parseDeclarations(document);
                const symbol = resolveSymbol(parsed, {
                    offset: document.offsetAt(position),
                    lineText: document.lineAt(position).text,
                    character: position.character,
                });
                if (!symbol) return null;

                const locations = [];
                const seen = new Set();

                for (const reference of occurrences(parsed, symbol)) {
                    if (seen.has(reference.offset)) continue;
                    seen.add(reference.offset);

                    locations.push(new vscode.Location(
                        document.uri,
                        new vscode.Range(
                            document.positionAt(reference.offset),
                            document.positionAt(reference.end)
                        )
                    ));
                }

                if (context && context.includeDeclaration) {
                    const declaration = symbol.scope.kind === 'unknown'
                        ? declarationInAnyScope(parsed, symbol.token)
                        : symbol.declaration;
                    if (declaration && typeof declaration.nameOffset === 'number') {
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

module.exports = { provider };
