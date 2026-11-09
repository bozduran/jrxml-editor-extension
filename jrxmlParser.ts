// jrxmlParser.ts
// Parses a .jrxml document and extracts declarations, references, and structure.
// Results are cached per document version.

import { scanXml } from './xmlspan';
import type { XmlNode, XmlScanResult } from './xmlspan';
import { EXPRESSION_TAGS, hasRole } from './expressionTags';
import { forEachReferenceToken, referenceTokens } from './referenceTokens';
import type { ReferenceSigil } from './referenceTokens';
import { languageOfScan } from './reportLanguage';
import type { ReportLanguage } from './reportLanguage';
import { REPORT_SECTIONS } from './jrxmlSections';
import { bundleAttributeOfScan } from './resourceBundle';
import type { BundleAttribute } from './resourceBundle';
import { documentSource } from './reportSource';
import type { ReportSource, TextDocumentLike } from './reportSource';

/** One report, dataset or group-level declaration. */
export interface Declaration {
    name: string;
    type: string;
    fullType: string;
    typeSource?: 'declared' | 'inferred';
    description: string;
    offset: number;
    end: number;
    nameOffset: number;
    isSystem?: boolean;
}

/** A `$F`/`$P`/`$V` usage. Attribute-form references carry no `end`. */
export interface Reference {
    sigil: ReferenceSigil;
    name: string;
    offset: number;
    end?: number;
    fromSubreport?: boolean;
    bang?: boolean;
    /**
     * How this reference is written: a `$X{}` token, a navigable name
     * attribute (`sortField`), or a usage-only name attribute
     * (`subreportParameter`, `returnValue`, a nested subreport parameter).
     */
    role?: 'token' | 'attribute' | 'usage';
}

/** A `$R{key}` usage inside an expression-bearing element. */
export interface ResourceReference {
    name: string;
    offset: number;
    end: number;
}

/** One node of the report outline tree. */
export interface OutlineEntry {
    kind: string;
    name: string;
    offset: number;
    end: number;
    children: OutlineEntry[];
}

/** One `<dataset>`/`<subDataset>` with its own declarations. */
export interface DatasetDeclaration {
    name: string;
    nameOffset: number;
    offset: number;
    end: number;
    fields: Declaration[];
    parameters: Declaration[];
    variables: Declaration[];
}

/** A span in which a dataset owns the visible declarations. */
export interface ScopeRange {
    datasetName: string;
    start: number;
    end: number;
}

export type ScopeKind = 'report' | 'dataset' | 'unknown';

/** The declarations visible at one offset. */
export interface DeclarationScope {
    kind: ScopeKind;
    dataset: DatasetDeclaration | null;
    datasetName: string | null;
    fields: Declaration[];
    parameters: Declaration[];
    variables: Declaration[];
    allFields: Declaration[];
    allParameters: Declaration[];
    allVariables: Declaration[];
}

export type Scope = DeclarationScope;

/** A declaration that repeats an earlier name within the same scope. */
export interface DuplicateName {
    kind: string;
    name: string;
    scope: string;
    offset: number;
    length: number;
}

/** Everything one parse pass extracts from a report source. */
export interface ParseResult {
    fields: Declaration[];
    parameters: Declaration[];
    variables: Declaration[];
    dataset: {
        fields: Declaration[];
        parameters: Declaration[];
        variables: Declaration[];
    };
    language: ReportLanguage;
    resourceBundle: BundleAttribute | null;
    datasets: DatasetDeclaration[];
    scopeRanges: ScopeRange[];
    allFields: Declaration[];
    allParameters: Declaration[];
    allVariables: Declaration[];
    groups: Declaration[];
    styles: Declaration[];
    references: Reference[];
    resourceReferences: ResourceReference[];
    outline: OutlineEntry[];
}

type DeclarationTag = 'field' | 'parameter' | 'variable';

interface DeclarationSets {
    field: Set<number>;
    parameter: Set<number>;
    variable: Set<number>;
}

interface DatasetClassification {
    name: string;
    nameOffset: number;
    offset: number;
    end: number;
    sets: DeclarationSets;
}

interface ScopeClassification {
    report: DeclarationSets;
    dataset: DeclarationSets;
    datasets: DatasetClassification[];
}

/** A minimal span shape shared by declarations and datasets. */
interface NameSpan {
    name: string;
    nameOffset: number;
}

interface CacheEntry {
    version: number | undefined;
    result: ParseResult;
}

const cache = new Map<string, CacheEntry>();

const COMMON_TYPES = new Set([
    'String','Integer','Long','Double','Float','Boolean','Byte','Short','Character',
    'BigDecimal','BigInteger','Date','Object','Number','List','Map','Collection',
]);

