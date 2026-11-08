// expressionSuggestions.js
// Pure suggestion engine shared by the JRXML completion provider and the
// design-view inspector. It turns an expression + caret into plain suggestion
// records; the editor maps them to CompletionItems and the webview renders them.
//
// Records contain both the VS Code snippet (insertTextSnippet) and a plain-text
// insertion (insertTextPlain) with an optional first-placeholder range, so a
// textarea can offer the same suggestions without a snippet engine.

const { resolveReceiver } = require('./memberResolver');
const { getMembers } = require('./jdkMemberIndex');
const { buildMemberCandidates, buildTypeHint, documentationFor } = require('./typeCompletion');
const { BUILTIN_VARIABLES, BUILTIN_PARAMETERS } = require('./jasperBuiltins');

const MEMBER_WINDOW = 4000;
const MEMBER_RE = /\.\s*([A-Za-z_$][\w$]*)?$/;

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

/**
 * Read the completion options shared by the editor provider and the design
 * inspector from a WorkspaceConfiguration-like object.
 *
 * @param {{get:(key:string, fallback:any)=>any}} config
 * @returns {{typedCompletion:boolean, jdkBaseline:(string|number)}}
 */
function suggestionOptions(config) {
    return {
        typedCompletion: config.get('typeCompletion.enabled', true),
        jdkBaseline:    config.get('typeCompletion.jdkBaseline', '8'),
    };
}

/**
 * @param {object} opts
 * @param {string} opts.text full expression text
 * @param {number} opts.offset caret offset
 * @param {object} [opts.declarations] parseDeclarations result
 * @param {{typedCompletion?:boolean,jdkBaseline?:number}} [opts.options]
 * @param {Array} [opts.customMethods]
 * @returns {{mode:string,prefix:string,replace:{start:number,end:number},items:Array}}
 */
function buildExpressionSuggestions({ text, offset, declarations, options = {}, customMethods = [] }) {
    const expression = typeof text === 'string' ? text : '';
    const caret = Math.max(0, Math.min(Number.isInteger(offset) ? offset : expression.length, expression.length));
    const before = expression.slice(0, caret);
    const linePrefix = before.slice(before.lastIndexOf('\n') + 1);
    const decls = normalizeDeclarations(declarations);
    const typed = options.typedCompletion !== false;
    const baseline = normalizeBaseline(options.jdkBaseline);
    const custom = Array.isArray(customMethods) ? customMethods : [];

    if (typed) {
        const member = detectMemberContext(expression, caret);
        if (member) {
            const items = provideMemberItems(member, decls, baseline);
            if (items) {
                return {
                    mode:    'member',
                    prefix:  member.partial,
                    replace: { start: caret - member.partial.length, end: caret },
                    items,
                };
            }
        }
    }

    const brace = /\$([FPVR])\{([^}]*)$/.exec(linePrefix);
    if (brace) {
        const sigil  = brace[1];
        const prefix = brace[2];

        if (sigil === 'R') {
            // No resource bundle index exists; mirror the editor's general fallback.
            return generalResult(linePrefix, caret, decls, custom);
        }

        const items = braceItems(decls, sigil);
        if (!expression.slice(caret).includes('}')) {
            // The user is typing inside an unclosed $X{...}; complete the brace.
            for (const item of items) {
                item.insertTextPlain += '}';
                const caretPosition = item.insertTextPlain.length - 1;
                item.placeholder = { start: caretPosition, end: caretPosition };
            }
        }
        return {
            mode:    sigil === 'F' ? 'field' : sigil === 'P' ? 'param' : 'variable',
            prefix,
            replace: { start: caret - prefix.length, end: caret },
            items,
        };
    }

    if (linePrefix.endsWith('$')) {
        return {
            mode:    'dollar',
            prefix:  '',
            replace: { start: Math.max(0, caret - 1), end: caret },
            items:   shortcutItems(),
        };
    }

    return generalResult(linePrefix, caret, decls, custom);
}

// ── Contexts ────────────────────────────────────────────────────────────────

function detectMemberContext(expression, offset) {
    const text = expression.slice(Math.max(0, offset - MEMBER_WINDOW), offset);
    const match = MEMBER_RE.exec(text);
    if (!match) return null;

    const before = text[match.index - 1];
    if (before === undefined || before === '.' || /[0-9]/.test(before)) return null;

    return {
        textBeforeDot: text.slice(0, match.index),
        partial:       match[1] || '',
    };
}

