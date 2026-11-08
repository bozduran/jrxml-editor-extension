// definitionProvider.js
// Ctrl+Click on $F{name}, $P{name}, $V{name} → jumps to the declaration tag.

const vscode = require('vscode');
const { parseDeclarations, resolveDeclarationScope } = require('./jrxmlParser');
const { findReferenceToken } = require('./expressionUtils');
const { resourcesForDocument } = require('./resourceIndex');
const { analyseSubreports } = require('./subreportIndex');

function detectReferenceAtPosition(document, position) {
    return findReferenceToken(document.lineAt(position).text, position.character);
}

function workspaceRoots() {
    return ((vscode.workspace && vscode.workspace.workspaceFolders) || [])
        .map(folder => folder.uri && folder.uri.fsPath)
        .filter(Boolean);
}

/** The resolved subreport whose path literal contains the cursor, or null. */
function subreportAt(document, position) {
    const offset = document.offsetAt(position);
    return analyseSubreports(document, workspaceRoots()).find(link =>
        !link.dynamic && link.target &&
        offset >= link.offset && offset <= link.offset + link.length);
}

const provider = vscode.languages.registerDefinitionProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideDefinition(document, position) {
            const ref = detectReferenceAtPosition(document, position);
            if (!ref) {
                const subreport = subreportAt(document, position);
                if (!subreport) return null;
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