// ── Entry point ───────────────────────────────────────────────────────────────

function parseDeclarations(
    document: TextDocumentLike,
    providedScan: XmlScanResult | null = null
): ParseResult {
    return parseReport(documentSource(document), providedScan);
}

/**
 * Parse a report source (text + identity + version). This is the headless
 * entry point; parseDeclarations is the VS Code document adapter.
 */
function parseReport(
    source: ReportSource | null | undefined,
    providedScan: XmlScanResult | null = null
): ParseResult {
    const id      = source && source.id != null ? String(source.id) : null;
    const version = source ? source.version : undefined;
    const cached  = id !== null ? cache.get(id) : null;
    if (cached && cached.version === version) return cached.result;

    const text = source && typeof source.text === 'string' ? source.text : '';
    const scan = providedScan || scanXml(text);

    // Which <field>/<parameter>/<variable> offsets are report declarations
    // (direct children of <jasperReport>) versus dataset declarations (inside
    // <dataset>/<subDataset>). Everything else — a parameter passed into a
    // subreport, a <datasetRun> parameter — is not a declaration at all.
    // `null` when the document cannot be scanned: fall back to the old
    // whole-document regex behaviour so a malformed file still yields
    // declarations for the undeclared-reference check.
    const scopes = classifyDeclarationScopes(scan);

    const rawFields     = extractFields(text);
    const rawParameters = extractParameters(text, !scopes);
    const rawVariables  = extractVariables(text);

    const fields      = filterScope(rawFields,     'field',     scopes, 'report');
    const parameters  = filterScope(rawParameters, 'parameter', scopes, 'report');
    const variables   = filterScope(rawVariables,  'variable',  scopes, 'report');
    const dsFields    = filterScope(rawFields,     'field',     scopes, 'dataset');
    const dsParameters = filterScope(rawParameters, 'parameter', scopes, 'dataset');
    const dsVariables = filterScope(rawVariables,  'variable',  scopes, 'dataset');

    const byOffset = (a: Declaration, b: Declaration) => a.offset - b.offset;

    const result: ParseResult = {
        fields,
        parameters,
        variables,
        dataset: {
            fields:     dsFields,
            parameters: dsParameters,
            variables:  dsVariables,
        },
        language:    languageOfScan(scan),
        resourceBundle: bundleAttributeOfScan(scan),
        datasets:    buildDatasets(scopes, rawFields, rawParameters, rawVariables),
        // Ranges where a dataset's declarations are the visible scope: the
        // <dataset>/<subDataset> definition itself and, inside list/table
        // components, the part that consumes the run dataset. A <datasetRun>'s
        // own parameter bindings are excluded: they are evaluated in the
        // enclosing (usually report) scope.
        scopeRanges: buildScopeRanges(scan, scopes),
        allFields:     [...fields, ...dsFields].sort(byOffset),
        allParameters: [...parameters, ...dsParameters].sort(byOffset),
        allVariables:  [...variables, ...dsVariables].sort(byOffset),
        groups:     extractGroups(text),
        styles:     extractStyles(text),
        references: extractReferences(scan),
        resourceReferences: extractResourceReferences(scan),
        outline:    extractOutline(scan, { fields, parameters, variables }),
    };

    if (id !== null) cache.set(id, { version, result });
    return result;
}

/**
 * Map each declaration tag to the set of start-tag offsets that are direct
 * report children or dataset children, and keep each dataset's own sets so
 * consumers can resolve a single scope instead of the merged union.
 * Returns null when the document cannot be scanned.
 */
function classifyDeclarationScopes(scan: XmlScanResult | null): ScopeClassification | null {
    if (!scan || scan.error || !scan.doc) return null;

    const report   = emptyDeclarationSets();
    const dataset  = emptyDeclarationSets();
    const datasets: DatasetClassification[] = [];

    for (const node of scan.doc.walk()) {
        if (node.tag !== 'dataset' && node.tag !== 'subDataset') continue;
        const nameAttr = node.attr('name');
        datasets.push({
            name:       node.attrValue('name') || '',
            nameOffset: nameAttr ? nameAttr.valueStart : -1,
            offset:     node.startTag,
            end:        node.end,
            sets:       emptyDeclarationSets(),
        });
    }

    for (const node of scan.doc.walk()) {
        if (node.tag !== 'field' && node.tag !== 'parameter' && node.tag !== 'variable') continue;

        const owner = containingDataset(datasets, node.startTag);
        if (owner) {
            owner.sets[node.tag].add(node.startTag);
            dataset[node.tag].add(node.startTag);
        } else if (node.parent === scan.doc.root) {
            report[node.tag].add(node.startTag);
        }
    }
    return { report, dataset, datasets };
}

