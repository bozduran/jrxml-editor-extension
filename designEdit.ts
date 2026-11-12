// designEdit.ts
// Pure, vscode-free builder for design-view edits.
//
// The webview sends an element offset (its start-tag offset from the design
// model) and a patch. This module re-scans the live text, locates the element by
// that offset, and returns non-overlapping offset edits for geometry, visual
// properties and text/expression content.
//
// WorkspaceEdit ranges are built by the host from these edits, so one call is
// one undoable edit. No formatting or unrelated source is touched.

import { scanXml, nodeStartingAt, attrInsertOffset } from './xmlspan';
import type { XmlNode, XmlTextNode } from './xmlspan';
import { findOverlap } from './edits';
import type { Edit } from './edits';
import {
    MAX_CONTENT,
    CONTENT_TAG_BY_KIND,
    CONTENT_KINDS,
    EXPRESSION_CONTENT_TAGS,
    PROPERTY_SPECS,
    localName,
    attrValue,
    directChild,
    numericAttr,
    escapeXmlAttr,
    escapeXmlText,
} from './designSpec';
import type { ContentKind, DesignPropertyName, PropertySpec } from './designSpec';

const MAX_GEOMETRY = 100000;

const GEOMETRY_FIELDS = ['x', 'y', 'width', 'height'];
const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const LINE_STYLES = ['Solid', 'Dashed', 'Dotted', 'Double'];

/** The result of one design-view patch: non-overlapping edits or an error. */
export interface ElementPatchResult {
    edits: Edit[];
    error: string | null;
}

/** Geometry values are validated at apply time (the webview may send anything). */
interface GeometryPatch {
    [field: string]: unknown;
}

interface ContentPatch {
    text: string;
}

interface AttributesPatch {
    set?: Record<string, string>;
    remove?: string[];
}

interface BoxPatch {
    border?: boolean;
    padding?: number;
    width?: number;
    style?: string;
    color?: string;
}

interface LinePatch {
    width?: number;
    style?: string;
    color?: string;
}

interface PatchRequest {
    geometry?: GeometryPatch;
    properties?: Record<string, unknown>;
    content?: ContentPatch;
    attributes?: AttributesPatch;
    box?: BoxPatch;
    line?: LinePatch;
}

interface CanonicalProperty {
    value: string | null;
    error: string | null;
}

/**
 * Build source edits for one design-view patch. The patch may carry geometry,
 * properties, content, attributes, box and line changes.
 */
export function buildElementPatch(text: string, elementOffset: number, patch: unknown): ElementPatchResult {
    if (typeof text !== 'string') return fail('The report text is not available.');
    if (!Number.isInteger(elementOffset)) return fail('The selected element is not valid.');

    const patchError = validatePatch(patch);
    if (patchError) return fail(patchError);

    // validatePatch has checked every field read below; the cast records that.
    const request = patch as PatchRequest;

    const scan = scanXml(text);
    if (scan.error || !scan.doc) {
        return fail('The report is not well-formed XML, so nothing was edited.');
    }

    const node = nodeStartingAt(scan.doc.root, elementOffset);
    if (!node || localName(node.tag) !== 'element') {
        return fail('This element was moved or the file changed. Refresh the view and try again.');
    }

    const edits: Edit[] = [];
    const insertions: string[] = [];

    if (request.geometry) {
        const error = applyGeometry(node, request.geometry, edits, insertions);
        if (error) return fail(error);
    }

    if (request.properties) {
        const error = applyProperties(node, request.properties, edits, insertions);
        if (error) return fail(error);
    }

    if (request.attributes) {
        const error = applyAttributes(text, node, request.attributes, edits, insertions);
        if (error) return fail(error);
    }

    if (request.content) {
        const error = applyContent(text, node, request.content.text, edits, insertions);
        if (error) return fail(error);
    }

    if (request.box) {
        const error = applyBox(text, node, request.box, edits, insertions);
        if (error) return fail(error);
    }

    if (request.line) {
        const error = applyLine(text, node, request.line, edits, insertions);
        if (error) return fail(error);
    }

    if (insertions.length > 0) {
        edits.push({
            start:       attrInsertOffset(node),
            end:         attrInsertOffset(node),
            replacement: insertions.join(''),
        });
    }

    if (edits.length === 0) return { edits: [], error: null };

    const overlap = findOverlap(edits);
    if (overlap) {
        return fail('The requested changes overlap; nothing was edited. Apply them one at a time.');
    }

    edits.sort((a, b) => a.start - b.start || a.end - b.end);
    return { edits, error: null };
}

