// jrxmlParser.js
// Parses a .jrxml document and extracts declarations, references, and structure.
// Results are cached per document version.

const { scanXml } = require('./xmlspan');
const { REFERENCE_CONTAINERS } = require('./expressionTags');

const cache = new Map();

/**
 * @typedef {{ name:string, type:string, fullType:string, typeSource:'declared'|'inferred', description:string, offset:number, end:number, nameOffset:number, isSystem?:boolean }} Declaration
 * @typedef {{ sigil:string, name:string, offset:number, fromSubreport?:boolean }} Reference
 * @typedef {{ kind:string, name:string, offset:number, end:number, children:OutlineNode[] }} OutlineNode
 * @typedef {{ fields:Declaration[], parameters:Declaration[], variables:Declaration[], dataset:{fields:Declaration[],parameters:Declaration[],variables:Declaration[]}, datasets:{name:string,offset:number,end:number,fields:Declaration[],parameters:Declaration[],variables:Declaration[]}[], scopeRanges:{datasetName:string,start:number,end:number}[], allFields:Declaration[], allParameters:Declaration[], allVariables:Declaration[], groups:Declaration[], references:Reference[], outline:OutlineNode[] }} ParseResult
 */

const COMMON_TYPES = new Set([
    'String','Integer','Long','Double','Float','Boolean','Byte','Short','Character',
    'BigDecimal','BigInteger','Date','Object','Number','List','Map','Collection',
]);

// ── Entry point ───────────────────────────────────────────────────────────────

function parseDeclarations(document) {
    const key    = document.uri.toString();
    const cached = cache.get(key);
    if (cached && cached.version === document.version) return cached.result;

    const text = document.getText();
    const scan = scanXml(text);

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

    const byOffset = (a, b) => a.offset - b.offset;

    const result = {
        fields,
        parameters,
        variables,
        dataset: {
            fields:     dsFields,
            parameters: dsParameters,
            variables:  dsVariables,
        },
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
        outline:    extractOutline(text, { fields, parameters, variables }),
    };

    cache.set(key, { version: document.version, result });
    return result;
}

/**
 * Map each declaration tag to the set of start-tag offsets that are direct
 * report children or dataset children, and keep each dataset's own sets so
 * consumers can resolve a single scope instead of the merged union.
 * Returns null when the document cannot be scanned.
 */
