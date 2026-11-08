// expressionRegions.js
// The expression elements of a report, derived from the XML scan tree.
//
// One region record carries the whole-element span and the content span, so the
// editor, completion and diagnostics ask the same question of the same data.

const { EXPRESSION_TAGS } = require('./expressionTags');

const REGION_TAGS = new Set([...EXPRESSION_TAGS, 'query']);

function stripExpressionContent(raw) {
    return String(raw ?? '')
        .replace(/^\s*<!\[CDATA\[/, '')
        .replace(/\]\]>\s*$/, '')
        .trim();
}

/**
 * Every expression-bearing element in document order.
 *
 * @param {{doc:object,error:string|null}} scan
 * @param {string} [text] the scanned source, used for raw spans and CDATA
 * @returns {{tag:string,start:number,end:number,innerStart:number,innerEnd:number,
 *            expression:string,contentStart:number,cdata:boolean,fullMatch:string}[]}
 */
function regions(scan, text = '') {
    if (!scan || scan.error || !scan.doc) return [];

    const source = typeof text === 'string' ? text : '';
    const found = [];

    for (const node of scan.doc.walk()) {
        if (!REGION_TAGS.has(node.tag)) continue;

        const start      = node.startTag;
        const end        = node.end;
        const innerStart = node.startTagEnd;
        const innerEnd   = node.endTag >= 0 ? node.endTag : node.end;
        const raw        = source ? source.slice(innerStart, innerEnd) : node.textContent();
        const expression = stripExpressionContent(raw);
        const index      = expression ? raw.indexOf(expression) : -1;

        found.push({
            tag: node.tag,
            start,
            end,
            innerStart,
            innerEnd,
            expression,
            contentStart: index >= 0 ? innerStart + index : innerStart,
            cdata: /^\s*<!\[CDATA\[/.test(raw),
            fullMatch: source ? source.slice(start, end) : '',
        });
    }

    return found;
}

/** The innermost region containing `offset`, or null. */
function regionAt(found, offset) {
    let best = null;
    for (const region of found || []) {
        if (offset < region.start || offset > region.end) continue;
        if (!best || (region.end - region.start) < (best.end - best.start)) best = region;
    }
    return best;
}

function forEachRegion(found, callback) {
    for (const region of found || []) callback(region);
}

module.exports = { regions, regionAt, forEachRegion };