// ── Patch validation ────────────────────────────────────────────────────────

function validatePatch(patch: unknown): string | null {
    if (!isPlainObject(patch)) {
        return 'The edit request is not valid.';
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) return 'There is nothing to apply.';

    const allowed = new Set(['geometry', 'properties', 'content', 'attributes', 'box', 'line']);
    for (const key of keys) {
        if (!allowed.has(key)) return `Unknown edit type: ${key}.`;
    }

    const geometry = patch.geometry;
    if (geometry !== undefined) {
        if (!isPlainObject(geometry)) return 'The geometry values are not valid.';
        for (const key of Object.keys(geometry)) {
            if (!GEOMETRY_FIELDS.includes(key)) return `Unknown geometry field: ${key}.`;
        }
    }

    const properties = patch.properties;
    if (properties !== undefined) {
        if (!isPlainObject(properties)) return 'The property values are not valid.';
        for (const key of Object.keys(properties)) {
            if (!isPropertyName(key)) return `Unknown property: ${key}.`;
        }
    }

    const content = patch.content;
    if (content !== undefined) {
        if (!isPlainObject(content) || typeof content.text !== 'string') {
            return 'The content value is not valid.';
        }
        for (const key of Object.keys(content)) {
            if (key !== 'text') return `Unknown content field: ${key}.`;
        }
    }

    if (patch.attributes !== undefined) {
        const error = validateAttributesPatch(patch.attributes);
        if (error) return error;
    }

    if (patch.box !== undefined) {
        const error = validateBoxPatch(patch.box);
        if (error) return error;
    }

    if (patch.line !== undefined) {
        const error = validateLinePatch(patch.line);
        if (error) return error;
    }

    return null;
}

function validateAttributesPatch(attributes: unknown): string | null {
    if (!isPlainObject(attributes)) return 'The attribute values are not valid.';

    for (const key of Object.keys(attributes)) {
        if (key !== 'set' && key !== 'remove') return `Unknown attribute edit: ${key}.`;
    }

    const set = attributes.set;
    const remove = attributes.remove;

    if (set !== undefined) {
        if (!isPlainObject(set)) return 'The attribute values are not valid.';
        for (const [name, value] of Object.entries(set)) {
            const nameError = validateAttributeName(name);
            if (nameError) return nameError;
            if (typeof value !== 'string') return `Attribute ${name} must be a string.`;
        }
    }

    if (remove !== undefined) {
        if (!Array.isArray(remove)) return 'The attributes to remove are not valid.';
        for (const name of remove) {
            if (typeof name !== 'string') return 'Attribute names must be strings.';
            const nameError = validateAttributeName(name);
            if (nameError) return nameError;
        }
    }

    if (set && Array.isArray(remove)) {
        for (const name of remove) {
            if (typeof name === 'string' && Object.prototype.hasOwnProperty.call(set, name)) {
                return `Attribute ${name} cannot be set and removed at once.`;
            }
        }
    }

    const setEmpty = !isPlainObject(set) || Object.keys(set).length === 0;
    const removeEmpty = !Array.isArray(remove) || remove.length === 0;
    if (setEmpty && removeEmpty) {
        return 'There is nothing to apply.';
    }
    return null;
}

function validateAttributeName(name: unknown): string | null {
    const text = String(name ?? '');
    if (!ATTRIBUTE_NAME.test(text)) return `Attribute name ${text} is not valid.`;
    if (text.toLowerCase() === 'kind') return 'The element kind cannot be changed from the inspector.';
    if (text.toLowerCase() === 'xmlns' || text.toLowerCase().startsWith('xmlns:')) {
        return 'Namespace attributes cannot be changed from the inspector.';
    }
    return null;
}

