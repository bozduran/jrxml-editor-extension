// completionProvider.js
// Provides autocomplete for:
//   - $F{...}  → fields declared in this .jrxml file
//   - $P{...}  → parameters declared in this .jrxml file
//   - $V{...}  → variables declared in this .jrxml file
//   - Jasper built-in functions
//   - Common Java types / static methods

const vscode = require('vscode');
const { EXPRESSION_TAGS } = require('./expressionUtils');
const { parseDeclarations } = require('./jrxmlParser');

// ── Jasper built-in function definitions ──────────────────────────────────────
const JASPER_FUNCTIONS = [
    { label: 'TODAY',       detail: 'TODAY()',                        doc: 'Returns today\'s date as java.util.Date.',                                    snippet: 'TODAY()' },
    { label: 'NOW',         detail: 'NOW()',                          doc: 'Returns the current date and time as java.util.Date.',                        snippet: 'NOW()' },
    { label: 'DATE',        detail: 'DATE(year, month, day)',         doc: 'Constructs a Date from year, month (1-based), and day.',                      snippet: 'DATE(${1:year}, ${2:month}, ${3:day})' },
    { label: 'IF',          detail: 'IF(condition, trueVal, falseVal)', doc: 'Ternary-style conditional.',                                               snippet: 'IF(${1:condition}, ${2:trueVal}, ${3:falseVal})' },
    { label: 'AND',         detail: 'AND(a, b, ...)',                 doc: 'Returns true if all arguments are true.',                                     snippet: 'AND(${1:a}, ${2:b})' },
    { label: 'OR',          detail: 'OR(a, b, ...)',                  doc: 'Returns true if at least one argument is true.',                              snippet: 'OR(${1:a}, ${2:b})' },
    { label: 'NOT',         detail: 'NOT(value)',                     doc: 'Negates a boolean value.',                                                    snippet: 'NOT(${1:value})' },
    { label: 'CONTAINS',    detail: 'CONTAINS(str, sub)',             doc: 'Returns true if str contains sub.',                                           snippet: 'CONTAINS(${1:str}, ${2:sub})' },
    { label: 'STARTSWITH',  detail: 'STARTSWITH(str, prefix)',        doc: 'Returns true if str starts with prefix.',                                     snippet: 'STARTSWITH(${1:str}, ${2:prefix})' },
    { label: 'ENDSWITH',    detail: 'ENDSWITH(str, suffix)',          doc: 'Returns true if str ends with suffix.',                                       snippet: 'ENDSWITH(${1:str}, ${2:suffix})' },
    { label: 'LEN',         detail: 'LEN(str)',                       doc: 'Returns the length of a string.',                                             snippet: 'LEN(${1:str})' },
    { label: 'LEFT',        detail: 'LEFT(str, n)',                   doc: 'Returns the leftmost n characters.',                                          snippet: 'LEFT(${1:str}, ${2:n})' },
    { label: 'RIGHT',       detail: 'RIGHT(str, n)',                  doc: 'Returns the rightmost n characters.',                                         snippet: 'RIGHT(${1:str}, ${2:n})' },
    { label: 'MID',         detail: 'MID(str, start, len)',           doc: 'Returns a substring starting at start (1-based) of length len.',              snippet: 'MID(${1:str}, ${2:start}, ${3:len})' },
    { label: 'UPPER',       detail: 'UPPER(str)',                     doc: 'Converts str to uppercase.',                                                  snippet: 'UPPER(${1:str})' },
    { label: 'LOWER',       detail: 'LOWER(str)',                     doc: 'Converts str to lowercase.',                                                  snippet: 'LOWER(${1:str})' },
    { label: 'TRIM',        detail: 'TRIM(str)',                      doc: 'Removes leading and trailing whitespace.',                                     snippet: 'TRIM(${1:str})' },
    { label: 'REPLACE',     detail: 'REPLACE(str, old, new)',         doc: 'Replaces all occurrences of old with new in str.',                            snippet: 'REPLACE(${1:str}, ${2:old}, ${3:new})' },
    { label: 'CONCATENATE', detail: 'CONCATENATE(a, b, ...)',         doc: 'Concatenates two or more strings.',                                           snippet: 'CONCATENATE(${1:a}, ${2:b})' },
    { label: 'TEXT',        detail: 'TEXT(value, format)',            doc: 'Formats a number or date as a string using a pattern.',                       snippet: 'TEXT(${1:value}, "${2:format}")' },
    { label: 'VALUE',       detail: 'VALUE(str)',                     doc: 'Parses a numeric string into a number.',                                      snippet: 'VALUE(${1:str})' },
    { label: 'INT',         detail: 'INT(value)',                     doc: 'Truncates a number to an integer.',                                           snippet: 'INT(${1:value})' },
    { label: 'ROUND',       detail: 'ROUND(number, digits)',          doc: 'Rounds number to the specified decimal digits.',                               snippet: 'ROUND(${1:number}, ${2:digits})' },
    { label: 'ROUNDDOWN',   detail: 'ROUNDDOWN(number, digits)',      doc: 'Rounds number down (toward zero).',                                           snippet: 'ROUNDDOWN(${1:number}, ${2:digits})' },
    { label: 'ROUNDUP',     detail: 'ROUNDUP(number, digits)',        doc: 'Rounds number up (away from zero).',                                          snippet: 'ROUNDUP(${1:number}, ${2:digits})' },
    { label: 'FLOOR',       detail: 'FLOOR(number)',                  doc: 'Returns the largest integer ≤ number.',                                       snippet: 'FLOOR(${1:number})' },
    { label: 'CEILING',     detail: 'CEILING(number)',                doc: 'Returns the smallest integer ≥ number.',                                      snippet: 'CEILING(${1:number})' },
    { label: 'ABS',         detail: 'ABS(number)',                    doc: 'Returns the absolute value.',                                                 snippet: 'ABS(${1:number})' },
    { label: 'MOD',         detail: 'MOD(number, divisor)',           doc: 'Returns the remainder of number / divisor.',                                  snippet: 'MOD(${1:number}, ${2:divisor})' },
    { label: 'POWER',       detail: 'POWER(base, exp)',               doc: 'Returns base raised to the power of exp.',                                    snippet: 'POWER(${1:base}, ${2:exp})' },
    { label: 'SQRT',        detail: 'SQRT(number)',                   doc: 'Returns the square root.',                                                    snippet: 'SQRT(${1:number})' },
    { label: 'SUM',         detail: 'SUM(value)',                     doc: 'Accumulates a sum.',                                                          snippet: 'SUM(${1:value})' },
    { label: 'MIN',         detail: 'MIN(value)',                     doc: 'Tracks the minimum value.',                                                   snippet: 'MIN(${1:value})' },
    { label: 'MAX',         detail: 'MAX(value)',                     doc: 'Tracks the maximum value.',                                                   snippet: 'MAX(${1:value})' },
    { label: 'AVG',         detail: 'AVG(value)',                     doc: 'Tracks the running average.',                                                 snippet: 'AVG(${1:value})' },
    { label: 'COUNT',       detail: 'COUNT(value)',                   doc: 'Counts non-null values.',                                                     snippet: 'COUNT(${1:value})' },
    { label: 'COUNTIF',     detail: 'COUNTIF(value, condition)',      doc: 'Counts values satisfying the condition.',                                     snippet: 'COUNTIF(${1:value}, ${2:condition})' },
    { label: 'SUMIF',       detail: 'SUMIF(value, condition)',        doc: 'Sums values satisfying the condition.',                                       snippet: 'SUMIF(${1:value}, ${2:condition})' },
    { label: 'FIRST',       detail: 'FIRST(value)',                   doc: 'Returns the first non-null value encountered.',                               snippet: 'FIRST(${1:value})' },
    { label: 'STDEV',       detail: 'STDEV(value)',                   doc: 'Calculates standard deviation.',                                              snippet: 'STDEV(${1:value})' },
    { label: 'VAR',         detail: 'VAR(value)',                     doc: 'Calculates variance.',                                                        snippet: 'VAR(${1:value})' },
];

