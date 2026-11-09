// xmlRules.ts
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

import { scanXml } from './xmlspan';
import type { XmlNode } from './xmlspan';
import { formatExpression } from './javaExpr';
import { transformText, transformExpression } from './textRules';
import type { Edit } from './edits';
import { hasRole } from './expressionTags';

const CDATA_OPEN  = '<![CDATA[';
const CDATA_CLOSE = ']]>';

const POSITION_TYPE_KINDS: ReadonlySet<string> = new Set(['textField', 'subreport']);

/** The enabled steps; absent keys fall back to the hook's defaults. */
export interface EnabledSteps {
    reportName?: boolean;
    positionType?: boolean;
    textAdjust?: boolean;
    expression?: boolean;
    textcheck?: boolean;
}

/** Defaults mirror the hook's enabled steps. */
const DEFAULTS: Required<EnabledSteps> = {
    reportName: true,
    positionType: true,
    textAdjust: true,
    expression: true,
    textcheck: true,
};

/** One discovered fix with its offset-based edit. */
export interface RuleFix {
    description: string;
    edit: Edit;
}

/** A labelled group of fixes, in the hook's group order. */
export interface RuleFixGroup {
    label: string;
    fixes: RuleFix[];
}

/** An element body span, CDATA markers excluded when present. */
export interface ContentSpan {
    start: number;
    end: number;
    content: string;
}

function withDefaults(enabled: EnabledSteps | null | undefined): Required<EnabledSteps> {
    return { ...DEFAULTS, ...(enabled || {}) };
}

// ── XML helpers ───────────────────────────────────────────────────────────────

// Single-pass entity decoding: the five named entities plus numeric references.
// Unknown or malformed references are left verbatim, matching the hook.
function decodeXml(value: string): string {
    const text = String(value);
    if (!text.includes('&')) return text;

    let out = '';
    let i = 0;
    while (i < text.length) {
        if (text[i] !== '&') { out += text[i]; i++; continue; }

        const semi = text.indexOf(';', i + 1);
        if (semi < 0 || semi - i > 12) { out += text[i]; i++; continue; }

        const name = text.slice(i + 1, semi);
        let decoded: string | null = null;
        switch (name) {
            case 'amp':  decoded = '&';  break;
            case 'lt':   decoded = '<';  break;
            case 'gt':   decoded = '>';  break;
            case 'quot': decoded = '"';  break;
            case 'apos': decoded = "'";  break;
            default: break;
        }
        if (decoded === null && name.startsWith('#')) {
            const hex = name[1] === 'x' || name[1] === 'X';
            const code = hex ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            if (Number.isInteger(code) && code >= 0 && code <= 0x10FFFF) {
                decoded = String.fromCodePoint(code);
            }
        }
        if (decoded === null) { out += text[i]; i++; continue; }

        out += decoded;
        i = semi + 1;
    }
    return out;
}

