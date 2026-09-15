// xmlClear.js
// The hook's `clear` step: SQL->jsonql query migration, unused-declaration
// deletion, description<->jsonql synchronization, and jsonql property
// rename/removal/addition.
//
// Pure and vscode-free. Each fix kind is its own group, in the hook's order:
//   query migration, unused declarations, description sync, jsonql fixes.
//
// Unused detection mirrors the hook's ground truth as closely as a text tool
// can: references are collected from expression elements (plus <query> and
// subreport pass-throughs), never by scanning the whole document, and the
// hook's built-in parameter names are never deleted.

const { scanXml } = require('./xmlspan');
const {
    cdataOf,
    decodeXml,
    encodeXml,
    encodeAttribute,
    EXPRESSION_ELEMENTS,
} = require('./xmlRules');

const JSONQL_FIELD_PROPERTY = 'net.sf.jasperreports.jsonql.field.expression';
const JSON_FIELD_PROPERTY   = 'net.sf.jasperreports.json.field.expression';

/** Built-in parameters the hook never deletes. */
const BUILTIN_PARAMETERS = new Set([
    'REPORT_PARAMETERS_MAP', 'REPORT_DATA_SOURCE', 'REPORT_CONNECTION',
    'JASPER_REPORT', 'JASPER_REPORT_PARAMETERS_MAP', 'REPORT_CONTEXT',
    'REPORT_CLASS_LOADER', 'REPORT_VIRTUALIZER', 'REPORT_FORMAT_FACTORY',
    'REPORT_MAX_COUNT', 'REPORT_SCRIPTLET', 'REPORT_LOCALE',
    'REPORT_RESOURCE_BUNDLE', 'REPORT_TIME_ZONE', 'REPORT_TEMPLATES',
    'IS_IGNORE_PAGINATION', 'SORT_FIELDS', 'FILTER', 'REPORT_FILE_RESOLVER',
    'REPORT_URL_HANDLER_FACTORY', 'JSON_INPUT_STREAM', 'JSON_SOURCE',
    'JSON_LOCALE', 'JSON_TIME_ZONE', 'JSON_DATE_PATTERN', 'JSON_NUMBER_PATTERN',
]);

const REFERENCE_CONTAINERS = new Set([...EXPRESSION_ELEMENTS, 'query']);
const REFERENCE_RE = /\$(F|P|V)!?\{([^}]*)\}/g;
const KIND_BY_SIGIL = { F: 'FIELD', P: 'PARAMETER', V: 'VARIABLE' };

// ── Reference collection (ground-truth style) ─────────────────────────────────

/**
 * Names used anywhere an expression can appear, keyed as `KIND:name`.
 * @returns {Set<string>}
 */
function collectUsedNames(text) {
    const used = new Set();
    const scan = scanXml(text);
    if (scan.error) return used;

    const root = scan.doc.root;

    for (const node of scan.doc.walk()) {
        if (REFERENCE_CONTAINERS.has(node.tag)) {
            addReferences(node.textContent(), used);
        } else if (node.tag === 'subreportParameter') {
            addName('PARAMETER', node.attrValue('name'), used);
        } else if (node.tag === 'returnValue') {
            addName('VARIABLE', node.attrValue('toVariable'), used);
        } else if (node.tag === 'parameter' && node.parent !== root) {
            // A parameter nested in a subreport is passed in, not declared here.
            addName('PARAMETER', node.attrValue('name'), used);
        }
    }

    return used;
}

function addReferences(body, used) {
    REFERENCE_RE.lastIndex = 0;
    let match;
    while ((match = REFERENCE_RE.exec(body)) !== null) {
        addName(KIND_BY_SIGIL[match[1]], match[2], used);
    }
}

function addName(kind, rawName, used) {
    const name = decodeXml(rawName || '').trim();
    if (name) used.add(kind + ':' + name);
}

// ── Declaration model ─────────────────────────────────────────────────────────

function lineStartOf(text, offset) {
    let i = offset;
    while (i > 0 && text[i - 1] !== '\n') i--;
    return Math.max(0, i);
}

function descriptionTextSpan(description, text) {
    const cdata = cdataOf(description, text);
    if (cdata) return cdata;

    const start = description.startTagEnd;
    const end   = description.endTag >= 0 ? description.endTag : description.end;
    return { start, end, content: decodeXml(text.slice(start, end).trim()) };
}

