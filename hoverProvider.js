// hoverProvider.js
// Shows a tooltip when hovering over $F{name}, $P{name}, $V{name} in .jrxml files.

const vscode = require('vscode');
const { parseDeclarations, resolveDeclarationScope } = require('./jrxmlParser');
const { findReferenceToken } = require('./expressionUtils');
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

/** The report-scope declaration with this name, used to explain scope errors. */
function reportDeclaration(parsed, sigil, name) {
    const list = sigil === 'F' ? parsed.fields
        : sigil === 'P' ? parsed.parameters
        : parsed.variables;
    return (list || []).find(declaration => declaration.name === name) || null;
}

const provider = vscode.languages.registerHoverProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideHover(document, position) {
            const ref = findReferenceToken(document.lineAt(position).text, position.character);
            if (!ref) return null;

            let decl   = null;
            let kind   = '';
            let isBuiltin = false;

            const parsed = parseDeclarations(document);
            const scope  = resolveDeclarationScope(parsed, document.offsetAt(position));

            if (ref.sigil === 'F') {
                decl = scope.fields.find(f => f.name === ref.name);
                kind = 'Field';
            } else if (ref.sigil === 'P') {
                decl = scope.parameters.find(p => p.name === ref.name);
                if (!decl && BUILTIN_PARAMETER_NAMES.has(ref.name)) {
                    const b = BUILTIN_PARAMETERS.find(p => p.name === ref.name);
                    decl = { name: b.name, type: b.type, fullType: b.type, description: b.description };
                    isBuiltin = true;
                }
                kind = 'Parameter';
            } else if (ref.sigil === 'V') {
                decl = scope.variables.find(v => v.name === ref.name);
                if (!decl && BUILTIN_VARIABLE_NAMES.has(ref.name)) {
                    const b = BUILTIN_VARIABLES.find(v => v.name === ref.name);
                    decl = { name: b.name, type: b.type, fullType: b.type, description: b.description };
                    isBuiltin = true;
                }
                kind = 'Variable';
            }

            // A report-scope name used inside a dataset is not available there.
            // Showing the report declaration as if it resolved would be a lie,
            // so point at the scope problem instead.
            const elsewhere = !decl && scope.kind === 'dataset'
                ? reportDeclaration(parsed, ref.sigil, ref.name)
                : null;

            // Count how many times this reference appears in the file
            const refCount = parsed.references.filter(r => r.sigil === ref.sigil && r.name === ref.name).length;

            // Build markdown tooltip
            // Rendered as UNtrusted markdown: file-derived text (descriptions,
            // class names) must not be able to inject command: links or HTML.
            const md = new vscode.MarkdownString('', true);

            const bang = ref.bang ? '!' : '';

            if (decl) {
                const badge  = isBuiltin ? ' *(built-in)*' : '';
                const sigStr = `$${ref.sigil}${bang}{${ref.name}}`;

                md.appendMarkdown(`### ${sigStr}\n\n`);
                md.appendMarkdown(`| | |\n|---|---|\n`);
                md.appendMarkdown(`| **Kind** | ${kind}${badge} |\n`);
                md.appendMarkdown(`| **Type** | \`${mdCode(decl.fullType || decl.type)}\` |\n`);
                if (decl.description) {
                    md.appendMarkdown(`| **Info** | ${mdSafe(decl.description)} |\n`);
                }
                md.appendMarkdown(`| **Used** | ${refCount} time${refCount !== 1 ? 's' : ''} in this file |\n`);
            } else if (elsewhere) {
                md.appendMarkdown(`### $${ref.sigil}${bang}{${ref.name}}\n\n`);
                md.appendMarkdown(
                    `⚠️ **${kind} '${ref.name}' is declared at report scope and is not available inside dataset '${mdSafe(scope.datasetName)}'.**\n\n`
                );
                md.appendMarkdown('Pass it to the dataset as a parameter and bind it in the `<datasetRun>`.');
            } else if (scope.kind === 'unknown') {
                md.appendMarkdown(`### $${ref.sigil}${bang}{${ref.name}}\n\n`);
                md.appendMarkdown(
                    `⚠️ **Dataset '${mdSafe(scope.datasetName)}' is not defined in this file**, so this reference cannot be resolved.`
                );
            } else {
                md.appendMarkdown(`### $${ref.sigil}${bang}{${ref.name}}\n\n`);
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
