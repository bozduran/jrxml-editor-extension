// xmlRules.js
// The hook's `format` and `textcheck` fix discovery, ported to the extension.
//
// format groups (in the hook's order):
//   report name         set name="<file base name>"
//   positionType        add/set positionType="Float" on textField + subreport
//   textAdjust          add/set textAdjust="StretchHeight" on textField
//   expression formatting
// textcheck group:
//   rendered-text rules applied to <text> CDATA and to the literals inside
//   expression CDATA bodies
//
// Everything here is vscode-free and returns plain { start, end, replacement }
// edits plus the hook's exact fix descriptions.

const { scanXml } = require('./xmlspan');
const { formatExpression } = require('./javaExpr');
const { transformText, transformExpression } = require('./textRules');

const CDATA_OPEN  = '<![CDATA[';
const CDATA_CLOSE = ']]>';

// The hook's expression-element set (§11).
const EXPRESSION_ELEMENTS = new Set([
    'expression', 'defaultValueExpression', 'connectionExpression',
    'textFieldExpression', 'textExpression', 'patternExpression',
    'printWhenExpression', 'initialValueExpression', 'variableExpression',
    'groupExpression',
]);

const POSITION_TYPE_KINDS = new Set(['textField', 'subreport']);

/** Defaults mirror the hook's enabled steps. */
const DEFAULTS = {
    reportName: true,
    positionType: true,
    textAdjust: true,
    expression: true,
    textcheck: true,
};

function withDefaults(enabled) {
    return { ...DEFAULTS, ...(enabled || {}) };
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function decodeXml(value) {
    return String(value).replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, entity) => {
        switch (entity) {
            case 'amp':  return '&';
            case 'lt':   return '<';
            case 'gt':   return '>';
            case 'quot': return '"';
            case 'apos': return "'";
            default: break;
        }
        if (entity[0] === '#') {
            const cp = entity[1] === 'x' || entity[1] === 'X'
                ? parseInt(entity.slice(2), 16)
                : parseInt(entity.slice(1), 10);
            return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
        }
        return m;
    });
}

function encodeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** CDATA body of an element, or null when the element has none. */
function cdataOf(node, text) {
    const from = node.startTagEnd;
    const to = node.endTag >= 0 ? node.endTag : node.end;

    const open = text.indexOf(CDATA_OPEN, from);
    if (open < 0 || open >= to) return null;
    const start = open + CDATA_OPEN.length;

    const close = text.indexOf(CDATA_CLOSE, start);
    if (close < 0 || close >= to) return null;

    return { start, end: close, content: text.slice(start, close) };
}

/** Nearest enclosing <element> markup value (raw), or ''. */
function markupOf(node) {
    for (const ancestor of node.ancestors()) {
        if (ancestor.tag === 'element') {
            const attr = ancestor.attr('markup');
            return attr ? attr.value : '';
        }
    }
    return '';
}

/** The hook's isRenderedTextContext plus its two unconditional elements. */
function isTextContext(node) {
    for (const ancestor of node.ancestors()) {
        if (ancestor.kind === 'textField' || ancestor.kind === 'staticText') return true;
    }
    return node.tag === 'defaultValueExpression' || node.tag === 'initialValueExpression';
}

/** Insert just after the first usable anchor attribute, else after the tag name. */
function afterAttr(node, text, names) {
    for (const name of names) {
        const attr = node.attr(name);
        if (!attr) continue;
        const pos = attr.valueEnd + 1;
        if (pos < node.startTagEnd && text[pos] !== '>' && text[pos] !== '/') return pos;
    }
    return node.startTag + 1 + node.tag.length;
}

/** Insert just before the tag close (`>` or `/>`). */
function beforeClose(node, text) {
    let pos = node.startTagEnd - 1;
    if (pos > node.startTag && text[pos - 1] === '/') pos--;
    return pos;
}

// ── format step ───────────────────────────────────────────────────────────────

