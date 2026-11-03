// referenceProvider.js
// "Find All References" for $F{...} / $P{...} / $V{...} in the current file.

const vscode = require('vscode');
const { parseDeclarations } = require('./jrxmlParser');
const { findReferenceToken, findDeclarationAtOffset } = require('./expressionUtils');

function declarationFor(parsed, ref) {
    const list = ref.sigil === 'F'
        ? parsed.allFields
        : ref.sigil === 'P' ? parsed.allParameters : parsed.allVariables;
    return (list || []).find(declaration => declaration.name === ref.name) || null;
}

const provider = vscode.languages.registerReferenceProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideReferences(document, position, context) {
            try {
                const parsed = parseDeclarations(document);

                let ref = findReferenceToken(document.lineAt(position).text, position.character);
                if (ref) {
                    ref = { sigil: ref.sigil, name: ref.name };
                } else {
                    const declaration = findDeclarationAtOffset(parsed, document.offsetAt(position));
                    if (!declaration) return null;
                    ref = { sigil: declaration.sigil, name: declaration.name };
                }

                const text = document.getText();
                const locations = [];
                const seen = new Set();

                for (const reference of parsed.references) {
                    if (reference.sigil !== ref.sigil || reference.name !== ref.name) continue;

                    // extractReferences() also records subreport attribute names;
                    // only include real $X{name} tokens.
                    const token = `$${reference.sigil}{${reference.name}}`;
                    if (text.slice(reference.offset, reference.offset + token.length) !== token) continue;
                    if (seen.has(reference.offset)) continue;
                    seen.add(reference.offset);

                    locations.push(new vscode.Location(
                        document.uri,
                        new vscode.Range(
                            document.positionAt(reference.offset),
                            document.positionAt(reference.offset + token.length)
                        )
                    ));
                }

                if (context && context.includeDeclaration) {
                    const declaration = declarationFor(parsed, ref);
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
