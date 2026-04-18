// hoverProvider.js
// Shows a tooltip when hovering over $F{name}, $P{name}, $V{name} in .jrxml files.

const vscode = require('vscode');
const { parseDeclarations } = require('./jrxmlParser');

// Built-in variable/parameter descriptions for system ones
const BUILTIN_VAR_DOCS = {
    PAGE_NUMBER:         { type: 'Integer', desc: 'Current page number' },
    PAGE_COUNT:          { type: 'Integer', desc: 'Total number of pages' },
    REPORT_COUNT:        { type: 'Integer', desc: 'Total records processed across the whole report' },
    COLUMN_NUMBER:       { type: 'Integer', desc: 'Current column number' },
    COLUMN_COUNT:        { type: 'Integer', desc: 'Total number of columns' },
    MASTER_CURRENT_PAGE: { type: 'Integer', desc: 'Current page in the master report' },
    MASTER_TOTAL_PAGES:  { type: 'Integer', desc: 'Total pages in the master report' },
};

const BUILTIN_PARAM_DOCS = {
    REPORT_CONNECTION:         { type: 'java.sql.Connection',              desc: 'JDBC database connection' },
    REPORT_DATA_SOURCE:        { type: 'JRDataSource',                     desc: 'The JRDataSource object' },
    REPORT_PARAMETERS_MAP:     { type: 'java.util.Map',                    desc: 'Map of all report parameters' },
    IS_IGNORE_PAGINATION:      { type: 'Boolean',                          desc: 'Disables pagination when true' },
    REPORT_LOCALE:             { type: 'java.util.Locale',                 desc: 'Report locale' },
    REPORT_TIME_ZONE:          { type: 'java.util.TimeZone',               desc: 'Report time zone' },
    REPORT_FORMAT_FACTORY:     { type: 'JRFormatFactory',                  desc: 'Format factory for dates/numbers' },
    REPORT_CLASS_LOADER:       { type: 'ClassLoader',                      desc: 'Class loader for the report' },
    REPORT_MAX_COUNT:          { type: 'Integer',                          desc: 'Maximum number of records to process' },
    REPORT_VIRTUALIZER:        { type: 'JRVirtualizer',                    desc: 'Virtualizer for large reports' },
};

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
                decl = parsed.fields.find(f => f.name === ref.name);
                kind = 'Field';
            } else if (ref.sigil === 'P') {
                decl = parsed.parameters.find(p => p.name === ref.name);
                if (!decl && BUILTIN_PARAM_DOCS[ref.name]) {
                    decl = { ...BUILTIN_PARAM_DOCS[ref.name], name: ref.name, type: BUILTIN_PARAM_DOCS[ref.name].type, description: BUILTIN_PARAM_DOCS[ref.name].desc };
                    isBuiltin = true;
                }
                kind = 'Parameter';
            } else if (ref.sigil === 'V') {
                decl = parsed.variables.find(v => v.name === ref.name);
                if (!decl && BUILTIN_VAR_DOCS[ref.name]) {
                    decl = { ...BUILTIN_VAR_DOCS[ref.name], name: ref.name, type: BUILTIN_VAR_DOCS[ref.name].type, description: BUILTIN_VAR_DOCS[ref.name].desc };
                    isBuiltin = true;
                }
                kind = 'Variable';
            }

            // Count how many times this reference appears in the file
            const refCount = parsed.references.filter(r => r.sigil === ref.sigil && r.name === ref.name).length;

            // Build markdown tooltip
            const md = new vscode.MarkdownString('', true);
            md.isTrusted = true;

            if (decl) {
                const badge  = isBuiltin ? ' *(built-in)*' : '';
                const sigStr = `$${ref.sigil}{${ref.name}}`;

                md.appendMarkdown(`### ${sigStr}\n\n`);
                md.appendMarkdown(`| | |\n|---|---|\n`);
                md.appendMarkdown(`| **Kind** | ${kind}${badge} |\n`);
                md.appendMarkdown(`| **Type** | \`${decl.fullType || decl.type}\` |\n`);
                if (decl.description) {
                    md.appendMarkdown(`| **Info** | ${decl.description.replace(/\n/g, ' ')} |\n`);
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
