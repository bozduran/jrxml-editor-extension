// hoverProvider.js
// Shows a tooltip when hovering over $F{name}, $P{name}, $V{name} in .jrxml files.

const vscode = require('vscode');
const { parseDeclarations } = require('./jrxmlParser');
const {
    BUILTIN_VARIABLES,
    BUILTIN_PARAMETERS,
    BUILTIN_VARIABLE_NAMES,
    BUILTIN_PARAMETER_NAMES,
} = require('./jasperBuiltins');

/**
 * Sanitize file-derived text before appending it to a MarkdownString.
 * Escapes markdown structural characters and collapses newlines so a crafted
 * `<description>` cannot inject links, code spans, tables or raw HTML.
 */
function mdSafe(text) {
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/([`*_{}\[\]()#|<>])/g, '\\$1')
        .replace(/\r?\n+/g, ' ')
        .trim();
}

/** Escape text that will be placed inside a markdown code span. */
function mdCode(text) {
    return String(text ?? '').replace(/`/g, '\\`');
}

/**
 * Given a document and position, detect whether the cursor is on a $F/$P/$V
 * reference and return { sigil, name } or null.
 */
function detectReferenceAtPosition(document, position) {
    const line   = document.lineAt(position).text;
    const col    = position.character;

    // Scan backwards from cursor to find the start of a $X{ token
    const dollarRe = /\$(F|P|V)\{([\w.]+)\}/g;
    let m;
    while ((m = dollarRe.exec(line)) !== null) {
        if (m.index <= col && col <= m.index + m[0].length) {
            return { sigil: m[1], name: m[2], start: m.index, end: m.index + m[0].length };
        }
    }
    return null;
}

const provider = vscode.languages.registerHoverProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideHover(document, position) {
            const ref = detectReferenceAtPosition(document, position);
            if (!ref) return null;

            let decl   = null;
            let kind   = '';
            let isBuiltin = false;

            const parsed = parseDeclarations(document);

            if (ref.sigil === 'F') {
                decl = parsed.allFields.find(f => f.name === ref.name);
                kind = 'Field';
            } else if (ref.sigil === 'P') {
                decl = parsed.allParameters.find(p => p.name === ref.name);
                if (!decl && BUILTIN_PARAMETER_NAMES.has(ref.name)) {
                    const b = BUILTIN_PARAMETERS.find(p => p.name === ref.name);
                    decl = { name: b.name, type: b.type, fullType: b.type, description: b.description };
                    isBuiltin = true;
                }
                kind = 'Parameter';
            } else if (ref.sigil === 'V') {
                decl = parsed.allVariables.find(v => v.name === ref.name);
                if (!decl && BUILTIN_VARIABLE_NAMES.has(ref.name)) {
                    const b = BUILTIN_VARIABLES.find(v => v.name === ref.name);
                    decl = { name: b.name, type: b.type, fullType: b.type, description: b.description };
                    isBuiltin = true;
                }
                kind = 'Variable';
            }

            // Count how many times this reference appears in the file
            const refCount = parsed.references.filter(r => r.sigil === ref.sigil && r.name === ref.name).length;

            // Build markdown tooltip
            // Rendered as UNtrusted markdown: file-derived text (descriptions,
            // class names) must not be able to inject command: links or HTML.
            const md = new vscode.MarkdownString('', true);

            if (decl) {
                const badge  = isBuiltin ? ' *(built-in)*' : '';
                const sigStr = `$${ref.sigil}{${ref.name}}`;

                md.appendMarkdown(`### ${sigStr}\n\n`);
                md.appendMarkdown(`| | |\n|---|---|\n`);
                md.appendMarkdown(`| **Kind** | ${kind}${badge} |\n`);
                md.appendMarkdown(`| **Type** | \`${mdCode(decl.fullType || decl.type)}\` |\n`);
                if (decl.description) {
                    md.appendMarkdown(`| **Info** | ${mdSafe(decl.description)} |\n`);
                }
                md.appendMarkdown(`| **Used** | ${refCount} time${refCount !== 1 ? 's' : ''} in this file |\n`);
            } else {
                md.appendMarkdown(`### $${ref.sigil}{${ref.name}}\n\n`);
                md.appendMarkdown(`⚠️ **${kind} not declared** in this file.\n\n`);
                md.appendMarkdown(`No \`<${ref.sigil === 'F' ? 'field' : ref.sigil === 'P' ? 'parameter' : 'variable'} name="${ref.name}">\` declaration found.`);
            }

            const range = new vscode.Range(
                position.line, ref.start,
                position.line, ref.end
            );
            return new vscode.Hover(md, range);
        }
    }
);

module.exports = { provider };
