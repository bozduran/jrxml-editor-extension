// jrxmlParser.js
// Parses a .jrxml document and extracts declarations, references, and structure.
// Results are cached per document version.

const cache = new Map();

/**
 * @typedef {{ name:string, type:string, fullType:string, description:string, offset:number, nameOffset:number, isSystem?:boolean }} Declaration
 * @typedef {{ sigil:string, name:string, offset:number }} Reference
 * @typedef {{ kind:string, name:string, offset:number, children:OutlineNode[] }} OutlineNode
 * @typedef {{ fields:Declaration[], parameters:Declaration[], variables:Declaration[], groups:Declaration[], references:Reference[], outline:OutlineNode[] }} ParseResult
 */

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

// ── Fields ────────────────────────────────────────────────────────────────────

function extractFields(text) {
    const results = [];
    const tagRe = /<field(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/field>)/g;
    let m;
    while ((m = tagRe.exec(text)) !== null) {
        const attrs  = m[1] || '';
        const inner  = m[2] || '';
        const name   = attrValue(attrs, 'name');
        const type   = attrValue(attrs, 'class') || 'java.lang.Object';
        const desc   = extractTagContent(inner, 'description').trim();
        if (!name) continue;
        const nameOffset = m.index + m[0].indexOf(`"${name}"`) + 1;
        results.push({ name, type: shortType(type), fullType: type, description: desc,
                       offset: m.index, nameOffset });
    }
    return results;
}



// ── Variables ─────────────────────────────────────────────────────────────────