/** XML text encoding: the five entities. */
function encodeXml(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** Encoding for a double-quoted XML attribute, including whitespace controls. */
function encodeAttribute(value: string): string {
    return encodeXml(value)
        .replace(/\n/g, '&#10;')
        .replace(/\r/g, '&#13;')
        .replace(/\t/g, '&#9;');
}

/** CDATA body of an element, or null when the element has none. */
function cdataOf(node: XmlNode, text: string): ContentSpan | null {
    const from = node.startTagEnd;
    const to = node.endTag >= 0 ? node.endTag : node.end;

    const open = text.indexOf(CDATA_OPEN, from);
    if (open < 0 || open >= to) return null;
    const start = open + CDATA_OPEN.length;

    const close = text.indexOf(CDATA_CLOSE, start);
    if (close < 0 || close >= to) return null;

    return { start, end: close, content: text.slice(start, close) };
}

/** CDATA body if present, otherwise the raw element text; null when empty. */
function contentOf(node: XmlNode, text: string): ContentSpan | null {
    const cdata = cdataOf(node, text);
    if (cdata) return cdata;

    const from = node.startTagEnd;
    const to = node.endTag >= 0 ? node.endTag : node.end;
    return to > from ? { start: from, end: to, content: text.slice(from, to) } : null;
}

/** Nearest enclosing <element> markup value (raw), or ''. */
function markupOf(node: XmlNode): string {
    for (const ancestor of node.ancestors()) {
        if (ancestor.tag === 'element') {
            const attr = ancestor.attr('markup');
            return attr ? attr.value : '';
        }
    }
    return '';
}

/** The hook's isRenderedTextContext plus its two unconditional elements. */
function isTextContext(node: XmlNode): boolean {
    for (const ancestor of node.ancestors()) {
        if (ancestor.kind === 'textField' || ancestor.kind === 'staticText') return true;
    }
    return node.tag === 'defaultValueExpression' || node.tag === 'initialValueExpression';
}

/** Insert just after the first usable anchor attribute, else after the tag name. */
function afterAttr(node: XmlNode, text: string, names: readonly string[]): number {
    for (const name of names) {
        const attr = node.attr(name);
        if (!attr) continue;
        const pos = attr.valueEnd + 1;
        if (pos < node.startTagEnd && text[pos] !== '>' && text[pos] !== '/') return pos;
    }
    return node.startTag + 1 + node.tag.length;
}

/** Insert just before the tag close (`>` or `/>`). */
function beforeClose(node: XmlNode, text: string): number {
    let pos = node.startTagEnd - 1;
    if (pos > node.startTag && text[pos - 1] === '/') pos--;
    return pos;
}

// ── format step ───────────────────────────────────────────────────────────────

function discoverFormatFixes(
    text: string,
    baseName: string,
    enabledInput?: EnabledSteps | null
): RuleFixGroup[] {
    const enabled = withDefaults(enabledInput);
    const scan = scanXml(text);
    if (scan.error || !scan.doc) return [];

    const names: RuleFix[] = [];
    const positionTypes: RuleFix[] = [];
    const textAdjusts: RuleFix[] = [];
    const expressions: RuleFix[] = [];

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

        if (enabled.expression && hasRole(node.tag, 'format')) {
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

    const groups: RuleFixGroup[] = [];
    if (names.length)         groups.push({ label: 'report name', fixes: names });
    if (positionTypes.length) groups.push({ label: 'positionType', fixes: positionTypes });
    if (textAdjusts.length)   groups.push({ label: 'textAdjust', fixes: textAdjusts });
    if (expressions.length)   groups.push({ label: 'expression formatting', fixes: expressions });
    return groups;
}

// ── textcheck step ────────────────────────────────────────────────────────────

function discoverTextcheckFixes(
    text: string,
    enabledInput?: EnabledSteps | null
): RuleFixGroup[] {
    const enabled = withDefaults(enabledInput);
    const scan = scanXml(text);
    if (scan.error || !scan.doc || !enabled.textcheck) return [];

    const fixes: RuleFix[] = [];

    for (const node of scan.doc.walk()) {
        const cdata = cdataOf(node, text);
        if (!cdata) continue;

        const findings: string[] = [];
        let transformed: string;

        if (node.tag === 'text') {
            transformed = transformText(cdata.content, markupOf(node), findings);
        } else if (hasRole(node.tag, 'textcheck')) {
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
 * @returns ascending, non-overlapping edits
 */
function combinedFormatterEdits(
    text: string,
    baseName: string,
    enabledInput?: EnabledSteps | null
): Edit[] {
    const enabled = withDefaults(enabledInput);
    const scan = scanXml(text);
    if (scan.error || !scan.doc) return [];

    const edits: Edit[] = [];
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
        } else if (hasRole(node.tag, 'format') || hasRole(node.tag, 'textcheck')) {
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

export {
    discoverFormatFixes,
    discoverTextcheckFixes,
    combinedFormatterEdits,
    cdataOf,
    contentOf,
    markupOf,
    isTextContext,
    afterAttr,
    beforeClose,
    decodeXml,
    encodeXml,
    encodeAttribute,
    POSITION_TYPE_KINDS,
};