function classifyDeclarationScopes(scan) {
    if (!scan || scan.error) return null;

    const report   = emptyDeclarationSets();
    const dataset  = emptyDeclarationSets();
    const datasets = [];

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

function emptyDeclarationSets() {
    return { field: new Set(), parameter: new Set(), variable: new Set() };
}

/** The innermost dataset whose span contains `offset`, or null. */
function containingDataset(datasets, offset) {
    let best = null;
    for (const ds of datasets) {
        if (ds.offset <= offset && offset < ds.end && (!best || ds.offset >= best.offset)) best = ds;
    }
    return best;
}

/** Keep only declarations whose start tag belongs to `scope`. */
function filterScope(list, tag, scopes, scope) {
    if (!scopes) return scope === 'report' ? list : [];
    const allowed = scopes[scope][tag];
    return list.filter(decl => allowed.has(decl.offset));
}

/** One entry per <dataset>/<subDataset>, with that dataset's declarations. */
function buildDatasets(scopes, rawFields, rawParameters, rawVariables) {
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
function buildScopeRanges(scan, scopes) {
    const ranges = [];
    if (!scan || scan.error || !scopes) return ranges;

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
function consumesDataset(run, parent) {
    if (!run.attrValue('subDataset')) return false;
    const kind = parent.attrValue('kind') || '';
    return (parent.tag === 'component' || parent.tag === 'element') &&
        (kind === 'list' || kind === 'table' || kind === 'crosstab');
}

/** The dataset scope that owns `offset` when it is inside a scoped region. */
function scopeRangeAt(parsed, offset) {
    let best = null;
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
 * @param {ParseResult} parsed
 * @param {number} offset document character offset; negative means report scope
 * @returns {{kind:'report'|'dataset'|'unknown', dataset:object|null, datasetName:string|null,
 *            fields:Declaration[], parameters:Declaration[], variables:Declaration[],
 *            allFields:Declaration[], allParameters:Declaration[], allVariables:Declaration[]}}
 */
function resolveDeclarationScope(parsed, offset) {
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

function reportScope(parsed) {
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
function clearCache(uri) {
    cache.delete(typeof uri === 'string' ? uri : uri.toString());
}

/** Drop every cached parse result. */
function clearAllCaches() {
    cache.clear();
}

// ── Fields ────────────────────────────────────────────────────────────────────

function extractFields(text) {
    const results = [];
    const tagRe = /<field(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/field>)/g;
    let m;
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

function extractParameters(text, skipSubreports = true) {
    const results = [];
    // Only needed on the whole-document fallback: when the scanner is
    // available, scope classification drops every nested <parameter> instead.
    const subreportRanges = skipSubreports ? buildSubreportRanges(text) : null;

    const tagRe = /<parameter(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/parameter>)/g;
    let m;
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

function extractVariables(text) {
    const results = [];
    const tagRe = /<variable(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/variable>)/g;
    let m;
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

function extractGroups(text) {
    const results = [];
    const tagRe = /<group(\s[^>]*?)(?:\/>|>[\s\S]*?<\/group>)/g;
    let m;
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

function extractStyles(text) {
    const results = [];
    const tagRe = /<style(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/style>)/g;
    let m;
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
 *
 * @param {ParseResult} parsed
 * @returns {{kind:string,name:string,scope:string,offset:number,length:number}[]}
 */
function findDuplicateNames(parsed) {
    const duplicates = [];

    const check = (kind, list, scope) => {
        const seen = new Set();
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

function insideAnyDataset(parsed, offset) {
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

const REFERENCE_RE = /\$(F|P|V)(!?)\{([\w.]+)\}/g;

function extractReferences(scan) {
    const results = [];
    if (!scan || scan.error) return results;

    for (const node of scan.doc.walk()) {
        if (REFERENCE_CONTAINERS.has(node.tag)) {
            addTextNodeReferences(node, results);
        } else if (node.tag === 'subreportParameter') {
            // Classic format: the parameter is passed to a subreport, so it
            // counts as used here.
            addAttributeReference(results, 'P', node, 'name');
        } else if (node.tag === 'returnValue') {
            // <returnValue toVariable="..."> writes one of this report's variables.
            addAttributeReference(results, 'V', node, 'toVariable');
        } else if (node.tag === 'parameter' && insideSubreport(node)) {
            // New format: <parameter name="..."> nested inside a subreport
            // passes a value INTO it, so it is a usage of a parent parameter,
            // not a declaration of this report.
            addAttributeReference(results, 'P', node, 'name');
        }
    }

    return results;
}

/** Scan the plain-text/CDATA spans of one expression-bearing element. */
function addTextNodeReferences(node, results) {
    for (const span of node.textNodes) {
        REFERENCE_RE.lastIndex = 0;
        let match;
        while ((match = REFERENCE_RE.exec(span.text)) !== null) {
            const name = match[3].trim();
            if (!name) continue;
            const offset = span.start + match.index;
            results.push({
                sigil: match[1],
                name,
                bang:  match[2] === '!',
                offset,
                end:   offset + match[0].length,
            });
        }
    }
}

/** A name attribute that behaves like a reference but has no `$X{}` token. */
function addAttributeReference(results, sigil, node, attribute) {
    const attr = node.attr(attribute);
    if (!attr || !attr.value) return;
    results.push({
        sigil,
        name:          attr.value,
        offset:        attr.valueStart,
        fromSubreport: true,
    });
}

function insideSubreport(node) {
    return node.ancestors().some(ancestor =>
        ancestor.tag === 'subreport' ||
        ((ancestor.tag === 'element' || ancestor.tag === 'component') &&
            ancestor.attrValue('kind') === 'subreport'));
}

// ── Outline (report structure for tree view) ──────────────────────────────────

const BANDS = [
    'title','pageHeader','columnHeader','detail','columnFooter',
    'pageFooter','lastPageFooter','summary','noData','background'
];

function extractOutline(text, declarations = {}) {
    const nodes = [];
    const fields     = declarations.fields     || [];
    const parameters = declarations.parameters || [];
    const variables  = declarations.variables  || [];

    // Report name
    const reportMatch = text.match(/<jasperReport[^>]*\sname="([^"]+)"/);
    const reportName  = reportMatch ? reportMatch[1] : 'Report';

    const reportNode = {
        kind: 'report',
        name: reportName,
        offset: reportMatch ? reportMatch.index : 0,
        end: Math.max(text.length, reportMatch ? reportMatch.index : 0),
        children: [],
    };

    // ── Declarations group ────────────────────────────────────────────────────
    const declChildren = [];

    for (const f of fields) {
        declChildren.push({
            kind: 'field', name: `${f.name} : ${f.type}`,
            offset: f.offset, end: f.end, children: []
        });
    }

    for (const p of parameters) {
        if (p.isSystem) continue;
        declChildren.push({
            kind: 'parameter', name: `${p.name} : ${p.type}`,
            offset: p.offset, end: p.end, children: []
        });
    }

    for (const v of variables) {
        declChildren.push({
            kind: 'variable', name: `${v.name} : ${v.type}`,
            offset: v.offset, end: v.end, children: []
        });
    }

    if (declChildren.length > 0) {
        // The group must span all of its children so the symbol tree is valid.
        const start = Math.min(...declChildren.map(c => c.offset));
        const end   = Math.max(...declChildren.map(c => c.end));
        reportNode.children.push({
            kind: 'group', name: 'Declarations', offset: start, end, children: declChildren
        });
    }

    // ── Bands ─────────────────────────────────────────────────────────────────
    for (const band of BANDS) {
        const bandRe = new RegExp(`<${band}[\\s>]`, 'g');
        let bm;
        while ((bm = bandRe.exec(text)) !== null) {
            const closeIdx = text.indexOf(`</${band}>`, bm.index);
            if (closeIdx === -1) continue;
            const bandEnd  = closeIdx + `</${band}>`.length;
            const bandText = text.slice(bm.index, closeIdx);

            const bandNode = { kind: 'band', name: band, offset: bm.index, end: bandEnd, children: [] };

            // textField elements — `(?=[\s>])` keeps `<textFieldExpression>` out.
            const tfRe = /<textField(?=[\s>])[^>]*>/g;
            let tfm;
            let tfIdx = 0;
            while ((tfm = tfRe.exec(bandText)) !== null) {
                tfIdx++;
                const exprMatch = bandText.slice(tfm.index)
                    .match(/<textFieldExpression[^>]*>([\s\S]*?)<\/textFieldExpression>/);
                const label = exprMatch
                    ? exprMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 60)
                    : `textField #${tfIdx}`;
                bandNode.children.push({
                    kind: 'textField', name: label,
                    offset: bm.index + tfm.index, end: bm.index + tfm.index + tfm[0].length,
                    children: []
                });
            }

            reportNode.children.push(bandNode);
        }
    }

    // ── Groups ────────────────────────────────────────────────────────────────
    for (const g of extractGroups(text)) {
        reportNode.children.push({
            kind: 'group', name: `Group: ${g.name}`,
            offset: g.offset, end: g.end, children: []
        });
    }

    nodes.push(reportNode);
    return nodes;
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match `name="value"` / `name='value'` as a whole attribute (not a suffix of a
 * longer attribute name). Returns `{ value, valueOffset }` where `valueOffset`
 * is relative to the start of `attrs`, or null.
 */
function matchAttr(attrs, attrName) {
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
function readName(match, tagName, attrs) {
    const nameAttr = matchAttr(attrs, 'name');
    if (!nameAttr || !nameAttr.value) return null;
    const attrsStart = match.index + 1 + tagName.length;
    return { name: nameAttr.value, nameOffset: attrsStart + nameAttr.valueOffset };
}

function extractTagContent(inner, tagName) {
    const re = new RegExp(`<${escapeRegExp(tagName)}[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
    const m  = re.exec(inner);
    return m ? m[1] : '';
}

function shortType(fullType) {
    if (!fullType) return 'Object';
    const last = fullType.split('.').pop();
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
function buildSubreportRanges(text) {
    const ranges = [];

    // Classic format: <subreport>...</subreport>
    const classicRe = /<subreport[\s>][\s\S]*?<\/subreport>/g;
    let m;
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
function inSubreportRange(offset, ranges) {
    return ranges.some(([s, e]) => offset >= s && offset < e);
}

module.exports = {
    parseDeclarations,
    resolveDeclarationScope,
    findDuplicateNames,
    clearCache,
    clearAllCaches,
};