// ── Built-in Jasper system variables ─────────────────────────────────────────
const BUILTIN_VARIABLES = [
    { name: 'PAGE_NUMBER',        type: 'Integer', description: 'Current page number' },
    { name: 'PAGE_COUNT',         type: 'Integer', description: 'Total number of pages' },
    { name: 'REPORT_COUNT',       type: 'Integer', description: 'Total records processed' },
    { name: 'COLUMN_NUMBER',      type: 'Integer', description: 'Current column number' },
    { name: 'COLUMN_COUNT',       type: 'Integer', description: 'Total number of columns' },
    { name: 'PAGE_VARIABLE_COUNT',type: 'Integer', description: 'Number of variables reset per page' },
    { name: 'MASTER_CURRENT_PAGE',type: 'Integer', description: 'Current page in master report' },
    { name: 'MASTER_TOTAL_PAGES', type: 'Integer', description: 'Total pages in master report' },
];

// ── Built-in Jasper system parameters ────────────────────────────────────────
const BUILTIN_PARAMETERS = [
    { name: 'REPORT_CONNECTION',        type: 'java.sql.Connection',          description: 'JDBC database connection' },
    { name: 'REPORT_DATA_SOURCE',       type: 'JRDataSource',                 description: 'The JRDataSource object' },
    { name: 'REPORT_PARAMETERS_MAP',    type: 'java.util.Map',                description: 'Map of all report parameters' },
    { name: 'IS_IGNORE_PAGINATION',     type: 'Boolean',                      description: 'Disable pagination when true' },
    { name: 'REPORT_LOCALE',            type: 'java.util.Locale',             description: 'Report locale' },
    { name: 'REPORT_TIME_ZONE',         type: 'java.util.TimeZone',           description: 'Report time zone' },
    { name: 'REPORT_FORMAT_FACTORY',    type: 'JRFormatFactory',              description: 'Format factory for dates/numbers' },
    { name: 'REPORT_CLASS_LOADER',      type: 'ClassLoader',                  description: 'Class loader for the report' },
    { name: 'REPORT_URL_HANDLER_FACTORY',type:'java.net.URLStreamHandlerFactory', description: 'URL handler factory' },
    { name: 'REPORT_VIRTUALIZER',       type: 'JRVirtualizer',                description: 'Virtualizer for large reports' },
    { name: 'REPORT_MAX_COUNT',         type: 'Integer',                      description: 'Max number of records' },
    { name: 'REPORT_TEMPLATES',         type: 'java.util.Collection',         description: 'Additional report templates' },
];