function validateBoxPatch(box: unknown): string | null {
    if (!isPlainObject(box)) return 'The box values are not valid.';
    const allowed = new Set(['border', 'padding', 'width', 'style', 'color']);
    for (const key of Object.keys(box)) {
        if (!allowed.has(key)) return `Unknown box field: ${key}.`;
    }

    const border = box.border;
    if (border !== undefined && typeof border !== 'boolean') {
        return 'The border value must be true or false.';
    }

    const padding = box.padding;
    if (padding !== undefined && (!Number.isFinite(padding) || Number(padding) < 0)) {
        return 'Padding must be a non-negative number.';
    }

    const width = box.width;
    if (width !== undefined && (!Number.isFinite(width) || Number(width) <= 0 || Number(width) > 100)) {
        return 'Border width must be between 0 and 100.';
    }

    const style = box.style;
    if (style !== undefined && !normalizedEnum(LINE_STYLES, style)) {
        return `Line style must be one of: ${LINE_STYLES.join(', ')}.`;
    }

    const color = box.color;
    if (color !== undefined && color !== '' && !isHexColor(color)) {
        return 'Colors must be written as #rgb, #rrggbb or #rrggbbaa.';
    }
    return null;
}

function validateLinePatch(line: unknown): string | null {
    if (!isPlainObject(line)) return 'The line values are not valid.';
    const allowed = new Set(['width', 'style', 'color']);
    for (const key of Object.keys(line)) {
        if (!allowed.has(key)) return `Unknown line field: ${key}.`;
    }

    const width = line.width;
    if (width !== undefined && (!Number.isFinite(width) || Number(width) <= 0 || Number(width) > 100)) {
        return 'Line width must be between 0 and 100.';
    }

    const style = line.style;
    if (style !== undefined && !normalizedEnum(LINE_STYLES, style)) {
        return `Line style must be one of: ${LINE_STYLES.join(', ')}.`;
    }

    const color = line.color;
    if (color !== undefined && color !== '' && !isHexColor(color)) {
        return 'Colors must be written as #rgb, #rrggbb or #rrggbbaa.';
    }
    return null;
}

// ── Geometry ────────────────────────────────────────────────────────────────

function applyGeometry(
    node: XmlNode,
    geometry: GeometryPatch,
    edits: Edit[],
    insertions: string[]
): string | null {
    for (const field of GEOMETRY_FIELDS) {
        if (!(field in geometry)) continue;

        const raw = geometry[field];
        if (!Number.isFinite(raw)) return `The ${field} value must be a number.`;

        let value = Math.round(Number(raw));
        if (!Number.isFinite(value)) return `The ${field} value must be a number.`;
        if (field === 'width' || field === 'height') {
            value = Math.max(1, Math.min(MAX_GEOMETRY, value));
        } else {
            value = Math.max(0, Math.min(MAX_GEOMETRY, value));
        }

        planAttribute(node, field, String(value), edits, insertions);
    }
    return null;
}

// ── Properties ──────────────────────────────────────────────────────────────

function applyProperties(
    node: XmlNode,
    properties: Record<string, unknown>,
    edits: Edit[],
    insertions: string[]
): string | null {
    for (const key of Object.keys(properties)) {
        if (!isPropertyName(key)) return `Unknown property: ${key}.`;
        const spec: PropertySpec = PROPERTY_SPECS[key];

        const canonical = canonicalProperty(spec, properties[key]);
        if (canonical.error) return canonical.error;
        if (canonical.value === null) return `The ${key} value is not valid.`;

        planAttribute(node, key, canonical.value, edits, insertions);
    }
    return null;
}