function parseDeclarations(text) {
    const scan = scanXml(text);
    if (scan.error) return [];

    const declarations = [];
    for (const child of scan.doc.root.children) {
        if (child.tag !== 'parameter' && child.tag !== 'field' && child.tag !== 'variable') continue;

        const decl = {
            kind:              child.tag.toUpperCase(),
            name:              decodeXml(child.attrValue('name') || ''),
            start:             child.startTag,
            end:               child.end,
            endTag:            child.endTag,
            hasDescription:    false,
            descriptionText:   '',
            descriptionStart:  -1,
            descriptionEnd:    -1,
            descriptionIndent: '',
            descriptionCdata:  false,
            hasJsonql:         false,
            jsonqlValue:       '',
            hasLegacy:         false,
            legacyStart:       -1,
            legacyEnd:         -1,
            legacyNameStart:   -1,
            legacyNameEnd:     -1,
        };

        if (decl.kind === 'FIELD') {
            for (const node of child.children) {
                if (node.tag === 'description') {
                    decl.hasDescription = true;
                    decl.descriptionCdata = cdataOf(node, text) !== null;

                    const span = descriptionTextSpan(node, text);
                    decl.descriptionText   = span.content.trim();
                    decl.descriptionStart  = span.start;
                    decl.descriptionEnd    = span.end;
                    decl.descriptionIndent = text.slice(lineStartOf(text, node.startTag), node.startTag);
                } else if (node.tag === 'property') {
                    const propertyName = decodeXml(node.attrValue('name') || '');
                    if (propertyName === JSONQL_FIELD_PROPERTY) {
                        decl.hasJsonql  = true;
                        decl.jsonqlValue = decodeXml(node.attrValue('value') || '').trim();
                    } else if (propertyName === JSON_FIELD_PROPERTY) {
                        decl.hasLegacy    = true;
                        decl.legacyStart  = node.startTag;
                        decl.legacyEnd    = node.end;
                        const nameAttr    = node.attr('name');
                        if (nameAttr) {
                            decl.legacyNameStart = nameAttr.valueStart;
                            decl.legacyNameEnd   = nameAttr.valueEnd;
                        }
                    }
                } else if (node.tag === 'propertyExpression') {
                    if (decodeXml(node.attrValue('name') || '') === JSONQL_FIELD_PROPERTY) {
                        decl.hasJsonql = true; // value is not used for syncing
                    }
                }
            }
        }

        declarations.push(decl);
    }
    return declarations;
}

function parseQuery(text) {
    const scan = scanXml(text);
    if (scan.error) return null;

    for (const child of scan.doc.root.children) {
        if (child.tag !== 'query') continue;

        const language = child.attr('language');
        const body     = cdataOf(child, text);
        return {
            language:       decodeXml(child.attrValue('language') || ''),
            langValueStart: language ? language.valueStart : -1,
            langValueEnd:   language ? language.valueEnd : -1,
            bodyStart:      body ? body.start : -1,
            bodyEnd:        body ? body.end : -1,
            start:          child.startTag,
            end:            child.end,
        };
    }
    return null;
}

// ── Removals ──────────────────────────────────────────────────────────────────

/**
 * Line-aware removal span: when the element is alone on its line, its
 * indentation and the whole line terminator (CRLF included) go with it;
 * otherwise only the element itself, so neighbours and explanations survive.
 */
function removalSpan(text, start, end) {
    const lineStart = lineStartOf(text, start);
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n' && text[lineEnd] !== '\r') lineEnd++;

    const alone = text.slice(lineStart, start).trim() === ''
        && text.slice(end, lineEnd).trim() === '';
    if (!alone) return { start, end };

    let to = lineEnd;
    if (to < text.length && text[to] === '\r') to++;
    if (to < text.length && text[to] === '\n') to++;
    return { start: lineStart, end: to };
}

// ── Discovery ─────────────────────────────────────────────────────────────────

function jsonqlPropertyLine(decl) {
    return `${decl.descriptionIndent}<property name="${JSONQL_FIELD_PROPERTY}" value="${encodeAttribute(decl.descriptionText)}"/>`;
}

/**
 * @returns {{ label:string, fixes:object[] }[]}
 */
