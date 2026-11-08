// referenceProvider.js
// "Find All References" for $F{...} / $P{...} / $V{...} in the current file.
// References in a different declaration scope are a different symbol: a
// subdataset field named `amount` is not the report field named `amount`.

const vscode = require('vscode');
const { parseDeclarations, resolveDeclarationScope } = require('./jrxmlParser');
const { findReferenceToken, findDeclarationAtOffset } = require('./expressionUtils');

const SIGIL_KEY = { F: 'fields', P: 'parameters', V: 'variables' };

/** A stable identity for a resolved scope; null means "cannot tell". */
function scopeKey(scope) {
    if (!scope || scope.kind === 'unknown') return null;
    return `${scope.kind}:${scope.datasetName || ''}`;
}

function declarationIn(scope, ref) {
    const list = scope[SIGIL_KEY[ref.sigil]] || [];
    return list.find(declaration => declaration.name === ref.name) || null;
}

/** Merged lookup for a scope we cannot identify (unresolved dataset run). */
function anyDeclaration(parsed, ref) {
    const list = ref.sigil === 'F'
        ? parsed.allFields
        : ref.sigil === 'P' ? parsed.allParameters : parsed.allVariables;
    return (list || []).find(declaration => declaration.name === ref.name) || null;
}

const provider = vscode.languages.registerReferenceProvider(
    { language: 'jrxml' },
    {
        provideReferences(document, position, context) {
            try {
                const parsed = parseDeclarations(document);
                const offset = document.offsetAt(position);

                let ref = findReferenceToken(document.lineAt(position).text, position.character);
                if (ref) {
                    ref = { sigil: ref.sigil, name: ref.name };
                } else {
                    const declaration = findDeclarationAtOffset(parsed, offset);
                    if (!declaration) return null;
                    ref = { sigil: declaration.sigil, name: declaration.name };
                }

                const scope = resolveDeclarationScope(parsed, offset);
                const targetKey = scopeKey(scope);

                const locations = [];
                const seen = new Set();

                for (const reference of parsed.references) {
                    if (reference.sigil !== ref.sigil || reference.name !== ref.name) continue;

                    // extractReferences() also records subreport attribute names;
                    // only real $X{name} / $P!{name} tokens carry an `end`.
                    if (typeof reference.end !== 'number') continue;

                    // Skip same-named references that resolve in another scope.
                    if (targetKey !== null) {
                        const refScope = resolveDeclarationScope(parsed, reference.offset);
                        if (scopeKey(refScope) !== targetKey) continue;
                    }

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
                    const declaration = scopeKey(scope) === null
                        ? anyDeclaration(parsed, ref)
                        : declarationIn(scope, ref);
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
