// expressionUtils.js
// Finds the JRXML expression element that the cursor is currently inside.

const { EXPRESSION_TAGS } = require('./expressionTags');
const { findReferenceToken } = require('./referenceTokens');

const TAG_PATTERN = new RegExp(
    `<(${EXPRESSION_TAGS.join('|')})(\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`,
    'g'
);

/**
 * Find the expression element the cursor is inside.
 * Returns { tagName, expression, range } or null.
 *
 * @param {import('vscode').TextDocument} document
 * @param {import('vscode').Position} position
 */
function findExpressionAtCursor(document, position) {
    const text = document.getText();
    const offset = document.offsetAt(position);

    TAG_PATTERN.lastIndex = 0;
    let match;

    while ((match = TAG_PATTERN.exec(text)) !== null) {
        const start = match.index;
        const end   = match.index + match[0].length;

        if (offset >= start && offset <= end) {
            const tagName   = match[1];
            const rawInner  = match[3]; // content between tags

            // Strip CDATA wrappers
            const expression = stripCdata(rawInner).trim();

            const rangeStart = document.positionAt(start);
            const rangeEnd   = document.positionAt(end);

            return {
                tagName,
                expression,
                range: new (require('vscode').Range)(rangeStart, rangeEnd),
                fullMatch: match[0],
                innerStart: start + match[0].indexOf(rawInner),
                innerEnd:   start + match[0].indexOf(rawInner) + rawInner.length
            };
        }
    }

    return null;
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
    findTagReplacement,
    findReferenceToken,
    findDeclarationAtOffset,
    stripCdata,
    wrapExpression,
    hasCdata,
    EXPRESSION_TAGS,
};