/**
 * @returns {{ label:string, fixes:{description:string, edit:{start:number,end:number,replacement:string}}[] }[]}
 */
function discoverFormatFixes(text, baseName, enabledInput) {
    const enabled = withDefaults(enabledInput);
    const scan = scanXml(text);
    if (scan.error) return [];

    const names = [];
    const positionTypes = [];
    const textAdjusts = [];
    const expressions = [];

    const report = scan.doc.root;

    if (enabled.reportName && report.tag === 'jasperReport') {
        const expected = baseName;
        const attr = report.attr('name');
        if (attr) {
            const current = decodeXml(attr.value);
            if (current !== expected) {
                names.push({
                    description: `set name="${expected}"`,
                    edit: { start: attr.valueStart, end: attr.valueEnd, replacement: encodeXml(expected) },
                });
            }
        } else {
            const pos = report.startTag + 1 + report.tag.length;
            names.push({
                description: `set name="${expected}"`,
                edit: { start: pos, end: pos, replacement: ` name="${encodeXml(expected)}"` },
            });
        }
    }

    for (const node of scan.doc.walk()) {
        if (node.tag === 'element') {
            const kind = node.kind;

            if (enabled.positionType && POSITION_TYPE_KINDS.has(kind)) {
                const attr = node.attr('positionType');
                if (!attr) {
                    const pos = afterAttr(node, text, ['uuid', 'kind']);
                    positionTypes.push({
                        description: 'add positionType="Float"',
                        edit: { start: pos, end: pos, replacement: ' positionType="Float"' },
                    });
                } else if (attr.valueStart === attr.valueEnd) {
                    positionTypes.push({
                        description: 'set positionType="Float"',
                        edit: { start: attr.valueStart, end: attr.valueEnd, replacement: 'Float' },
                    });
                }
            }

            if (enabled.textAdjust && kind === 'textField') {
                const attr = node.attr('textAdjust');
                if (!attr) {
                    const pos = beforeClose(node, text);
                    textAdjusts.push({
                        description: 'add textAdjust="StretchHeight"',
                        edit: { start: pos, end: pos, replacement: ' textAdjust="StretchHeight"' },
                    });
                } else if (attr.valueStart === attr.valueEnd) {
                    textAdjusts.push({
                        description: 'set textAdjust="StretchHeight"',
                        edit: { start: attr.valueStart, end: attr.valueEnd, replacement: 'StretchHeight' },
                    });
                }
            }
        }

        if (enabled.expression && EXPRESSION_ELEMENTS.has(node.tag)) {
            const cdata = cdataOf(node, text);
            if (!cdata) continue;
            const formatted = formatExpression(cdata.content);
            if (formatted !== cdata.content) {
                expressions.push({
                    description: 'format expression',
                    edit: { start: cdata.start, end: cdata.end, replacement: formatted },
                });
            }
        }
    }

    const groups = [];
    if (names.length)         groups.push({ label: 'report name', fixes: names });
    if (positionTypes.length) groups.push({ label: 'positionType', fixes: positionTypes });
    if (textAdjusts.length)   groups.push({ label: 'textAdjust', fixes: textAdjusts });
    if (expressions.length)   groups.push({ label: 'expression formatting', fixes: expressions });
    return groups;
}

// ── textcheck step ────────────────────────────────────────────────────────────

/** @returns {{ label:string, fixes:{description:string, edit:object}[] }[]} */
function discoverTextcheckFixes(text, enabledInput) {
    const enabled = withDefaults(enabledInput);
    const scan = scanXml(text);
    if (scan.error || !enabled.textcheck) return [];

    const fixes = [];

    for (const node of scan.doc.walk()) {
        const cdata = cdataOf(node, text);
        if (!cdata) continue;

        const findings = [];
        let transformed = null;

        if (node.tag === 'text') {
            transformed = transformText(cdata.content, markupOf(node), findings);
        } else if (EXPRESSION_ELEMENTS.has(node.tag)) {
            transformed = transformExpression(cdata.content, isTextContext(node), markupOf(node), findings);
        } else {
            continue;
        }

        if (transformed !== cdata.content) {
            fixes.push({
                description: findings.length ? findings.join(', ') : 'fix text',
                edit: { start: cdata.start, end: cdata.end, replacement: transformed },
            });
        }
    }

    return fixes.length ? [{ label: 'textcheck', fixes }] : [];
}

