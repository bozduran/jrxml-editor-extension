// xmlClear.ts
// The hook's `clear` step: SQL->jsonql query migration, unused-declaration
// deletion, description<->jsonql synchronization, and jsonql property
// rename/removal/addition.
//
// Pure and vscode-free. Each fix kind is its own group, in the hook's order:
//   query migration, unused declarations, description sync, jsonql fixes.
//
// Unused detection mirrors the hook's ground truth as closely as a text tool
// can: references are collected from expression-bearing elements (plus
// <query>, sort fields and subreport pass-throughs), never by scanning the
// whole document, and the hook's built-in parameter names are never deleted.
// Only direct children of the report root are declarations, so dataset members
// and subreport/scoped parameters are neither reported nor deleted here.

import { scanXml } from './xmlspan';
import type { XmlScanResult } from './xmlspan';
import {
    cdataOf,
    decodeXml,
    encodeXml,
    encodeAttribute,
} from './xmlRules';
import type { Edit, Span } from './edits';
import {
    clearDeclarations,
    usageNames,
    JSONQL_FIELD_PROPERTY,
    JSON_FIELD_PROPERTY,
} from './reportIndex';
import type { ClearDeclaration } from './reportIndex';

export type { ClearDeclaration, ClearDeclarationKind } from './reportIndex';

/** Built-in parameters the hook never deletes. */
const BUILTIN_PARAMETERS: ReadonlySet<string> = new Set([
    'REPORT_PARAMETERS_MAP', 'REPORT_DATA_SOURCE', 'REPORT_CONNECTION',
    'JASPER_REPORT', 'JASPER_REPORT_PARAMETERS_MAP', 'REPORT_CONTEXT',
    'REPORT_CLASS_LOADER', 'REPORT_VIRTUALIZER', 'REPORT_FORMAT_FACTORY',
    'REPORT_MAX_COUNT', 'REPORT_SCRIPTLET', 'REPORT_LOCALE',
    'REPORT_RESOURCE_BUNDLE', 'REPORT_TIME_ZONE', 'REPORT_TEMPLATES',
    'IS_IGNORE_PAGINATION', 'SORT_FIELDS', 'FILTER', 'REPORT_FILE_RESOLVER',
    'REPORT_URL_HANDLER_FACTORY', 'JSON_INPUT_STREAM', 'JSON_SOURCE',
    'JSON_LOCALE', 'JSON_TIME_ZONE', 'JSON_DATE_PATTERN', 'JSON_NUMBER_PATTERN',
]);

/** The report's top-level `<query>` and the spans a migration rewrites. */
export interface ClearQuery {
    language: string;
    langValueStart: number;
    langValueEnd: number;
    bodyStart: number;
    bodyEnd: number;
    start: number;
    end: number;
}

/** A query-migration fix carries the query instead of an edit. */
export interface ClearFix {
    description: string;
    kind?: 'queryMigration';
    query?: ClearQuery;
    edit?: Edit;
}

export interface ClearFixGroup {
    label: string;
    fixes: ClearFix[];
}

// ── Reference / declaration views (owned by reportIndex) ────────────────────

/**
 * Names used anywhere an expression can appear, keyed as `KIND:name`.
 * Returns null when the document cannot be scanned, so callers can tell
 * "nothing is used" apart from "usage could not be determined" and avoid
 * flagging every declaration as unused.
 */
function collectUsedNames(text: string, providedScan: XmlScanResult | null = null): Set<string> | null {
    const scan = providedScan || scanXml(text);
    return usageNames(scan);
}

/** Report-root declarations in the clear step's model. */
function parseDeclarations(text: string): ClearDeclaration[] {
    return clearDeclarations(text);
}

function parseQuery(text: string): ClearQuery | null {
    const scan = scanXml(text);
    if (scan.error || !scan.doc) return null;

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

function lineStartOf(text: string, offset: number): number {
    let i = offset;
    while (i > 0 && text[i - 1] !== '\n') i--;
    return Math.max(0, i);
}

/**
 * Line-aware removal span: when the element is alone on its line, its
 * indentation and the whole line terminator (CRLF included) go with it;
 * otherwise only the element itself, so neighbours and explanations survive.
 */
function removalSpan(text: string, start: number, end: number): Span {
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

function jsonqlPropertyLine(decl: ClearDeclaration): string {
    return `${decl.descriptionIndent}<property name="${JSONQL_FIELD_PROPERTY}" value="${encodeAttribute(decl.descriptionText)}"/>`;
}

function discoverClearFixes(text: string): ClearFixGroup[] {
    const scan = scanXml(text);
    if (scan.error) return [];

    const groups: ClearFixGroup[] = [];
    const declarations = clearDeclarations(text, scan);
    const used = usageNames(scan);
    // `used === null` means the document could not be scanned; the top-of-
    // function `scan.error` check already covered that, but stay defensive so
    // a future change can never turn "unknown" into "delete everything".
    const unusedFieldNames = new Set<string>();

    // 1. SQL query migration (the edit depends on a free-form answer)
    const query = parseQuery(text);
    if (query && query.language.toLowerCase() === 'sql') {
        groups.push({
            label: 'query migration',
            fixes: [{ description: 'migrate SQL query to jsonql', kind: 'queryMigration', query }],
        });
    }

    // 2. Unused declarations
    const unusedFixes: ClearFix[] = [];
    if (used) {
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
    }
    if (unusedFixes.length) groups.push({ label: 'unused declarations', fixes: unusedFixes });

    // 3. Description <-> jsonql synchronization
    const syncFixes: ClearFix[] = [];
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
    const jsonqlFixes: ClearFix[] = [];
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
 * Edits for a query-migration fix once the user supplies the expression.
 * An empty answer applies nothing; the target language defaults to jsonql.
 */
function queryMigrationEdits(
    query: ClearQuery | null | undefined,
    expression: string,
    targetLanguage = 'jsonql'
): Edit[] {
    if (!query || !expression) return [];

    const edits: Edit[] = [];
    if (query.langValueStart >= 0 && query.langValueEnd > query.langValueStart) {
        edits.push({ start: query.langValueStart, end: query.langValueEnd, replacement: targetLanguage });
    }
    // bodyStart === bodyEnd is a valid (empty) CDATA body: insert, don't replace.
    if (query.bodyStart >= 0) {
        edits.push({ start: query.bodyStart, end: query.bodyEnd, replacement: expression });
    }
    return edits;
}

export {
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