function canonicalProperty(spec: PropertySpec, value: unknown): CanonicalProperty {
    switch (spec.type) {
        case 'fontName': {
            const name = String(value ?? '').trim();
            if (!name) return { value: null, error: 'Font name cannot be empty.' };
            if (name.length > 120) return { value: null, error: 'Font name is too long.' };
            if (/[\u0000-\u001f]/.test(name)) return { value: null, error: 'Font name contains invalid characters.' };
            return { value: escapeXmlAttr(name), error: null };
        }

        case 'fontSize': {
            const size = Number(value);
            if (!Number.isFinite(size) || size <= 0 || size > 999) {
                return { value: null, error: 'Font size must be a number between 0 and 999.' };
            }
            return { value: String(Math.round(size * 100) / 100), error: null };
        }

        case 'boolean':
            if (typeof value !== 'boolean') return { value: null, error: 'Boolean properties must be true or false.' };
            return { value: value ? 'true' : 'false', error: null };

        case 'color': {
            const color = String(value ?? '').trim();
            if (!isHexColor(color)) {
                return { value: null, error: 'Colors must be written as #rgb, #rrggbb or #rrggbbaa.' };
            }
            return { value: color, error: null };
        }

        case 'enum': {
            const match = normalizedEnum(spec.values, value);
            if (!match) return { value: null, error: `Allowed values: ${spec.values.join(', ')}.` };
            return { value: match, error: null };
        }

        case 'text': {
            const text = String(value ?? '').trim();
            if (!text) return { value: null, error: 'This value cannot be empty.' };
            if (text.length > 500) return { value: null, error: 'This value is too long.' };
            if (/[\u0000-\u001f]/.test(text)) return { value: null, error: 'The value contains invalid characters.' };
            return { value: escapeXmlAttr(text), error: null };
        }

        case 'rawString': {
            const text = String(value ?? '');
            if (text.length > 1000) return { value: null, error: 'This value is too long.' };
            return { value: escapeXmlAttr(text), error: null };
        }

        case 'integer': {
            const number = Number(value);
            if (!Number.isFinite(number)) return { value: null, error: 'This value must be a number.' };
            const rounded = Math.round(number);
            if (rounded < spec.min || rounded > spec.max) {
                return { value: null, error: `This value must be between ${spec.min} and ${spec.max}.` };
            }
            return { value: String(rounded), error: null };
        }

        default:
            return { value: null, error: 'Unsupported property.' };
    }
}

function normalizedEnum(values: readonly string[], value: unknown): string | null {
    const text = String(value ?? '').trim();
    return values.find(allowed => allowed.toLowerCase() === text.toLowerCase()) || null;
}

function isHexColor(value: unknown): boolean {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(value ?? '').trim());
}

// ── Free-form attributes ────────────────────────────────────────────────────

function applyAttributes(
    text: string,
    node: XmlNode,
    attributes: AttributesPatch,
    edits: Edit[],
    insertions: string[]
): string | null {
    const set = attributes.set || {};

    for (const [name, value] of Object.entries(set)) {
        planAttribute(node, name, escapeXmlAttr(value), edits, insertions);
    }

    for (const name of attributes.remove || []) {
        planAttributeRemoval(node, name, text, edits);
    }
    return null;
}

function planAttributeRemoval(node: XmlNode, name: string, text: string, edits: Edit[]): void {
    const attr = node.attr(name);
    if (!attr) return;

    let start = attr.nameStart;
    while (start > 0 && /\s/.test(text[start - 1])) start--;
    edits.push({ start, end: attr.valueEnd, replacement: '' });
}

// ── Box (border + padding) ──────────────────────────────────────────────────