function extractVariables(text) {
    const results = [];
    const tagRe = /<variable(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/variable>)/g;
    let m;
    while ((m = tagRe.exec(text)) !== null) {
        const attrs       = m[1] || '';
        const inner       = m[2] || '';
        const name        = attrValue(attrs, 'name');
        const type        = attrValue(attrs, 'class') || 'java.lang.Object';
        const resetType   = attrValue(attrs, 'resetType') || 'Report';
        const calculation = attrValue(attrs, 'calculation') || 'Nothing';
        const expr        = extractTagContent(inner, 'variableExpression')
                              .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        if (!name) continue;
        const nameOffset = m.index + m[0].indexOf(`"${name}"`) + 1;
        results.push({
            name, type: shortType(type), fullType: type,
            description: `${calculation} / reset: ${resetType}${expr ? `\n\nExpr: \`${expr}\`` : ''}`,
            offset: m.index, nameOffset,
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
        const name  = attrValue(attrs, 'name');
        if (!name) continue;
        const nameOffset = m.index + m[0].indexOf(`"${name}"`) + 1;
        results.push({ name, type: 'Group', fullType: 'Group', description: 'Report group',
                       offset: m.index, nameOffset });
    }
    return results;
}

// ── References ($F/$P/$V usages inside expressions) ───────────────────────────

function extractReferences(text) {
    const results = [];

    // $F{} $P{} $V{} usages inside expressions
    const refRe = /\$(F|P|V)\{([\w.]+)\}/g;
    let m;
    while ((m = refRe.exec(text)) !== null) {
        results.push({ sigil: m[1], name: m[2], offset: m.index });
    }

    // <subreportParameter name="..."> — classic format subreport parameter
    const subParamRe = /<subreportParameter\s[^>]*name\s*=\s*["']([^"']+)["']/g;
    while ((m = subParamRe.exec(text)) !== null) {
        results.push({ sigil: 'P', name: m[1], offset: m.index, fromSubreport: true });
    }

    // New format: <parameter name="..."> nested inside <element kind="subreport">
    // These pass values INTO the subreport — they are NOT declarations of THIS report's
    // parameters, so we register them as "used" references for any matching param name.
    const subreportRanges = buildSubreportRanges(text);
    const nestedParamRe = /<parameter(\s[^>]*)(?:\/>|>[\s\S]*?<\/parameter>)/g;
    while ((m = nestedParamRe.exec(text)) !== null) {
        if (!inSubreportRange(m.index, subreportRanges)) continue;
        const name = attrValue(m[1] || '', 'name');
        if (name) results.push({ sigil: 'P', name, offset: m.index, fromSubreport: true });
    }

    // <returnValue toVariable="..."> — variable is written to, counts as used
    const returnVarRe = /<returnValue\s[^>]*toVariable\s*=\s*["']([^"']+)["']/g;
    while ((m = returnVarRe.exec(text)) !== null) {
        results.push({ sigil: 'V', name: m[1], offset: m.index, fromSubreport: true });
    }

    return results;
}

// ── Outline (report structure for tree view) ──────────────────────────────────

function extractOutline(text) {
    const nodes = [];

    // Report name
    const reportMatch = text.match(/<jasperReport[^>]*\sname="([^"]+)"/);
    const reportName  = reportMatch ? reportMatch[1] : 'Report';

    // Top-level report node
    const reportNode = { kind: 'report', name: reportName, offset: reportMatch ? reportMatch.index : 0, children: [] };

    // ── Declarations group ────────────────────────────────────────────────────
    const declNode = { kind: 'group', name: 'Declarations', offset: 0, children: [] };

    const fields = extractFields(text);
    fields.forEach(f => declNode.children.push({
        kind: 'field', name: `${f.name} : ${f.type}`, offset: f.offset, children: []
    }));

    const params = extractParameters(text).filter(p => !p.isSystem);
    params.forEach(p => declNode.children.push({
        kind: 'parameter', name: `${p.name} : ${p.type}`, offset: p.offset, children: []
    }));

    const vars = extractVariables(text);
    vars.forEach(v => declNode.children.push({
        kind: 'variable', name: `${v.name} : ${v.type}`, offset: v.offset, children: []
    }));

    if (declNode.children.length > 0) reportNode.children.push(declNode);

    // ── Bands ─────────────────────────────────────────────────────────────────
    const BANDS = [
        'title','pageHeader','columnHeader','detail','columnFooter',
        'pageFooter','lastPageFooter','summary','noData','background'
    ];

    for (const band of BANDS) {
        const bandRe = new RegExp(`<${band}[\\s>]`, 'g');
        let bm;
        while ((bm = bandRe.exec(text)) !== null) {
            const bandNode = { kind: 'band', name: band, offset: bm.index, children: [] };

            // Find textField / staticText / image elements inside this band
            // Approximate: scan between this band tag and the next </band>
            const bandEnd = text.indexOf(`</${band}>`, bm.index);
            if (bandEnd === -1) continue;
            const bandText = text.slice(bm.index, bandEnd);

            // textField expressions
            const tfRe = /<textField[^>]*>/g;
            let tfm;
            let tfIdx = 0;
            while ((tfm = tfRe.exec(bandText)) !== null) {
                tfIdx++;
                // Try to extract the expression for a label
                const exprMatch = bandText.slice(tfm.index).match(/<textFieldExpression[^>]*>(?:<!\[CDATA\[)?([\s\S]{0,80})(?:\]\]>)?<\/textFieldExpression>/);
                const label = exprMatch ? exprMatch[1].trim().slice(0, 60) : `textField #${tfIdx}`;
                bandNode.children.push({
                    kind: 'textField', name: label, offset: bm.index + tfm.index, children: []
                });
            }

            reportNode.children.push(bandNode);
        }
    }

    // ── Groups ────────────────────────────────────────────────────────────────
    const groups = extractGroups(text);
    groups.forEach(g => {
        reportNode.children.push({ kind: 'group', name: `Group: ${g.name}`, offset: g.offset, children: [] });
    });

    nodes.push(reportNode);
    return nodes;
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function attrValue(attrs, name) {
    const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`);
    const m  = re.exec(attrs);
    return m ? m[1] : '';
}

function extractTagContent(inner, tagName) {
    const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`);
    const m  = re.exec(inner);
    return m ? m[1] : '';
}

