// definitionProvider.js
// Ctrl+Click on $F{name}, $P{name}, $V{name} → jumps to the declaration tag.

const vscode = require('vscode');
const { parseDeclarations, resolveDeclarationScope } = require('./jrxmlParser');
const { findReferenceToken } = require('./expressionUtils');

function detectReferenceAtPosition(document, position) {
    return findReferenceToken(document.lineAt(position).text, position.character);
}

const provider = vscode.languages.registerDefinitionProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideDefinition(document, position) {
            const ref = detectReferenceAtPosition(document, position);
            if (!ref) return null;

            const parsed = parseDeclarations(document);
            // Resolve in the declaration scope that owns the reference, so a
            // dataset field and a report field with the same name stay distinct.
            const scope = resolveDeclarationScope(parsed, document.offsetAt(position));

            let decl = null;
            if (ref.sigil === 'F') decl = scope.fields.find(f => f.name === ref.name);
            else if (ref.sigil === 'P') decl = scope.parameters.find(p => p.name === ref.name);
            else if (ref.sigil === 'V') decl = scope.variables.find(v => v.name === ref.name);

            if (!decl) return null;

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

module.exports = { provider };
