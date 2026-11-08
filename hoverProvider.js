// hoverProvider.js
// Shows a tooltip when hovering over $F{name}, $P{name}, $V{name} in .jrxml files.

const vscode = require('vscode');
const path = require('path');
const { parseDeclarations } = require('./jrxmlParser');
const { resourcesForDocument } = require('./resourceIndex');
const { bundleAttribute } = require('./resourceBundle');
const { findReferenceToken } = require('./expressionUtils');
const { resolveSymbol } = require('./reportSymbols');
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

/** Hover for a `$R{key}` resource-bundle reference. */
function resourceHover(document, position, ref) {
    const text   = document.getText();
    const bundle = bundleAttribute(text);
    const index  = resourcesForDocument(document);
    const md     = new vscode.MarkdownString('', true);

    md.appendMarkdown(`### $R{${ref.name}}\n\n`);

    if (!index) {
        md.appendMarkdown(bundle
            ? `⚠️ Resource bundle '${mdSafe(bundle.name)}' was not found next to the report or in the workspace.`
            : '⚠️ No resource bundle is configured for this report.');
    } else {
        const entry = index.entries.get(ref.name);
        if (!entry) {
            md.appendMarkdown(`⚠️ Key '${mdSafe(ref.name)}' is not found in resource bundle '${mdSafe(index.name)}'.`);
        } else {
            md.appendMarkdown('| | |\n|---|---|\n');
            md.appendMarkdown(`| **Value** | ${entry.defaultValue !== null ? mdSafe(entry.defaultValue) : '_no default value_'} |\n`);
            if (entry.defaultFile) {
                md.appendMarkdown(`| **Bundle** | ${mdSafe(path.basename(entry.defaultFile))} |\n`);
            }
            for (const [locale, located] of entry.locales) {
                md.appendMarkdown(`| **${mdSafe(locale)}** | ${mdSafe(located.value)} |\n`);
            }
        }
    }

    return new vscode.Hover(md, new vscode.Range(
        position.line, ref.start,
        position.line, ref.end
    ));
}

const provider = vscode.languages.registerHoverProvider(
    { language: 'jrxml' },
    {
        provideHover(document, position) {
            const ref = findReferenceToken(document.lineAt(position).text, position.character);
            if (!ref) return null;
            if (ref.sigil === 'R') return resourceHover(document, position, ref);

            const parsed = parseDeclarations(document);
            const symbol = resolveSymbol(parsed, {
                offset: document.offsetAt(position),
                lineText: document.lineAt(position).text,
                character: position.character,
            });
            if (!symbol) return null;

            const decl      = symbol.declaration;
            const kind      = symbol.kind[0].toUpperCase() + symbol.kind.slice(1);
            const isBuiltin = symbol.builtin;
            const scope     = symbol.scope;

            // A report-scope name used inside a dataset is not available there.
            // Showing the report declaration as if it resolved would be a lie,
            // so point at the scope problem instead.
            const elsewhere = symbol.reportDeclaration;

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
                md.appendMarkdown(`No \`<${symbol.kind} name="${ref.name}">\` declaration found.`);
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