function emptyDeclarationSets(): DeclarationSets {
    return { field: new Set(), parameter: new Set(), variable: new Set() };
}

/** The innermost dataset whose span contains `offset`, or null. */
function containingDataset(
    datasets: readonly DatasetClassification[],
    offset: number
): DatasetClassification | null {
    let best: DatasetClassification | null = null;
    for (const ds of datasets) {
        if (ds.offset <= offset && offset < ds.end && (!best || ds.offset >= best.offset)) best = ds;
    }
    return best;
}

/** Keep only declarations whose start tag belongs to `scope`. */
function filterScope(
    list: Declaration[],
    tag: DeclarationTag,
    scopes: ScopeClassification | null,
    scope: 'report' | 'dataset'
): Declaration[] {
    if (!scopes) return scope === 'report' ? list : [];
    const allowed = scopes[scope][tag];
    return list.filter(decl => allowed.has(decl.offset));
}

/** One entry per <dataset>/<subDataset>, with that dataset's declarations. */
function buildDatasets(
    scopes: ScopeClassification | null,
    rawFields: Declaration[],
    rawParameters: Declaration[],
    rawVariables: Declaration[]
): DatasetDeclaration[] {
    if (!scopes) return [];
    return scopes.datasets.map(ds => ({
        name:       ds.name,
        nameOffset: ds.nameOffset,
        offset:     ds.offset,
        end:        ds.end,
        fields:     rawFields.filter(decl => ds.sets.field.has(decl.offset)),
        parameters: rawParameters.filter(decl => ds.sets.parameter.has(decl.offset)),
        variables:  rawVariables.filter(decl => ds.sets.variable.has(decl.offset)),
    }));
}

/**
 * Spans where a dataset owns the visible declarations. Besides the dataset
 * definition, this covers a list/table's component contents (which consume the
 * run dataset) while excluding the <datasetRun> element itself, whose
 * parameter/connection expressions are evaluated in the enclosing scope.
 */
function buildScopeRanges(
    scan: XmlScanResult | null,
    scopes: ScopeClassification | null
): ScopeRange[] {
    const ranges: ScopeRange[] = [];
    if (!scan || scan.error || !scan.doc || !scopes) return ranges;

    for (const ds of scopes.datasets) {
        ranges.push({ datasetName: ds.name, start: ds.offset, end: ds.end });
    }

    for (const node of scan.doc.walk()) {
        if (node.tag !== 'datasetRun') continue;
        const parent = node.parent;
        if (!parent || !consumesDataset(node, parent)) continue;

        const datasetName = node.attrValue('subDataset') || '';
        if (parent.startTagEnd < node.startTag) {
            ranges.push({ datasetName, start: parent.startTagEnd, end: node.startTag });
        }
        if (node.end < parent.end) {
            ranges.push({ datasetName, start: node.end, end: parent.end });
        }
    }
    return ranges;
}

/** True for the component that renders a dataset (list/table/crosstab). */
function consumesDataset(run: XmlNode, parent: XmlNode): boolean {
    if (!run.attrValue('subDataset')) return false;
    const kind = parent.attrValue('kind') || '';
    return (parent.tag === 'component' || parent.tag === 'element') &&
        (kind === 'list' || kind === 'table' || kind === 'crosstab');
}

/** The dataset scope that owns `offset` when it is inside a scoped region. */
function scopeRangeAt(parsed: ParseResult | null, offset: number): ScopeRange | null {
    let best: ScopeRange | null = null;
    for (const range of (parsed && parsed.scopeRanges) || []) {
        if (offset < range.start || offset >= range.end) continue;
        if (!best || (range.end - range.start) < (best.end - best.start)) best = range;
    }
    return best;
}

/**
 * Resolve the declarations visible at `offset`.
 *
 * `kind` is `report` outside datasets, `dataset` inside a dataset definition or
 * a list/table run scope, and `unknown` when a dataset run names a dataset that
 * is not defined in this file (the caller must not guess).
 *
 * @param offset document character offset; negative means report scope
 */
function resolveDeclarationScope(parsed: ParseResult | null, offset: number): DeclarationScope {
    const range = scopeRangeAt(parsed, offset);
    if (!range) return reportScope(parsed);

    const dataset = ((parsed && parsed.datasets) || []).find(ds => ds.name === range.datasetName);
    if (!dataset) {
        return {
            kind: 'unknown', dataset: null, datasetName: range.datasetName,
            fields: [], parameters: [], variables: [],
            allFields: [], allParameters: [], allVariables: [],
        };
    }

    return {
        kind: 'dataset',
        dataset,
        datasetName: dataset.name,
        fields:      dataset.fields,
        parameters:  dataset.parameters,
        variables:   dataset.variables,
        allFields:     dataset.fields,
        allParameters: dataset.parameters,
        allVariables:  dataset.variables,
    };
}

