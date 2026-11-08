// expressionUtils.js
// Finds the JRXML expression element that the cursor is currently inside.

const { EXPRESSION_TAGS } = require('./expressionTags');
const { findReferenceToken } = require('./referenceTokens');
const { scanXml } = require('./xmlspan');
const { regions, regionAt } = require('./expressionRegions');

const scanCache = new WeakMap();

function scanOf(document) {
    const text = document.getText();
    const cached = scanCache.get(document);
    if (cached && cached.version === document.version && cached.text === text) return cached.scan;
    const scan = scanXml(text);
    scanCache.set(document, { version: document.version, text, scan });
    return scan;
}

/** The expression region at an offset, or null. */
function findExpressionRegionAt(document, offset, tags = EXPRESSION_TAGS) {
    const text = document.getText();
    const found = regions(scanOf(document), text)
        .filter(region => tags.includes(region.tag));
    return regionAt(found, offset);
}

/**
 * Find the expression element the cursor is inside.
 * Returns { tagName, expression, range } or null.
 *
 * @param {import('vscode').TextDocument} document
 * @param {import('vscode').Position} position
 */
function findExpressionAtCursor(document, position) {
    const offset = document.offsetAt(position);
    const region = findExpressionRegionAt(document, offset);

    if (!region) return null;

    return {
        tagName: region.tag,
        expression: region.expression,
        range: new (require('vscode').Range)(
            document.positionAt(region.start),
            document.positionAt(region.end)
        ),
        fullMatch: region.fullMatch,
        innerStart: region.innerStart,
        innerEnd: region.innerEnd,
    };
}

/**
 * Strip CDATA markers from expression content.
 * @param {string} text
 */
function stripCdata(text) {
    return text
        .replace(/^\s*<!\[CDATA\[/, '')
        .replace(/\]\]>\s*$/, '')
        .trim();
}

/**
 * Wrap expression back in CDATA if it originally had it.
 * @param {string} expr
 * @param {boolean} useCdata
 */
function wrapExpression(expr, useCdata) {
    if (useCdata) {
        return `<![CDATA[${expr}]]>`;
    }
    return expr;
}

/**
 * Detect whether the original tag content used CDATA.
 * @param {string} rawInner
 */
function hasCdata(rawInner) {
    return /^\s*<!\[CDATA\[/.test(rawInner);
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find a declaration whose `name` attribute contains the character offset.
 *
 * @param {{allFields?:Array,allParameters?:Array,allVariables?:Array,
 *          fields?:Array,parameters?:Array,variables?:Array}|null} parsed
 * @param {number} offset document character offset
 * @returns {{sigil:'F'|'P'|'V', name:string, declaration:object}|null}
 */
function findDeclarationAtOffset(parsed, offset) {
    if (!parsed) return null;

    const groups = [
        ['F', parsed.allFields || parsed.fields || []],
        ['P', parsed.allParameters || parsed.parameters || []],
        ['V', parsed.allVariables || parsed.variables || []],
    ];

    for (const [sigil, list] of groups) {
        for (const declaration of list) {
            if (!declaration || !declaration.name) continue;
            if (typeof declaration.nameOffset !== 'number') continue;
            if (offset >= declaration.nameOffset &&
                offset <= declaration.nameOffset + declaration.name.length) {
                return { sigil, name: declaration.name, declaration };
            }
        }
    }
    return null;
}

/**
 * Compute the replacement for the expression tag closest to `originalOffset`.
 *
 * Re-scans the live document text so a stale range from when a panel opened
 * can never apply twice. The new expression is wrapped in CDATA when the
 * original content used it.
 *
 * @param {string} text            current document text
 * @param {string} tagName         e.g. "textFieldExpression"
 * @param {number} originalOffset  character offset of the original expression tag
 * @param {string} newExpression   expression text to write inside the tag
 * @returns {{startOffset:number,endOffset:number,newTag:string,useCdata:boolean}|null}
 */
function findTagReplacement(text, tagName, originalOffset, newExpression) {
    if (!text || !tagName) return null;

    const safeTag = escapeRegExp(tagName);
    const tagPattern = new RegExp(
        `(<${safeTag}(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/${safeTag}>)`,
        'g'
    );

    let best = null;
    let bestDistance = Infinity;
    let match;

    while ((match = tagPattern.exec(text)) !== null) {
        const distance = Math.abs(match.index - originalOffset);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = { index: match.index, openTag: match[1], innerOld: match[2], closeTag: match[3] };
        }
    }

    if (!best) return null;

    const useCdata = hasCdata(best.innerOld);
    return {
        startOffset: best.index,
        endOffset: best.index + best.openTag.length + best.innerOld.length + best.closeTag.length,
        newTag: best.openTag + wrapExpression(newExpression, useCdata) + best.closeTag,
        useCdata,
    };
}

module.exports = {
    findExpressionAtCursor,
    findExpressionRegionAt,
    findTagReplacement,
    findReferenceToken,
    findDeclarationAtOffset,
    stripCdata,
    wrapExpression,
    hasCdata,
    EXPRESSION_TAGS,
};