// ── Document formatting provider edits ────────────────────────────────────────

/**
 * Combined format + textcheck edits, as the hook would apply them in sequence.
 * An expression body is formatted and then text-checked in a single edit so the
 * two steps never produce overlapping ranges.
 *
 * @returns {{start:number,end:number,replacement:string}[]} ascending, non-overlapping
 */
function combinedFormatterEdits(text, baseName, enabledInput) {
    const enabled = withDefaults(enabledInput);
    const scan = scanXml(text);
    if (scan.error) return [];

    const edits = [];
    const report = scan.doc.root;

    if (enabled.reportName && report.tag === 'jasperReport') {
        const expected = baseName;
        const attr = report.attr('name');
        if (attr) {
            if (decodeXml(attr.value) !== expected) {
                edits.push({ start: attr.valueStart, end: attr.valueEnd, replacement: encodeXml(expected) });
            }
        } else {
            const pos = report.startTag + 1 + report.tag.length;
            edits.push({ start: pos, end: pos, replacement: ` name="${encodeXml(expected)}"` });
        }
    }

    for (const node of scan.doc.walk()) {
        if (node.tag === 'element') {
            if (enabled.positionType && POSITION_TYPE_KINDS.has(node.kind)) {
                const attr = node.attr('positionType');
                if (!attr) {
                    const pos = afterAttr(node, text, ['uuid', 'kind']);
                    edits.push({ start: pos, end: pos, replacement: ' positionType="Float"' });
                } else if (attr.valueStart === attr.valueEnd) {
                    edits.push({ start: attr.valueStart, end: attr.valueEnd, replacement: 'Float' });
                }
            }
            if (enabled.textAdjust && node.kind === 'textField') {
                const attr = node.attr('textAdjust');
                if (!attr) {
                    const pos = beforeClose(node, text);
                    edits.push({ start: pos, end: pos, replacement: ' textAdjust="StretchHeight"' });
                } else if (attr.valueStart === attr.valueEnd) {
                    edits.push({ start: attr.valueStart, end: attr.valueEnd, replacement: 'StretchHeight' });
                }
            }
        }

        const cdata = cdataOf(node, text);
        if (!cdata) continue;

        if (node.tag === 'text') {
            if (!enabled.textcheck) continue;
            const transformed = transformText(cdata.content, markupOf(node), []);
            if (transformed !== cdata.content) {
                edits.push({ start: cdata.start, end: cdata.end, replacement: transformed });
            }
        } else if (EXPRESSION_ELEMENTS.has(node.tag)) {
            let out = cdata.content;
            if (enabled.expression) out = formatExpression(out);
            if (enabled.textcheck) out = transformExpression(out, isTextContext(node), markupOf(node), []);
            if (out !== cdata.content) {
                edits.push({ start: cdata.start, end: cdata.end, replacement: out });
            }
        }
    }

    return edits
        .sort((a, b) => a.start - b.start || a.end - b.end)
        .filter((edit, index, all) => index === 0 || edit.start >= all[index - 1].end);
}

module.exports = {
    discoverFormatFixes,
    discoverTextcheckFixes,
    combinedFormatterEdits,
    cdataOf,
    markupOf,
    isTextContext,
    afterAttr,
    beforeClose,
    decodeXml,
    encodeXml,
    EXPRESSION_ELEMENTS,
    POSITION_TYPE_KINDS,
};