function applyBox(
    text: string,
    node: XmlNode,
    patch: BoxPatch,
    edits: Edit[],
    insertions: string[]
): string | null {
    const existing = directChild(node, 'box');
    const existingPen = existing ? firstPen(existing) : null;
    const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(patch, key);

    if (existing) {
        const unsupported = existing.children.filter(child => !isPenTag(localName(child.tag)));
        if (unsupported.length > 0) {
            return 'This box contains nested elements that cannot be edited here.';
        }
    }

    const border   = has('border') ? patch.border : !!existingPen;
    const padding  = has('padding')
        ? Math.max(0, Math.round(Number(patch.padding)))
        : (existing ? numericAttr(existing, 'padding', 0) : 0);
    const width    = has('width')
        ? Math.round(Number(patch.width) * 100) / 100
        : (existingPen ? numericAttr(existingPen, 'lineWidth', 1) : 1);
    const style    = normalizedEnum(
        LINE_STYLES,
        has('style') ? patch.style : (existingPen ? attrValue(existingPen, 'lineStyle') : 'Solid')
    ) || 'Solid';
    const color    = has('color')
        ? String(patch.color || '').trim()
        : (existingPen ? String(attrValue(existingPen, 'lineColor') || '') : '');

    const attrs: { name: string; value: string }[] = [];
    if (existing) {
        for (const attr of existing.attrList) {
            if (attr.name === 'padding' && has('padding')) continue;
            attrs.push({ name: attr.name, value: rebuildAttrValue(attr.value) });
        }
    }
    if (padding > 0 && !attrs.some(attr => attr.name === 'padding')) {
        attrs.push({ name: 'padding', value: String(padding) });
    }

    const penMarkup = border
        ? `<pen lineWidth="${formatNumber(width)}" lineStyle="${style}"${color ? ` lineColor="${color}"` : ''}/>`
        : '';

    let markup = '';
    if (attrs.length > 0 || penMarkup) {
        const attrText = attrs.map(attr => ` ${attr.name}="${attr.value}"`).join('');
        markup = penMarkup
            ? `<box${attrText}>${penMarkup}</box>`
            : `<box${attrText}/>`;
    }

    if (existing) {
        const current = text.slice(existing.startTag, existing.end);
        if (current === markup) return null;

        edits.push({
            start:       existing.startTag,
            end:         existing.end,
            replacement: markup,
        });
        return null;
    }

    if (!markup) return null;
    return insertChild(text, node, markup, edits, insertions);
}

function firstPen(boxNode: XmlNode): XmlNode | null {
    for (const child of boxNode.children) {
        if (isPenTag(localName(child.tag))) return child;
    }
    return null;
}

function isPenTag(tag: string): boolean {
    return tag === 'pen' || tag === 'toppen' || tag === 'rightpen' ||
        tag === 'bottompen' || tag === 'leftpen';
}

