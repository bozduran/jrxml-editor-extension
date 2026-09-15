// jrxmlParser.js
// Parses a .jrxml document and extracts declarations, references, and structure.
// Results are cached per document version.

const cache = new Map();

/**
 * @typedef {{ name:string, type:string, fullType:string, description:string, offset:number, end:number, nameOffset:number, isSystem?:boolean }} Declaration
 * @typedef {{ sigil:string, name:string, offset:number, fromSubreport?:boolean }} Reference
 * @typedef {{ kind:string, name:string, offset:number, end:number, children:OutlineNode[] }} OutlineNode
 * @typedef {{ fields:Declaration[], parameters:Declaration[], variables:Declaration[], groups:Declaration[], references:Reference[], outline:OutlineNode[] }} ParseResult
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

    const text   = document.getText();
    const result = {
        fields:     extractFields(text),
        parameters: extractParameters(text),
        variables:  extractVariables(text),
        groups:     extractGroups(text),
        references: extractReferences(text),
        outline:    extractOutline(text),
    };

    cache.set(key, { version: document.version, result });
    return result;
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
            description: extractTagContent(inner, 'description').trim(),
            offset:      m.index,
            end:         m.index + m[0].length,
            nameOffset:  named.nameOffset,
        });
    }
    return results;
}

// ── Parameters ────────────────────────────────────────────────────────────────

function extractParameters(text) {
    const results = [];
    const subreportRanges = buildSubreportRanges(text);

    const tagRe = /<parameter(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/parameter>)/g;
    let m;
    while ((m = tagRe.exec(text)) !== null) {
        // Skip parameters that are nested inside a subreport element
        if (inSubreportRange(m.index, subreportRanges)) continue;

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

// ── References ($F/$P/$V usages and declaration-equivalent usages) ────────────

function extractReferences(text) {
    const results = [];

    // $F{} $P{} $V{} usages inside expressions
    const refRe = /\$(F|P|V)\{([\w.]+)\}/g;
    let m;
    while ((m = refRe.exec(text)) !== null) {
        results.push({ sigil: m[1], name: m[2], offset: m.index });
    }

    // <subreportParameter name="..."> — classic format subreport parameter:
    // the parameter is passed to a subreport, so it counts as used.
    const subParamRe = /<subreportParameter\s[^>]*name\s*=\s*["']([^"']+)["']/g;
    while ((m = subParamRe.exec(text)) !== null) {
        results.push({ sigil: 'P', name: m[1], offset: m.index, fromSubreport: true });
    }

    // New format: <parameter name="..."> nested inside <element kind="subreport">.
    // These pass values INTO the subreport — they are NOT declarations of THIS
    // report's parameters, so register them as "used" references for any matching
    // parameter name (prevents a false "declared but never used" warning).
    const subreportRanges = buildSubreportRanges(text);
    const nestedParamRe = /<parameter(\s[^>]*)(?:\/>|>[\s\S]*?<\/parameter>)/g;
    while ((m = nestedParamRe.exec(text)) !== null) {
        if (!inSubreportRange(m.index, subreportRanges)) continue;
        const name = attrValue(m[1] || '', 'name');
        if (name) results.push({ sigil: 'P', name, offset: m.index, fromSubreport: true });
    }

    // <returnValue toVariable="..."> — the variable is written to, counts as used
    const returnVarRe = /<returnValue\s[^>]*toVariable\s*=\s*["']([^"']+)["']/g;
    while ((m = returnVarRe.exec(text)) !== null) {
        results.push({ sigil: 'V', name: m[1], offset: m.index, fromSubreport: true });
    }

    return results;
}

// ── Outline (report structure for tree view) ──────────────────────────────────

const BANDS = [
    'title','pageHeader','columnHeader','detail','columnFooter',
    'pageFooter','lastPageFooter','summary','noData','background'
];

function extractOutline(text) {
    const nodes = [];

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

    for (const f of extractFields(text)) {
        declChildren.push({
            kind: 'field', name: `${f.name} : ${f.type}`,
            offset: f.offset, end: f.end, children: []
        });
    }

    for (const p of extractParameters(text)) {
        if (p.isSystem) continue;
        declChildren.push({
            kind: 'parameter', name: `${p.name} : ${p.type}`,
            offset: p.offset, end: p.end, children: []
        });
    }

    for (const v of extractVariables(text)) {
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

function attrValue(attrs, attrName) {
    const m = matchAttr(attrs, attrName);
    return m ? m.value : '';
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

module.exports = { parseDeclarations, clearCache, clearAllCaches };
