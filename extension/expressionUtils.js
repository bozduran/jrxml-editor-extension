// expressionUtils.js
// Finds the JRXML expression element that the cursor is currently inside.

const EXPRESSION_TAGS = [
    'textFieldExpression', 'imageExpression', 'variableExpression',
    'groupExpression', 'printWhenExpression', 'initialValueExpression',
    'filterExpression', 'expression', 'jr:expression',
    'defaultValueExpression', 'anchorNameExpression',
    'hyperlinkReferenceExpression', 'hyperlinkAnchorExpression',
    'hyperlinkPageExpression', 'hyperlinkTooltipExpression',
    'labelExpression', 'connectionExpression', 'subreportExpression',
    'bucketExpression', 'sortFieldExpression', 'keyExpression',
    'valueExpression', 'seriesExpression', 'categoryExpression',
    'lowExpression', 'highExpression', 'openExpression', 'closeExpression',
    'volumeExpression', 'xValueExpression', 'yValueExpression',
    'zValueExpression', 'startDateExpression', 'endDateExpression',
    'colorExpression', 'sizeExpression', 'shapeExpression',
    'datasetExpression', 'customExpression'
];

const TAG_PATTERN = new RegExp(
    `<(${EXPRESSION_TAGS.join('|')})(\\s[^>]*)?>([\\s\\S]*?)<\\/(?:${EXPRESSION_TAGS.join('|')})>`,
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

module.exports = { findExpressionAtCursor, stripCdata, wrapExpression, hasCdata, EXPRESSION_TAGS };