function generalResult(linePrefix, caret, decls, customMethods) {
    const word = /[A-Za-z0-9_$]*$/.exec(linePrefix);
    const prefix = word ? word[0] : '';

    return {
        mode:    'general',
        prefix,
        replace: { start: caret - prefix.length, end: caret },
        items:   generalItems(decls, customMethods),
    };
}

// ── Suggestion builders ─────────────────────────────────────────────────────

function braceItems(decls, sigil) {
    const mode = sigil === 'F' ? 'field' : sigil === 'P' ? 'param' : 'variable';
    const kind = mode === 'field' ? 'field' : mode === 'param' ? 'parameter' : 'variable';

    if (sigil === 'F') {
        return decls.allFields.map(decl => declarationSuggestion(decl, sigil, true, kind, '0_'));
    }
    if (sigil === 'P') {
        return [...decls.allParameters, ...BUILTIN_PARAMETERS.map(p => ({ ...p, isBuiltin: true }))]
            .map(decl => declarationSuggestion(decl, sigil, true, kind, '0_'));
    }
    if (sigil === 'V') {
        return [...decls.allVariables, ...BUILTIN_VARIABLES.map(v => ({ ...v, isBuiltin: true }))]
            .map(decl => declarationSuggestion(decl, sigil, true, kind, '0_'));
    }
    return [];
}

function shortcutItems() {
    return [
        shortcut('$F{', 'Field', 'field'),
        shortcut('$P{', 'Parameter', 'parameter'),
        shortcut('$V{', 'Variable', 'variable'),
        shortcut('$R{', 'Resource bundle key', 'reference'),
    ];
}

function shortcut(label, detailText, kind) {
    const sigil = label[1];
    const plain = `$${sigil}{}`;
    return withPlain({
        label,
        detail:            `${detailText}  (choose a ${sigil === 'R' ? 'key' : detailText.toLowerCase()})`,
        documentation:     '',
        insertTextSnippet: `${sigil}{$1}`,
        kind,
        sortText:          '0_' + label,
    }, plain, { start: 3, end: 3 });
}

function declarationSuggestion(decl, sigil, alreadyInsideBrace, kind, sortPrefix) {
    const label   = alreadyInsideBrace ? decl.name : `$${sigil}{${decl.name}}`;
    const plain   = alreadyInsideBrace ? decl.name : `$${sigil}{${decl.name}}`;
    const snippet = alreadyInsideBrace ? decl.name : `\\$${sigil}{${decl.name}}`;
    const kindName = sigil === 'F' ? 'Field' : sigil === 'P' ? 'Parameter' : 'Variable';
    const doc = [
        `**${decl.type}**`,
        decl.fullType && decl.fullType !== decl.type ? `\`${decl.fullType}\`` : '',
        decl.description ? `\n\n${decl.description}` : '',
    ].filter(Boolean).join('  \n');

    let detail = `${decl.type}  [${kindName}]`;
    if (decl.isSystem || decl.isBuiltin) detail += ' ⚙';

    return withPlain({
        label,
        detail,
        documentation:     doc,
        insertTextSnippet: snippet,
        kind,
        sortText:          sortPrefix + label,
    }, plain);
}

/**
 * Push snippet-backed suggestions, parsing each snippet once.
 * `describe(entry)` supplies the category-specific detail/documentation.
 */
function pushSnippetSuggestions(target, entries, kind, sortPrefix, describe) {
    for (const entry of entries) {
        const plain = plainFromSnippet(entry.snippet);
        const meta  = describe(entry);
        target.push(withPlain({
            label:             entry.label,
            detail:            meta.detail,
            documentation:     meta.documentation,
            insertTextSnippet: entry.snippet,
            kind,
            sortText:          sortPrefix + entry.label,
        }, plain.text, plain.placeholder));
    }
}

function generalItems(decls, customMethods) {
    const items = [];

    for (const decl of decls.allFields) {
        items.push(declarationSuggestion(decl, 'F', false, 'field', '1_F_'));
    }
    for (const decl of decls.allParameters.filter(param => !param.isSystem)) {
        items.push(declarationSuggestion(decl, 'P', false, 'parameter', '1_P_'));
    }
    for (const decl of decls.allVariables) {
        items.push(declarationSuggestion(decl, 'V', false, 'variable', '1_V_'));
    }

    pushSnippetSuggestions(items, JASPER_FUNCTIONS, 'function', '2_', fn => ({
        detail:        fn.detail,
        documentation: `**JasperReports built-in**\n\n${fn.doc}`,
    }));
    pushSnippetSuggestions(items, JAVA_TYPES, 'class', '3_', type => ({
        detail:        type.label,
        documentation: '',
    }));
    pushSnippetSuggestions(items, customMethods, 'method', '4_', method => ({
        detail:        method.detail,
        documentation: method.doc,
    }));

    return items;
}