function reportScope(parsed: ParseResult | null): DeclarationScope {
    const fields     = (parsed && parsed.fields)     || [];
    const parameters = (parsed && parsed.parameters) || [];
    const variables  = (parsed && parsed.variables)  || [];
    return {
        kind: 'report', dataset: null, datasetName: null,
        fields, parameters, variables,
        allFields: fields, allParameters: parameters, allVariables: variables,
    };
}

/** Drop the cached parse result for a single document (call when it closes). */
function clearCache(uri: string | { toString(): string }): void {
    cache.delete(typeof uri === 'string' ? uri : uri.toString());
}

/** Drop every cached parse result. */
function clearAllCaches(): void {
    cache.clear();
}

// ── Fields ────────────────────────────────────────────────────────────────────

function extractFields(text: string): Declaration[] {
    const results: Declaration[] = [];
    const tagRe = /<field(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/field>)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
        const attrs  = m[1] || '';
        const inner  = m[2] || '';
        const named  = readName(m, 'field', attrs);
        if (!named) continue;

        const cls  = matchAttr(attrs, 'class');
        const type = (cls && cls.value) || 'java.lang.Object';

        results.push({
            name:        named.name,
            type:        shortType(type),
            fullType:    type,
            // Without a `class` attribute JasperReports infers the type from the
            // data source, so `java.lang.Object` here means "unknown", not Object.
            typeSource:  cls && cls.value ? 'declared' : 'inferred',
            description: extractTagContent(inner, 'description').trim(),
            offset:      m.index,
            end:         m.index + m[0].length,
            nameOffset:  named.nameOffset,
        });
    }
    return results;
}

// ── Parameters ────────────────────────────────────────────────────────────────

function extractParameters(text: string, skipSubreports = true): Declaration[] {
    const results: Declaration[] = [];
    // Only needed on the whole-document fallback: when the scanner is
    // available, scope classification drops every nested <parameter> instead.
    const subreportRanges = skipSubreports ? buildSubreportRanges(text) : null;

    const tagRe = /<parameter(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/parameter>)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
        // Skip parameters that are nested inside a subreport element
        if (subreportRanges && inSubreportRange(m.index, subreportRanges)) continue;

        const attrs  = m[1] || '';
        const inner  = m[2] || '';
        const named  = readName(m, 'parameter', attrs);
        if (!named) continue;

        const cls       = matchAttr(attrs, 'class');
        const type      = (cls && cls.value) || 'java.lang.Object';
        const forPrompt = matchAttr(attrs, 'isForPrompting');
        const isSystem  = !!forPrompt && forPrompt.value === 'false';
        const defVal    = extractTagContent(inner, 'defaultValueExpression')
                            .replace(/<!\[CDATA\[|\]\]>/g, '').trim();

        results.push({
            name:        named.name,
            type:        shortType(type),
            fullType:    type,
            typeSource:  cls && cls.value ? 'declared' : 'inferred',
            description: defVal ? `Default: ${defVal}`
                                : (isSystem ? 'System parameter' : 'User parameter'),
            isSystem,
            offset:     m.index,
            end:        m.index + m[0].length,
            nameOffset: named.nameOffset,
        });
    }
    return results;
}

// ── Variables ─────────────────────────────────────────────────────────────────