function shortType(fullType) {
    if (!fullType) return 'Object';
    const last   = fullType.split('.').pop();
    const common = new Set(['String','Integer','Long','Double','Float','Boolean',
                            'Byte','Short','Character','BigDecimal','BigInteger',
                            'Date','Object','Number','List','Map','Collection']);
    return common.has(last) ? last : fullType;
}

module.exports = { parseDeclarations };// ── Parameters ────────────────────────────────────────────────────────────────

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
                if (text.startsWith('<element', k) && (text[k + 8] === ' ' || text[k + 8] === '\n' || text[k + 8] === '\r' || text[k + 8] === '>')) {
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

function extractParameters(text) {
    const results = [];
    const subreportRanges = buildSubreportRanges(text);

    const tagRe = /<parameter(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/parameter>)/g;
    let m;
    while ((m = tagRe.exec(text)) !== null) {
        // Skip parameters that are nested inside a subreport element
        if (inSubreportRange(m.index, subreportRanges)) continue;

        const attrs     = m[1] || '';
        const inner     = m[2] || '';
        const name      = attrValue(attrs, 'name');
        const type      = attrValue(attrs, 'class') || 'java.lang.Object';
        const forPrompt = attrValue(attrs, 'isForPrompting');
        const defVal    = extractTagContent(inner, 'defaultValueExpression')
                            .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        if (!name) continue;
        const nameOffset = m.index + m[0].indexOf(`"${name}"`) + 1;
        results.push({
            name, type: shortType(type), fullType: type,
            description: defVal ? `Default: ${defVal}` : (forPrompt === 'false' ? 'System parameter' : 'User parameter'),
            isSystem: forPrompt === 'false',
            offset: m.index, nameOffset,
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
        const attrs       = m[1] || '';
        const inner       = m[2] || '';
        const name        = attrValue(attrs, 'name');
        const type        = attrValue(attrs, 'class') || 'java.lang.Object';
        const resetType   = attrValue(attrs, 'resetType') || 'Report';
        const calculation = attrValue(attrs, 'calculation') || 'Nothing';
        const expr        = extractTagContent(inner, 'variableExpression')
                              .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        if (!name) continue;
        const nameOffset = m.index + m[0].indexOf(`"${name}"`) + 1;
        results.push({
            name, type: shortType(type), fullType: type,
            description: `${calculation} / reset: ${resetType}${expr ? `\n\nExpr: \`${expr}\`` : ''}`,
            offset: m.index, nameOffset,
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
        const name  = attrValue(attrs, 'name');
        if (!name) continue;
        const nameOffset = m.index + m[0].indexOf(`"${name}"`) + 1;
        results.push({ name, type: 'Group', fullType: 'Group', description: 'Report group',
                       offset: m.index, nameOffset });
    }
    return results;
}

// ── References ($F/$P/$V usages inside expressions) ───────────────────────────

function extractReferences(text) {
    const results = [];

    // $F{} $P{} $V{} usages inside expressions
    const refRe = /\$(F|P|V)\{([\w.]+)\}/g;
    let m;
    while ((m = refRe.exec(text)) !== null) {
        results.push({ sigil: m[1], name: m[2], offset: m.index });
    }

    // <subreportParameter name="..."> — the parameter is being PASSED to a
    // subreport so it counts as "used" even if not in a $P{} expression.
    const subParamRe = /<subreportParameter\s[^>]*name\s*=\s*["']([^"']+)["']/g;
    while ((m = subParamRe.exec(text)) !== null) {
        // Synthesise a $P usage at this offset so unused-check won't fire
        results.push({ sigil: 'P', name: m[1], offset: m.index, fromSubreport: true });
    }

    // <returnValue toVariable="..."> — variable is written to, counts as used
    const returnVarRe = /<returnValue\s[^>]*toVariable\s*=\s*["']([^"']+)["']/g;
    while ((m = returnVarRe.exec(text)) !== null) {
        results.push({ sigil: 'V', name: m[1], offset: m.index, fromSubreport: true });
    }

    return results;
}

// ── Outline (report structure for tree view) ──────────────────────────────────

function extractOutline(text) {
    const nodes = [];

    // Report name
    const reportMatch = text.match(/<jasperReport[^>]*\sname="([^"]+)"/);
    const reportName  = reportMatch ? reportMatch[1] : 'Report';

    // Top-level report node
    const reportNode = { kind: 'report', name: reportName, offset: reportMatch ? reportMatch.index : 0, children: [] };

    // ── Declarations group ────────────────────────────────────────────────────
    const declNode = { kind: 'group', name: 'Declarations', offset: 0, children: [] };

    const fields = extractFields(text);
    fields.forEach(f => declNode.children.push({
        kind: 'field', name: `${f.name} : ${f.type}`, offset: f.offset, children: []
    }));

    const params = extractParameters(text).filter(p => !p.isSystem);
    params.forEach(p => declNode.children.push({
        kind: 'parameter', name: `${p.name} : ${p.type}`, offset: p.offset, children: []
    }));

    const vars = extractVariables(text);
    vars.forEach(v => declNode.children.push({
        kind: 'variable', name: `${v.name} : ${v.type}`, offset: v.offset, children: []
    }));

    if (declNode.children.length > 0) reportNode.children.push(declNode);

    // ── Bands ─────────────────────────────────────────────────────────────────
    const BANDS = [
        'title','pageHeader','columnHeader','detail','columnFooter',
        'pageFooter','lastPageFooter','summary','noData','background'
    ];

    for (const band of BANDS) {
        const bandRe = new RegExp(`<${band}[\\s>]`, 'g');
        let bm;
        while ((bm = bandRe.exec(text)) !== null) {
            const bandNode = { kind: 'band', name: band, offset: bm.index, children: [] };

            // Find textField / staticText / image elements inside this band
            // Approximate: scan between this band tag and the next </band>
            const bandEnd = text.indexOf(`</${band}>`, bm.index);
            if (bandEnd === -1) continue;
            const bandText = text.slice(bm.index, bandEnd);

            // textField expressions
            const tfRe = /<textField[^>]*>/g;
            let tfm;
            let tfIdx = 0;
            while ((tfm = tfRe.exec(bandText)) !== null) {
                tfIdx++;
                // Try to extract the expression for a label
                const exprMatch = bandText.slice(tfm.index).match(/<textFieldExpression[^>]*>(?:<!\[CDATA\[)?([\s\S]{0,80})(?:\]\]>)?<\/textFieldExpression>/);
                const label = exprMatch ? exprMatch[1].trim().slice(0, 60) : `textField #${tfIdx}`;
                bandNode.children.push({
                    kind: 'textField', name: label, offset: bm.index + tfm.index, children: []
                });
            }

            reportNode.children.push(bandNode);
        }
    }

    // ── Groups ────────────────────────────────────────────────────────────────
    const groups = extractGroups(text);
    groups.forEach(g => {
        reportNode.children.push({ kind: 'group', name: `Group: ${g.name}`, offset: g.offset, children: [] });
    });

    nodes.push(reportNode);
    return nodes;
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function attrValue(attrs, name) {
    const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`);
    const m  = re.exec(attrs);
    return m ? m[1] : '';
}

function extractTagContent(inner, tagName) {
    const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`);
    const m  = re.exec(inner);
    return m ? m[1] : '';
}

function shortType(fullType) {
    if (!fullType) return 'Object';
    const last   = fullType.split('.').pop();
    const common = new Set(['String','Integer','Long','Double','Float','Boolean',
                            'Byte','Short','Character','BigDecimal','BigInteger',
                            'Date','Object','Number','List','Map','Collection']);
    return common.has(last) ? last : fullType;
}

module.exports = { parseDeclarations };