// ── Typed members ───────────────────────────────────────────────────────────

function memberDeclarations(decls) {
    return {
        fields:     decls.allFields,
        parameters: [...decls.allParameters, ...BUILTIN_PARAMETERS.map(p => ({ ...p, isBuiltin: true }))],
        variables:  [...decls.allVariables, ...BUILTIN_VARIABLES.map(v => ({ ...v, isBuiltin: true }))],
    };
}

function provideMemberItems(context, decls, baseline) {
    const lookup = typeKey => getMembers(typeKey, { baseline });
    const resolution = resolveReceiver(context.textBeforeDot, {
        declarations: memberDeclarations(decls),
        lookup,
    });

    if (resolution.resolved) {
        const members = lookup(resolution.typeKey);
        if (members.resolved) {
            const candidates = buildMemberCandidates(members);
            if (candidates.length > 0) {
                return candidates.map(candidate => {
                    const plain = plainFromSnippet(candidate.insertText);
                    return withPlain({
                        label:            candidate.label,
                        labelDetail:      candidate.labelDetail,
                        labelDescription: candidate.labelDescription,
                        filterText:       candidate.filterText,
                        detail:           candidate.detail,
                        documentation:    documentationFor(candidate, resolution.typeKey),
                        insertTextSnippet: candidate.insertText,
                        kind:             candidate.kind === 'field' ? 'field' : 'method',
                        sortText:         `${candidate.tier}_${String(candidate.rank).padStart(3, '0')}_${candidate.name}_${candidate.arity}`,
                        deprecated:       !!candidate.deprecated,
                    }, plain.text, plain.placeholder);
                });
            }
        }
    }

    const hint = buildTypeHint(resolution);
    if (!hint) return null;

    return [withPlain({
        label:             hint.label,
        filterText:        hint.label,
        detail:            hint.detail,
        documentation:     hint.documentation,
        insertTextSnippet: hint.insertText,
        kind:              'text',
        sortText:          '0000_type-hint',
    }, '', { start: 0, end: 0 })];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeDeclarations(declarations) {
    const source = declarations || {};
    return {
        allFields:     source.allFields || source.fields || [],
        allParameters: source.allParameters || source.parameters || [],
        allVariables:  source.allVariables || source.variables || [],
    };
}

function normalizeBaseline(value) {
    const number = parseInt(String(value), 10);
    return Number.isFinite(number) && number > 0 ? number : 8;
}

function withPlain(suggestion, plain, placeholder) {
    const converted = plain === undefined ? plainFromSnippet(suggestion.insertTextSnippet) : { text: plain, placeholder };
    suggestion.insertTextPlain = converted.text;
    suggestion.placeholder = converted.placeholder || null;
    return suggestion;
}

/**
 * Convert a VS Code snippet string to plain text plus the first placeholder range.
 * Handles `\$`, `${n:label}`, `${n}` and `$n`.
 */
function plainFromSnippet(snippet) {
    const source = String(snippet ?? '');
    let text = '';
    let placeholder = null;
    let i = 0;

    while (i < source.length) {
        if (source[i] === '\\' && source[i + 1] === '$') {
            text += '$';
            i += 2;
            continue;
        }

        if (source[i] === '$' && source[i + 1] === '{') {
            const end = source.indexOf('}', i + 2);
            if (end !== -1) {
                const inner = source.slice(i + 2, end);
                const colon = inner.indexOf(':');
                const label = colon === -1 ? '' : inner.slice(colon + 1);
                if (!placeholder) placeholder = { start: text.length, end: text.length + label.length };
                text += label;
                i = end + 1;
                continue;
            }
        }

        if (source[i] === '$' && /[0-9]/.test(source[i + 1] || '')) {
            if (!placeholder) placeholder = { start: text.length, end: text.length };
            i += 2;
            continue;
        }

        text += source[i];
        i++;
    }

    return { text, placeholder };
}

module.exports = {
    buildExpressionSuggestions,
    suggestionOptions,
    plainFromSnippet,
};