function extractVariables(text: string): Declaration[] {
    const results: Declaration[] = [];
    const tagRe = /<variable(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/variable>)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
        const attrs = m[1] || '';
        const inner = m[2] || '';
        const named = readName(m, 'variable', attrs);
        if (!named) continue;

        const cls         = matchAttr(attrs, 'class');
        const type        = (cls && cls.value) || 'java.lang.Object';
        const resetType   = (matchAttr(attrs, 'resetType')   || { value: 'Report'  }).value;
        const calculation = (matchAttr(attrs, 'calculation') || { value: 'Nothing' }).value;
        const expr        = extractTagContent(inner, 'variableExpression')
                              .replace(/<!\[CDATA\[|\]\]>/g, '').trim();

        results.push({
            name:        named.name,
            type:        shortType(type),
            fullType:    type,
            typeSource:  cls && cls.value ? 'declared' : 'inferred',
            description: `${calculation} / reset: ${resetType}${expr ? `\n\nExpr: \`${expr}\`` : ''}`,
            offset:      m.index,
            end:         m.index + m[0].length,
            nameOffset:  named.nameOffset,
        });
    }
    return results;
}

// ── Groups ────────────────────────────────────────────────────────────────────

function extractGroups(text: string): Declaration[] {
    const results: Declaration[] = [];
    const tagRe = /<group(\s[^>]*?)(?:\/>|>[\s\S]*?<\/group>)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
        const attrs = m[1] || '';
        const named = readName(m, 'group', attrs);
        if (!named) continue;

        results.push({
            name:        named.name,
            type:        'Group',
            fullType:    'Group',
            description: 'Report group',
            offset:      m.index,
            end:         m.index + m[0].length,
            nameOffset:  named.nameOffset,
        });
    }
    return results;
}

// ── Styles ────────────────────────────────────────────────────────────────────

function extractStyles(text: string): Declaration[] {
    const results: Declaration[] = [];
    const tagRe = /<style(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/style>)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
        const attrs = m[1] || '';
        const named = readName(m, 'style', attrs);
        if (!named) continue;

        results.push({
            name:        named.name,
            type:        'Style',
            fullType:    'Style',
            description: 'Named report style',
            offset:      m.index,
            end:         m.index + m[0].length,
            nameOffset:  named.nameOffset,
        });
    }
    return results;
}

// ── Duplicate declaration names ──────────────────────────────────────────────

/**
 * Every declaration that repeats an earlier name within the same scope.
 * Report and dataset scopes are checked separately: a dataset field may share
 * its name with a master field, but not with another field of the same dataset.
 */
function findDuplicateNames(parsed: ParseResult): DuplicateName[] {
    const duplicates: DuplicateName[] = [];

    const check = (kind: string, list: readonly NameSpan[] | null | undefined, scope: string) => {
        const seen = new Set<string>();
        for (const declaration of list || []) {
            if (!declaration.name || typeof declaration.nameOffset !== 'number') continue;
            if (seen.has(declaration.name)) {
                duplicates.push({
                    kind,
                    name:   declaration.name,
                    scope,
                    offset: declaration.nameOffset,
                    length: declaration.name.length,
                });
            } else {
                seen.add(declaration.name);
            }
        }
    };

    check('field', parsed.fields, '');
    check('parameter', parsed.parameters, '');
    check('variable', parsed.variables, '');
    // parsed.groups also contains dataset groups (they are declared inside a
    // <dataset>); those belong to that dataset's scope, not the report's.
    check('group', (parsed.groups || []).filter(group => !insideAnyDataset(parsed, group.offset)), '');
    check('style', parsed.styles, '');
    check('dataset', parsed.datasets, '');

    for (const dataset of parsed.datasets || []) {
        check('field', dataset.fields, dataset.name);
        check('parameter', dataset.parameters, dataset.name);
        check('variable', dataset.variables, dataset.name);
    }

    return duplicates;
}

function insideAnyDataset(parsed: ParseResult, offset: number): boolean {
    return (parsed.datasets || []).some(dataset =>
        dataset.offset <= offset && offset < dataset.end);
}

// ── References ($F/$P/$V usages and declaration-equivalent usages) ────────────
//
// Only expression-bearing nodes are scanned. A reference mentioned in an XML
// comment or displayed as static text is not a usage: treating it as one
// produced false "not declared" errors and inflated the hover/reference counts.
//
// `end` is the offset just past a real `$X{name}` token. Reference markers that
// are attribute names rather than tokens (subreportParameter, returnValue,
// a nested subreport <parameter>) have no `end`.


function extractReferences(scan: XmlScanResult | null): Reference[] {
    const results: Reference[] = [];
    if (!scan || scan.error || !scan.doc) return results;

    for (const node of scan.doc.walk()) {
        if (hasRole(node.tag, 'reference')) {
            addTextNodeReferences(node, results);
        } else if (node.tag === 'subreportParameter') {
            // Classic format: the parameter is passed to a subreport, so it
            // counts as used here.
            addAttributeReference(results, 'P', node, 'name', 'usage');
        } else if (node.tag === 'returnValue') {
            // <returnValue toVariable="..."> writes one of this report's variables.
            addAttributeReference(results, 'V', node, 'toVariable', 'usage');
        } else if (node.tag === 'sortField') {
            // <sortField name="X" type="Field|Variable"/> names a declaration
            // and is navigable like a token reference.
            const type = (node.attrValue('type') || 'field').toLowerCase();
            if (type === 'none') continue;
            addAttributeReference(results, type === 'variable' ? 'V' : 'F', node, 'name', 'attribute');
        } else if (node.tag === 'parameter' && insideSubreport(node)) {
            // New format: <parameter name="..."> nested inside a subreport
            // passes a value INTO it, so it is a usage of a parent parameter,
            // not a declaration of this report.
            addAttributeReference(results, 'P', node, 'name', 'usage');
        }
    }

    return results;
}

/** Scan the plain-text/CDATA spans of one expression-bearing element. */
function addTextNodeReferences(node: XmlNode, results: Reference[]): void {
    for (const span of node.textNodes) {
        forEachReferenceToken(span.text, token => {
            if (token.sigil === 'R' || !token.name) return;
            const offset = span.start + token.start;
            results.push({
                sigil: token.sigil,
                name: token.name,
                bang: token.bang,
                offset,
                end:   span.start + token.end,
                role:  'token',
            });
        });
    }
}

/** A name attribute that behaves like a reference but has no `$X{}` token. */
function addAttributeReference(
    results: Reference[],
    sigil: ReferenceSigil,
    node: XmlNode,
    attribute: string,
    role: 'attribute' | 'usage'
): void {
    const attr = node.attr(attribute);
    if (!attr || !attr.value) return;
    results.push({
        sigil,
        name:          attr.value,
        offset:        attr.valueStart,
        end:           attr.valueEnd,
        fromSubreport: true,
        role,
    });
}

function insideSubreport(node: XmlNode): boolean {
    return node.ancestors().some(ancestor =>
        ancestor.tag === 'subreport' ||
        ((ancestor.tag === 'element' || ancestor.tag === 'component') &&
            ancestor.attrValue('kind') === 'subreport'));
}

// ── Resource-bundle references ($R{key}) ─────────────────────────────────────

/** `$R{key}` tokens inside expression-bearing elements (for missing-key checks). */
function extractResourceReferences(scan: XmlScanResult | null): ResourceReference[] {
    const results: ResourceReference[] = [];
    if (!scan || scan.error || !scan.doc) return results;

    for (const node of scan.doc.walk()) {
        if (!hasRole(node.tag, 'reference')) continue;

        for (const span of node.textNodes) {
            for (const token of referenceTokens(span.text)) {
                if (token.sigil !== 'R' || !token.name) continue;
                results.push({
                    name: token.name,
                    offset: span.start + token.start,
                    end: span.start + token.end,
                });
            }
        }
    }

    return results;
}

// ── Outline (report structure for tree view) ──────────────────────────────────

const CLASSIC_ELEMENTS = new Set([
    'textField', 'staticText', 'image', 'line', 'rectangle', 'ellipse',
    'frame', 'subreport', 'chart', 'table', 'list', 'crosstab', 'component',
    'break',
]);

interface OutlineDeclarations {
    fields?: readonly Declaration[];
    parameters?: readonly Declaration[];
    variables?: readonly Declaration[];
}

/**
 * Build the outline from the scanner tree: report → declarations → datasets →
 * groups (with header/footer bands) → bands with every element kind → styles.
 */
function extractOutline(
    scan: XmlScanResult | null,
    declarations: OutlineDeclarations = {}
): OutlineEntry[] {
    if (!scan || scan.error || !scan.doc) return [];
    const root = scan.doc.root;
    if (root.tag !== 'jasperReport') return [];

    const reportNode: OutlineEntry = {
        kind: 'report',
        name: root.attrValue('name') || 'Report',
        offset: root.startTag,
        end: root.end,
        children: [],
    };

    // ── Declarations ─────────────────────────────────────────────────────────
    const declChildren: OutlineEntry[] = [];
    for (const field of declarations.fields || []) {
        declChildren.push(leaf('field', `${field.name} : ${field.type}`, field));
    }
    for (const parameter of declarations.parameters || []) {
        if (parameter.isSystem) continue;
        declChildren.push(leaf('parameter', `${parameter.name} : ${parameter.type}`, parameter));
    }
    for (const variable of declarations.variables || []) {
        declChildren.push(leaf('variable', `${variable.name} : ${variable.type}`, variable));
    }
    if (declChildren.length > 0) {
        reportNode.children.push(container('group', 'Declarations', declChildren));
    }

    // ── Datasets ─────────────────────────────────────────────────────────────
    const datasets = root.children.filter(child => child.tag === 'dataset' || child.tag === 'subDataset');
    if (datasets.length > 0) {
        reportNode.children.push(container('group', 'Datasets',
            datasets.map(datasetNode), datasets[0].startTag, datasets[datasets.length - 1].end));
    }

    // ── Groups ───────────────────────────────────────────────────────────────
    for (const group of root.children.filter(child => child.tag === 'group')) {
        reportNode.children.push(groupNode(group));
    }

    // ── Bands ────────────────────────────────────────────────────────────────
    for (const tag of REPORT_SECTIONS) {
        for (const section of root.children.filter(child => child.tag === tag)) {
            const bands = section.children.filter(child => child.tag === 'band');
            if (bands.length > 0) {
                bands.forEach((band, index) => {
                    const label = bands.length > 1 ? `${tag} ${index + 1}` : tag;
                    reportNode.children.push(bandNode(band, label));
                });
            } else {
                reportNode.children.push(bandNode(section, tag));
            }
        }
    }

    // ── Styles ───────────────────────────────────────────────────────────────
    const styles = root.children.filter(child => child.tag === 'style' && child.attrValue('name'));
    if (styles.length > 0) {
        reportNode.children.push(container('group', 'Styles',
            styles.map(style => leaf('style', `Style: ${style.attrValue('name')}`, nodeSpan(style))),
            styles[0].startTag, styles[styles.length - 1].end));
    }

    return [reportNode];
}

function nodeSpan(node: XmlNode): { offset: number; end: number } {
    return { offset: node.startTag, end: node.end };
}

function leaf(kind: string, name: string, span: { offset: number; end: number }): OutlineEntry {
    return { kind, name, offset: span.offset, end: span.end, children: [] };
}

function container(
    kind: string,
    name: string,
    children: OutlineEntry[],
    offset?: number,
    end?: number
): OutlineEntry {
    return {
        kind,
        name,
        offset: offset ?? Math.min(...children.map(child => child.offset)),
        end: end ?? Math.max(...children.map(child => child.end)),
        children,
    };
}

function datasetNode(dataset: XmlNode): OutlineEntry {
    const name = dataset.attrValue('name') || 'Dataset';
    const children: OutlineEntry[] = [];

    for (const child of dataset.children) {
        if (child.tag === 'field' || child.tag === 'parameter' || child.tag === 'variable') {
            children.push(leaf(child.tag, child.attrValue('name') || child.tag, nodeSpan(child)));
        } else if (child.tag === 'group') {
            children.push(groupNode(child));
        }
    }

    return {
        kind: 'dataset',
        name: `Dataset: ${name}`,
        offset: dataset.startTag,
        end: dataset.end,
        children,
    };
}

function groupNode(group: XmlNode): OutlineEntry {
    const name = group.attrValue('name') || 'Group';
    const children: OutlineEntry[] = [];

    for (const part of group.children.filter(child =>
        child.tag === 'groupHeader' || child.tag === 'groupFooter')) {
        const bands = part.children.filter(child => child.tag === 'band');
        if (bands.length > 0) {
            for (const band of bands) children.push(bandNode(band, part.tag));
        } else {
            children.push(bandNode(part, part.tag));
        }
    }

    return {
        kind: 'group',
        name: `Group: ${name}`,
        offset: group.startTag,
        end: group.end,
        children,
    };
}

function bandNode(node: XmlNode, label: string): OutlineEntry {
    return {
        kind: 'band',
        name: label,
        offset: node.startTag,
        end: node.end,
        children: elementsIn(node),
    };
}

/** Top-level elements inside a band/frame, with nested elements as children. */
function elementsIn(containerNode: XmlNode): OutlineEntry[] {
    const nodes: OutlineEntry[] = [];

    for (const child of containerNode.children) {
        if (isElementNode(child)) nodes.push(elementNode(child));
        else nodes.push(...elementsIn(child));
    }
    return nodes;
}

function isElementNode(node: XmlNode): boolean {
    if (node.tag === 'element') return true;
    return CLASSIC_ELEMENTS.has(node.tag)
        && node.children.some(child => child.tag === 'reportElement');
}

function elementNode(node: XmlNode): OutlineEntry {
    return {
        kind: node.tag === 'element' ? (node.attrValue('kind') || 'element') : node.tag,
        name: elementLabel(node),
        offset: node.startTag,
        end: node.end,
        children: elementsIn(node),
    };
}

function elementLabel(node: XmlNode): string {
    const kind = node.tag === 'element' ? (node.attrValue('kind') || 'element') : node.tag;
    const expression = node.children.find(child => EXPRESSION_TAGS.includes(child.tag));
    const expressionText = expression ? expression.textContent().trim() : '';
    if (expressionText) return truncateLabel(expressionText);

    const text = node.children.find(child => child.tag === 'text');
    const textValue = text ? text.textContent().trim() : '';
    if (textValue) return `${kind}: ${truncateLabel(textValue)}`;

    return kind;
}

function truncateLabel(text: string): string {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.length > 60 ? `${singleLine.slice(0, 57)}…` : singleLine;
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match `name="value"` / `name='value'` as a whole attribute (not a suffix of a
 * longer attribute name). Returns `{ value, valueOffset }` where `valueOffset`
 * is relative to the start of `attrs`, or null.
 */
function matchAttr(attrs: string, attrName: string): { value: string; valueOffset: number } | null {
    const re = new RegExp(`(?:^|\\s)${escapeRegExp(attrName)}\\s*=\\s*(["'])([^"']*)\\1`);
    const m  = re.exec(attrs);
    if (!m) return null;
    const value = m[2];
    return { value, valueOffset: m.index + m[0].length - value.length - 1 };
}

/**
 * Read the `name` attribute of a declaration tag and resolve its absolute
 * offset in the document. Works for both single- and double-quoted values.
 * `tagName` is needed because the attribute group starts right after `<tag`.
 */
function readName(
    match: RegExpExecArray,
    tagName: string,
    attrs: string
): { name: string; nameOffset: number } | null {
    const nameAttr = matchAttr(attrs, 'name');
    if (!nameAttr || !nameAttr.value) return null;
    const attrsStart = match.index + 1 + tagName.length;
    return { name: nameAttr.value, nameOffset: attrsStart + nameAttr.valueOffset };
}

function extractTagContent(inner: string, tagName: string): string {
    const re = new RegExp(`<${escapeRegExp(tagName)}[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
    const m  = re.exec(inner);
    return m ? m[1] : '';
}

function shortType(fullType: string): string {
    if (!fullType) return 'Object';
    const parts = fullType.split('.');
    const last = parts[parts.length - 1];
    return COMMON_TYPES.has(last) ? last : fullType;
}

// ── Subreport range detection ─────────────────────────────────────────────────

/**
 * Build a set of character ranges [start, end] that are inside subreport
 * element blocks, so we can skip <parameter> tags found there.
 *
 * Matches both formats:
 *   Classic:  <subreport>...</subreport>
 *   New JRXL: <element kind="subreport" ...>...</element>
 */
function buildSubreportRanges(text: string): [number, number][] {
    const ranges: [number, number][] = [];

    // Classic format: <subreport>...</subreport>
    const classicRe = /<subreport[\s>][\s\S]*?<\/subreport>/g;
    let m: RegExpExecArray | null;
    while ((m = classicRe.exec(text)) !== null) {
        ranges.push([m.index, m.index + m[0].length]);
    }

    // New JRXML format: <element kind="subreport" ...>...</element>
    // The opening tag may span multiple lines and contain many attributes,
    // so we scan character-by-character to find the closing > of the opening tag,
    // then check if it contained kind="subreport".
    let i = 0;
    while (i < text.length) {
        const elemIdx = text.indexOf('<element', i);
        if (elemIdx === -1) break;
        if (!/[\s>]/.test(text[elemIdx + '<element'.length] || '')) {
            i = elemIdx + '<element'.length;
            continue;
        }

        // Find the end of this opening tag (the closing >), skipping quoted values
        let j = elemIdx + '<element'.length;
        let inQ = false, qCh = '';
        while (j < text.length) {
            const ch = text[j];
            if (inQ) {
                if (ch === qCh) inQ = false;
            } else if (ch === '"' || ch === "'") {
                inQ = true; qCh = ch;
            } else if (ch === '>') {
                break;
            }
            j++;
        }

        const openTagText = text.slice(elemIdx, j + 1);

        if (/kind\s*=\s*["']subreport["']/.test(openTagText)) {
            // Find matching </element> — simple depth counter for nested elements
            let depth = 1, k = j + 1;
            while (k < text.length && depth > 0) {
                if (text.startsWith('<element', k) && /[\s>]/.test(text[k + 8] || '')) {
                    depth++;
                    k += 8;
                } else if (text.startsWith('</element>', k)) {
                    depth--;
                    if (depth === 0) {
                        ranges.push([elemIdx, k + '</element>'.length]);
                        k += '</element>'.length;
                        break;
                    } else {
                        k += '</element>'.length;
                    }
                } else {
                    k++;
                }
            }
            i = k;
        } else {
            i = j + 1;
        }
    }

    return ranges;
}

/** Return true if offset falls inside any of the given ranges */
function inSubreportRange(offset: number, ranges: readonly [number, number][]): boolean {
    return ranges.some(([s, e]) => offset >= s && offset < e);
}

export {
    parseDeclarations,
    parseReport,
    resolveDeclarationScope,
    findDuplicateNames,
    clearCache,
    clearAllCaches,
};