// ── Java types ────────────────────────────────────────────────────────────────
const JAVA_TYPES = [
    { label: 'String',               snippet: 'String' },
    { label: 'Integer',              snippet: 'Integer' },
    { label: 'Long',                 snippet: 'Long' },
    { label: 'Double',               snippet: 'Double' },
    { label: 'Float',                snippet: 'Float' },
    { label: 'Boolean',              snippet: 'Boolean' },
    { label: 'BigDecimal',           snippet: 'BigDecimal' },
    { label: 'BigInteger',           snippet: 'BigInteger' },
    { label: 'Date',                 snippet: 'Date' },
    { label: 'Math.abs',             snippet: 'Math.abs(${1:value})' },
    { label: 'Math.round',           snippet: 'Math.round(${1:value})' },
    { label: 'Math.floor',           snippet: 'Math.floor(${1:value})' },
    { label: 'Math.ceil',            snippet: 'Math.ceil(${1:value})' },
    { label: 'Math.pow',             snippet: 'Math.pow(${1:base}, ${2:exp})' },
    { label: 'Math.sqrt',            snippet: 'Math.sqrt(${1:value})' },
    { label: 'Math.min',             snippet: 'Math.min(${1:a}, ${2:b})' },
    { label: 'Math.max',             snippet: 'Math.max(${1:a}, ${2:b})' },
    { label: 'String.valueOf',       snippet: 'String.valueOf(${1:value})' },
    { label: 'Integer.parseInt',     snippet: 'Integer.parseInt(${1:str})' },
    { label: 'Double.parseDouble',   snippet: 'Double.parseDouble(${1:str})' },
    { label: 'Long.parseLong',       snippet: 'Long.parseLong(${1:str})' },
    { label: 'Boolean.parseBoolean', snippet: 'Boolean.parseBoolean(${1:str})' },
];

