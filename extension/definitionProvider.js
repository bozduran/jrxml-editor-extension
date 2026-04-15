// definitionProvider.js
// Ctrl+Click on $F{name}, $P{name}, $V{name} → jumps to the declaration tag.

const vscode = require('vscode');
const { parseDeclarations } = require('./jrxmlParser');

function detectReferenceAtPosition(document, position) {
    const line = document.lineAt(position).text;
    const col  = position.character;
    const re   = /\$(F|P|V)\{([\w.]+)\}/g;
    let m;
    while ((m = re.exec(line)) !== null) {
        if (m.index <= col && col <= m.index + m[0].length) {
            return { sigil: m[1], name: m[2] };
        }
    }
    return null;
}

const provider = vscode.languages.registerDefinitionProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideDefinition(document, position) {
            const ref = detectReferenceAtPosition(document, position);
            if (!ref) return null;

            const parsed = parseDeclarations(document);

            let decl = null;
            if (ref.sigil === 'F') decl = parsed.fields.find(f => f.name === ref.name);
            else if (ref.sigil === 'P') decl = parsed.parameters.find(p => p.name === ref.name);
            else if (ref.sigil === 'V') decl = parsed.variables.find(v => v.name === ref.name);

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