function discoverClearFixes(text) {
    const scan = scanXml(text);
    if (scan.error) return [];

    const groups = [];
    const declarations = parseDeclarations(text);
    const used = collectUsedNames(text);

    // 1. SQL query migration (the edit depends on a free-form answer)
    const query = parseQuery(text);
    if (query && query.language.toLowerCase() === 'sql') {
        groups.push({
            label: 'query migration',
            fixes: [{ description: 'migrate SQL query to jsonql', kind: 'queryMigration', query }],
        });
    }

    // 2. Unused declarations
    const unusedFieldNames = new Set();
    const unusedFixes = [];
    for (const decl of declarations) {
        if (decl.kind === 'PARAMETER' && BUILTIN_PARAMETERS.has(decl.name)) continue;
        if (used.has(`${decl.kind}:${decl.name}`)) continue;

        if (decl.kind === 'FIELD') unusedFieldNames.add(decl.name);
        const span = removalSpan(text, decl.start, decl.end);
        unusedFixes.push({
            description: `delete unused ${decl.kind.toLowerCase()} '${decl.name}'`,
            edit: { start: span.start, end: span.end, replacement: '' },
        });
    }
    if (unusedFixes.length) groups.push({ label: 'unused declarations', fixes: unusedFixes });

    // 3. Description <-> jsonql synchronization
    const syncFixes = [];
    for (const decl of declarations) {
        if (decl.kind !== 'FIELD' || !decl.hasDescription || !decl.hasJsonql) continue;
        if (unusedFieldNames.has(decl.name)) continue;
        if (decl.jsonqlValue === '' || decl.jsonqlValue === decl.descriptionText) continue;

        syncFixes.push({
            description: `change description for field '${decl.name}' from "${decl.descriptionText}" to "${decl.jsonqlValue}"`,
            edit: {
                start: decl.descriptionStart,
                end:   decl.descriptionEnd,
                replacement: decl.descriptionCdata ? decl.jsonqlValue : encodeXml(decl.jsonqlValue),
            },
        });
    }
    if (syncFixes.length) groups.push({ label: 'description sync', fixes: syncFixes });

    // 4. jsonql property rename / removal / addition
    const jsonqlFixes = [];
    for (const decl of declarations) {
        if (decl.kind !== 'FIELD' || unusedFieldNames.has(decl.name)) continue;

        if (decl.hasLegacy) {
            if (decl.hasJsonql) {
                const span = removalSpan(text, decl.legacyStart, decl.legacyEnd);
                jsonqlFixes.push({
                    description: `remove legacy ${JSON_FIELD_PROPERTY} from field '${decl.name}'`,
                    edit: { start: span.start, end: span.end, replacement: '' },
                });
            } else {
                jsonqlFixes.push({
                    description: `rename ${JSON_FIELD_PROPERTY} to ${JSONQL_FIELD_PROPERTY}`,
                    edit: { start: decl.legacyNameStart, end: decl.legacyNameEnd, replacement: JSONQL_FIELD_PROPERTY },
                });
            }
        } else if (!decl.hasJsonql && decl.hasDescription && decl.descriptionText.trim() !== '') {
            const insertAt = lineStartOf(text, decl.endTag);
            jsonqlFixes.push({
                description: `add ${JSONQL_FIELD_PROPERTY} = "${decl.descriptionText}"`,
                edit: { start: insertAt, end: insertAt, replacement: jsonqlPropertyLine(decl) + '\n' },
            });
        }
    }
    if (jsonqlFixes.length) groups.push({ label: 'jsonql fixes', fixes: jsonqlFixes });

    return groups;
}

/**
 * Edits for a query-migration fix once the user supplies the jsonql expression.
 * An empty answer applies nothing.
 */
function queryMigrationEdits(query, expression) {
    if (!query || !expression) return [];

    const edits = [];
    if (query.langValueStart >= 0 && query.langValueEnd > query.langValueStart) {
        edits.push({ start: query.langValueStart, end: query.langValueEnd, replacement: 'jsonql' });
    }
    // bodyStart === bodyEnd is a valid (empty) CDATA body: insert, don't replace.
    if (query.bodyStart >= 0) {
        edits.push({ start: query.bodyStart, end: query.bodyEnd, replacement: expression });
    }
    return edits;
}

module.exports = {
    discoverClearFixes,
    queryMigrationEdits,
    collectUsedNames,
    parseDeclarations,
    parseQuery,
    removalSpan,
    jsonqlPropertyLine,
    BUILTIN_PARAMETERS,
    JSONQL_FIELD_PROPERTY,
    JSON_FIELD_PROPERTY,
};