// ── Expression tag check ──────────────────────────────────────────────────────
const OPEN_TAGS_RE  = new RegExp(`<(${EXPRESSION_TAGS.join('|')})(?:\\s[^>]*)?>`, 'g');
const CLOSE_TAGS_RE = new RegExp(`</(${EXPRESSION_TAGS.join('|')})>`, 'g');

function isInsideExpressionTag(document, position) {
    const text   = document.getText();
    const offset = document.offsetAt(position);
    OPEN_TAGS_RE.lastIndex  = 0;
    CLOSE_TAGS_RE.lastIndex = 0;

    let lastOpen = -1, m;
    while ((m = OPEN_TAGS_RE.exec(text)) !== null) {
        if (m.index + m[0].length <= offset) lastOpen = m.index + m[0].length;
    }
    if (lastOpen === -1) return false;

    let lastClose = -1;
    while ((m = CLOSE_TAGS_RE.exec(text)) !== null) {
        if (m.index < offset) lastClose = m.index;
    }
    return lastOpen > lastClose;
}

// ── Context detection: what is the user typing right now? ────────────────────
/**
 * Analyse the text before the cursor and return one of:
 *   { mode: 'field',     prefix: string }   — cursor is inside  $F{...
 *   { mode: 'param',     prefix: string }   — cursor is inside  $P{...
 *   { mode: 'variable',  prefix: string }   — cursor is inside  $V{...
 *   { mode: 'resource',  prefix: string }   — cursor is inside  $R{...
 *   { mode: 'dollar'  }                     — user just typed $
 *   { mode: 'general' }                     — anywhere else in the expression
 */
function detectContext(linePrefix) {
    // Check for open $X{ without a closing }
    const dollarBrace = linePrefix.match(/\$([FPVR])\{([^}]*)$/);
    if (dollarBrace) {
        const sigil  = dollarBrace[1];
        const prefix = dollarBrace[2];
        const modeMap = { F: 'field', P: 'param', V: 'variable', R: 'resource' };
        return { mode: modeMap[sigil], prefix };
    }

    if (linePrefix.endsWith('$')) return { mode: 'dollar' };

    return { mode: 'general' };
}

// ── Item builders ─────────────────────────────────────────────────────────────
function makeItem(label, kind, detail, doc, snippet, sortPrefix) {
    const item         = new vscode.CompletionItem(label, kind);
    item.detail        = detail || label;
    item.documentation = new vscode.MarkdownString(doc || '');
    item.insertText    = new vscode.SnippetString(snippet || label);
    if (sortPrefix) item.sortText = sortPrefix + label;
    return item;
}

/**
 * Build items for user-defined + built-in fields/params/vars.
 * When already inside $F{  we only insert the name (no $F{ prefix).
 * When at general level  we insert the full $F{name} wrapper.
 */
function makeDeclarationItems(declarations, sigil, kind, alreadyInsideBrace, sortPrefix) {
    return declarations.map(decl => {
        const label   = alreadyInsideBrace ? decl.name : `$${sigil}{${decl.name}}`;
        const snippet = alreadyInsideBrace ? decl.name : `\\$${sigil}{${decl.name}}`;
        const doc     = [
            `**${decl.type}**`,
            decl.fullType !== decl.type ? `\`${decl.fullType}\`` : '',
            decl.description ? `\n\n${decl.description}` : ''
        ].filter(Boolean).join('  \n');

        const item = makeItem(
            label, kind,
            `${decl.type}  [${sigil === 'F' ? 'Field' : sigil === 'P' ? 'Parameter' : 'Variable'}]`,
            doc,
            snippet,
            sortPrefix
        );
        // Show a checkmark icon for system/built-in entries
        if (decl.isSystem || decl.isBuiltin) {
            item.detail += ' ⚙';
        }
        return item;
    });
}