function rebuildAttrValue(value: string): string {
    return String(value).replace(/"/g, '&quot;');
}

// ── Line pen ────────────────────────────────────────────────────────────────

function applyLine(
    text: string,
    node: XmlNode,
    patch: LinePatch,
    edits: Edit[],
    insertions: string[]
): string | null {
    const existing = directChild(node, 'pen');
    const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(patch, key);

    const width = has('width')
        ? Math.round(Number(patch.width) * 100) / 100
        : (existing ? numericAttr(existing, 'lineWidth', 1) : 1);
    const style = normalizedEnum(
        LINE_STYLES,
        has('style') ? patch.style : (existing ? attrValue(existing, 'lineStyle') : 'Solid')
    ) || 'Solid';
    const color = has('color')
        ? String(patch.color || '').trim()
        : (existing ? String(attrValue(existing, 'lineColor') || '') : '');

    const markup = `<pen lineWidth="${formatNumber(width)}" lineStyle="${style}"${color ? ` lineColor="${color}"` : ''}/>`;

    if (existing) {
        if (text.slice(existing.startTag, existing.end) === markup) return null;
        edits.push({ start: existing.startTag, end: existing.end, replacement: markup });
        return null;
    }

    return insertChild(text, node, markup, edits, insertions);
}

// ── Content ─────────────────────────────────────────────────────────────────

function applyContent(
    text: string,
    node: XmlNode,
    value: string,
    edits: Edit[],
    insertions: string[]
): string | null {
    if (value.length > MAX_CONTENT) {
        return `The content is longer than ${MAX_CONTENT} characters; edit it in the source.`;
    }

    const kind = String(node.attrValue('kind') || '').toLowerCase();
    const expectedTag = contentTagFor(kind);
    if (!expectedTag) return 'This element does not have editable content.';

    const contentNode = findContentNode(node, expectedTag);

    if (!contentNode) {
        const insertion = `<${expectedTag}><![CDATA[${splitCdata(value)}]]></${expectedTag}>`;

        if (node.selfClosing) {
            if (node.endTag !== -1) return 'This element cannot be edited.';

            const prefix = text.slice(node.startTag, node.startTagEnd - 2);
            const extra  = insertions.join('');
            const openTag = prefix + extra + '>';
            edits.push({
                start:       node.startTag,
                end:         node.startTagEnd,
                replacement: `${openTag}${insertion}</${node.tag}>`,
            });
            insertions.length = 0;
        } else {
            if (node.endTag === -1) return 'This element cannot be edited.';
            edits.push({
                start:       node.endTag,
                end:         node.endTag,
                replacement: insertion,
            });
        }
        return null;
    }

    if (contentNode.children.length > 0) {
        return 'This content contains nested markup; edit it in the source.';
    }

    const textNodes: XmlTextNode[] = [];
    for (const descendant of contentNode.walk()) {
        for (const textNode of descendant.textNodes) textNodes.push(textNode);
    }
    const meaningful = textNodes.filter(textNode => textNode.text.trim() !== '');
    const hasCdata   = meaningful.some(textNode => textNode.cdata);
    const hasPlain   = meaningful.some(textNode => !textNode.cdata);
    if (hasCdata && hasPlain) {
        return 'This content mixes CDATA and plain text; edit it in the source.';
    }

    const cdata = meaningful.length === 0 ? true : !hasPlain;
    const inner = cdata
        ? `<![CDATA[${splitCdata(value)}]]>`
        : escapeXmlText(value);

    if (contentNode.selfClosing) {
        const prefix = text.slice(contentNode.startTag, contentNode.startTagEnd - 2);
        edits.push({
            start:       contentNode.startTag,
            end:         contentNode.startTagEnd,
            replacement: `${prefix}>${inner}</${contentNode.tag}>`,
        });
        return null;
    }

    if (contentNode.endTag === -1) return 'This content cannot be located.';
    edits.push({
        start:       contentNode.startTagEnd,
        end:         contentNode.endTag,
        replacement: inner,
    });
    return null;
}

function contentTagFor(kind: string): string | undefined {
    if (!isContentKind(kind)) return undefined;
    return CONTENT_TAG_BY_KIND[kind];
}

function isContentKind(value: string): value is ContentKind {
    return CONTENT_KINDS.has(value);
}

function isPropertyName(value: string): value is DesignPropertyName {
    return Object.prototype.hasOwnProperty.call(PROPERTY_SPECS, value);
}

function findContentNode(node: XmlNode, expectedTag: string): XmlNode | null {
    const wanted = expectedTag === 'expression'
        ? EXPRESSION_CONTENT_TAGS
        : [expectedTag];

    for (const child of node.children) {
        if (wanted.includes(localName(child.tag))) return child;
    }
    return null;
}

// ── Attribute planning ──────────────────────────────────────────────────────

function planAttribute(node: XmlNode, name: string, value: string, edits: Edit[], insertions: string[]): void {
    const attr = node.attr(name);

    if (attr) {
        if (attr.value === value) return;
        edits.push({ start: attr.valueStart, end: attr.valueEnd, replacement: value });
        return;
    }
    insertions.push(` ${name}="${value}"`);
}

/** Insert `markup` before the element's closing tag, opening self-closing tags. */
function insertChild(
    text: string,
    node: XmlNode,
    markup: string,
    edits: Edit[],
    insertions: string[]
): string | null {
    if (node.selfClosing) {
        if (node.endTag !== -1) return 'This element cannot be edited.';

        const prefix = text.slice(node.startTag, node.startTagEnd - 2);
        edits.push({
            start:       node.startTag,
            end:         node.startTagEnd,
            replacement: `${prefix}${insertions.join('')}>${markup}</${node.tag}>`,
        });
        insertions.length = 0;
        return null;
    }

    if (node.endTag === -1) return 'This element cannot be edited.';
    edits.push({ start: node.endTag, end: node.endTag, replacement: markup });
    return null;
}

function formatNumber(value: number): string {
    return String(Math.round(Number(value) * 100) / 100);
}

/** Split a CDATA terminator so user content cannot close the section early. */
function splitCdata(value: string): string {
    return String(value).replace(/\]\]>/g, ']]]]><![CDATA[>');
}

// ── Small helpers ───────────────────────────────────────────────────────────

function fail(error: string): ElementPatchResult {
    return { edits: [], error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export { MAX_CONTENT, escapeXmlAttr, escapeXmlText, splitCdata };