// ── Provider ──────────────────────────────────────────────────────────────────
const provider = vscode.languages.registerCompletionItemProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideCompletionItems(document, position) {
            if (!isInsideExpressionTag(document, position)) return [];

            const linePrefix = document.lineAt(position).text.slice(0, position.character);
            const ctx        = detectContext(linePrefix);

            // Parse the file to get user-defined declarations
            let decls;
            try {
                decls = parseDeclarations(document);
            } catch (_) {
                decls = { fields: [], parameters: [], variables: [], groups: [] };
            }

            const items = [];

            // ── Inside $F{ → show only fields ────────────────────────────────
            if (ctx.mode === 'field') {
                items.push(...makeDeclarationItems(
                    decls.fields, 'F',
                    vscode.CompletionItemKind.Field,
                    true, '0_'
                ));
                return items;
            }

            // ── Inside $P{ → show parameters (user + system) ─────────────────
            if (ctx.mode === 'param') {
                const allParams = [
                    ...decls.parameters,
                    ...BUILTIN_PARAMETERS.map(p => ({ ...p, isBuiltin: true }))
                ];
                items.push(...makeDeclarationItems(
                    allParams, 'P',
                    vscode.CompletionItemKind.TypeParameter,
                    true, '0_'
                ));
                return items;
            }

            // ── Inside $V{ → show variables (user + system) ───────────────────
            if (ctx.mode === 'variable') {
                const allVars = [
                    ...decls.variables,
                    ...BUILTIN_VARIABLES.map(v => ({ ...v, isBuiltin: true }))
                ];
                items.push(...makeDeclarationItems(
                    allVars, 'V',
                    vscode.CompletionItemKind.Variable,
                    true, '0_'
                ));
                return items;
            }

            // ── Just typed $ → offer $F/$P/$V shortcuts ───────────────────────
            if (ctx.mode === 'dollar') {
                const shortcuts = [
                    { label: '$F{', detail: `Field  (${decls.fields.length} defined)`,     snippet: 'F{$1}', kind: vscode.CompletionItemKind.Field },
                    { label: '$P{', detail: `Parameter  (${decls.parameters.length} defined)`, snippet: 'P{$1}', kind: vscode.CompletionItemKind.TypeParameter },
                    { label: '$V{', detail: `Variable  (${decls.variables.length} defined)`,   snippet: 'V{$1}', kind: vscode.CompletionItemKind.Variable },
                    { label: '$R{', detail: 'Resource bundle key',                          snippet: 'R{$1}', kind: vscode.CompletionItemKind.Reference },
                ];
                for (const s of shortcuts) {
                    items.push(makeItem(s.label, s.kind, s.detail, '', s.snippet, '0_'));
                }
                return items;
            }

            // ── General context → show everything ────────────────────────────
            // 1. User fields   $F{name}
            items.push(...makeDeclarationItems(
                decls.fields, 'F',
                vscode.CompletionItemKind.Field,
                false, '1_F_'
            ));

            // 2. User parameters  $P{name}
            items.push(...makeDeclarationItems(
                decls.parameters.filter(p => !p.isSystem), 'P',
                vscode.CompletionItemKind.TypeParameter,
                false, '1_P_'
            ));

            // 3. User variables  $V{name}
            items.push(...makeDeclarationItems(
                decls.variables, 'V',
                vscode.CompletionItemKind.Variable,
                false, '1_V_'
            ));

            // 4. Jasper built-in functions
            for (const fn of JASPER_FUNCTIONS) {
                items.push(makeItem(
                    fn.label,
                    vscode.CompletionItemKind.Function,
                    fn.detail,
                    `**JasperReports built-in**\n\n${fn.doc}`,
                    fn.snippet,
                    '2_'
                ));
            }

            // 5. Java types/statics
            for (const t of JAVA_TYPES) {
                items.push(makeItem(
                    t.label,
                    vscode.CompletionItemKind.Class,
                    t.label, '',
                    t.snippet,
                    '3_'
                ));
            }

            return items;
        }
    },
    '$', '{', ' ', '.', '('
);

module.exports = { provider };
