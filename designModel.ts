// designModel.ts
// Pure, vscode-free builder for the JRXML design view (view and edit).
//
// Supports the Studio 7 / JasperReports 7 "element kind" JRXML format:
//   <title height="81"><element kind="textField" x="0" y="0" width="100" height="30">…
//   <detail><band height="20"><element kind="staticText">…
//   <group name="G"><groupHeader><band>…
//
// Classic JasperReports 6 files (staticText/textField wrappers with a nested
// <reportElement>) are detected and reported as unsupported instead of being
// half-rendered. The model is plain JSON so it can be embedded in the webview
// and unit-tested with plain Node.

import { scanXml } from './xmlspan';
import type { XmlNode, XmlTextNode } from './xmlspan';
import {
    MAX_CONTENT,
    CONTENT_TAG_BY_KIND,
    CONTENT_KINDS,
    EXPRESSION_CONTENT_TAGS,
    localName,
    attrValue,
    directChild,
    numericAttr,
} from './designSpec';
import type { ContentKind } from './designSpec';

const MAX_ELEMENTS = 4000;
const MAX_TEXT     = 400;
const MAX_TOOLTIP  = 1500;

const DEFAULT_PAGE_WIDTH   = 595;
const DEFAULT_PAGE_HEIGHT  = 842;
const DEFAULT_MARGIN       = 20;
const DEFAULT_FONT_FAMILY  = 'sans-serif';
const DEFAULT_FONT_SIZE    = 10;
const DEFAULT_TEXT_COLOR   = '#000000';

const SECTION_LABELS: Readonly<Record<string, string>> = {
    background:    'Background',
    title:         'Title',
    pageHeader:    'Page Header',
    columnHeader:  'Column Header',
    columnFooter:  'Column Footer',
    pageFooter:    'Page Footer',
    lastPageFooter:'Last Page Footer',
    summary:       'Summary',
    noData:        'No Data',
};

// Top-level section tags in the order Jaspersoft Studio lays them out.
const TOP_LEVEL_ORDER = [
    'background',
    'title',
    'pageHeader',
    'columnHeader',
];

const BOTTOM_LEVEL_ORDER = [
    'columnFooter',
    'pageFooter',
    'lastPageFooter',
    'summary',
    'noData',
];

// Classic (JasperReports 6) element wrapper tags. Their presence as a child of
// a band/section/frame means the file is not in the Studio 7 format.
const CLASSIC_WRAPPER_TAGS: ReadonlySet<string> = new Set([
    'statictext', 'textfield', 'image', 'line', 'rectangle', 'ellipse',
    'frame', 'subreport', 'chart', 'break',
]);

const CLASSIC_PARENT_TAGS: ReadonlySet<string> = new Set([
    'band', 'title', 'pageheader', 'columnheader', 'detail', 'columnfooter',
    'pagefooter', 'lastpagefooter', 'summary', 'nodata', 'background',
    'groupheader', 'groupfooter', 'frame',
]);

const ALIGN_H: ReadonlySet<string> = new Set(['left', 'center', 'right', 'justify']);
const ALIGN_V: ReadonlySet<string> = new Set(['top', 'middle', 'bottom']);
const MARKUPS: ReadonlySet<string> = new Set(['none', 'styled', 'html', 'rtf']);

/** The report-level page metrics the model exposes. */
export interface DesignReport {
    name: string;
    pageWidth: number;
    pageHeight: number;
    leftMargin: number;
    rightMargin: number;
    topMargin: number;
    bottomMargin: number;
    columnWidth: number;
    columnSpacing: number;
    columnCount: number;
    orientation: string;
    language: string;
    whenNoDataType: string;
}

/** A named style declared at report level. */
export interface DesignStyleSummary {
    name: string;
    default: boolean;
}

/** Visual properties after style resolution. */
export interface DesignStyle {
    fontFamily: string;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikeThrough: boolean;
    forecolor: string;
    backcolor: string;
    hAlign: string;
    vAlign: string;
    rotation: number;
    markup: string;
    mode: 'Opaque' | 'Transparent';
}

/** Editable text/expression content and why it may be read-only. */
export interface DesignContent {
    tag: string;
    raw: string;
    cdata: boolean;
    nested: boolean;
    mixed: boolean;
    truncated: boolean;
    missing: boolean;
    editable: boolean;
}

/** Resolved border and padding for the inspector. */
export interface DesignBox {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
    border: boolean;
    width: number;
    padding: number;
    color: string;
    lineStyle: string;
}

/** Resolved pen of a line element. */
export interface DesignLine {
    direction: 'TopDown' | 'BottomUp';
    width: number;
    style: string;
    color: string;
}

/** One rendered element. `fullText` is present only while the tooltip is built. */
export interface DesignElement {
    kind: string;
    offset: number;
    end: number;
    x: number;
    y: number;
    width: number;
    height: number;
    displayText: string;
    tooltip: string;
    attrs: Record<string, string>;
    style: DesignStyle;
    box: DesignBox;
    line: DesignLine | null;
    content: DesignContent | null;
    children: DesignElement[];
    fullText?: string;
}

/** One band (or Studio 7 section acting as a band). */
export interface DesignBand {
    key: string;
    label: string;
    group: string;
    height: number;
    offset: number;
    end: number;
    elements: DesignElement[];
}

/** The JSON-serializable model embedded in the design-view webview. */
export interface DesignModel {
    format: 'unknown' | 'studio7' | 'classic';
    error: string | null;
    unsupported: 'classic' | null;
    report: DesignReport;
    bands: DesignBand[];
    styles: DesignStyleSummary[];
    warnings: string[];
    truncated: boolean;
    counts: { bands: number; elements: number };
}

/** The band or element under a source offset. */
export interface SelectionTarget {
    kind: 'element' | 'band';
    offset: number;
    end: number;
}

interface BandDescriptor {
    key: string;
    label: string;
    group: string;
    node: XmlNode;
}

interface ElementContext {
    remaining: number;
    count: number;
    truncated: boolean;
    invalid: number;
}

interface StyleProps {
    fontName?: string;
    fontSize?: string;
    bold?: string;
    italic?: string;
    underline?: string;
    strikeThrough?: string;
    forecolor?: string;
    backcolor?: string;
    hTextAlign?: string;
    vTextAlign?: string;
    hAlign?: string;
    vAlign?: string;
    rotation?: string;
    markup?: string;
    mode?: string;
}

interface ResolvedStyles {
    defaultProps: StyleProps;
    byName: Map<string, { name: string; props: StyleProps }>;
    list: DesignStyleSummary[];
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Build a JSON-serializable design model for `text`. Never throws: malformed input is reported through `error`. */
export function buildDesignModel(text: string): DesignModel {
    const model = emptyModel();

    if (typeof text !== 'string' || text.trim() === '') {
        model.error = 'The document is empty.';
        return model;
    }

    const scan = scanXml(text);
    if (scan.error || !scan.doc) {
        model.error = scan.error || 'The document could not be parsed.';
        return model;
    }

    const root = scan.doc.root;
    if (!root || localName(root.tag) !== 'jasperreport') {
        model.error = 'No <jasperReport> root element found.';
        return model;
    }

    model.report = readReport(root);
    model.format = 'studio7';

    if (isClassicFormat(root)) {
        model.format      = 'classic';
        model.unsupported = 'classic';
        return model;
    }

    const styles = readStyles(root);
    model.styles = styles.list;
    const ctx: ElementContext = {
        remaining: MAX_ELEMENTS,
        count:     0,
        truncated: false,
        invalid:   0,
    };

    const descriptors = collectBandDescriptors(root);
    for (const descriptor of descriptors) {
        model.bands.push(readBand(descriptor, ctx, styles));
    }

    model.truncated = ctx.truncated;
    model.counts    = { bands: model.bands.length, elements: ctx.count };

    if (ctx.invalid > 0) {
        model.warnings.push(
            `${ctx.invalid} element${ctx.invalid === 1 ? '' : 's'} had missing or non-numeric geometry and were drawn at 0.`
        );
    }
    if (ctx.truncated) {
        model.warnings.push(`Only the first ${MAX_ELEMENTS} elements are shown.`);
    }

    return model;
}

function emptyModel(): DesignModel {
    return {
        format:      'unknown',
        error:       null,
        unsupported: null,
        report: {
            name:            'Report',
            pageWidth:       DEFAULT_PAGE_WIDTH,
            pageHeight:      DEFAULT_PAGE_HEIGHT,
            leftMargin:      DEFAULT_MARGIN,
            rightMargin:     DEFAULT_MARGIN,
            topMargin:       DEFAULT_MARGIN,
            bottomMargin:    DEFAULT_MARGIN,
            columnWidth:     DEFAULT_PAGE_WIDTH - (2 * DEFAULT_MARGIN),
            columnSpacing:   0,
            columnCount:     1,
            orientation:     'Portrait',
            language:        'java',
            whenNoDataType:  'NoPages',
        },
        bands:     [],
        styles:    [],
        warnings:  [],
        truncated: false,
        counts:    { bands: 0, elements: 0 },
    };
}

// ── Report attributes ────────────────────────────────────────────────────────

function readReport(root: XmlNode): DesignReport {
    const pageWidth   = numericAttr(root, 'pageWidth', DEFAULT_PAGE_WIDTH);
    const pageHeight  = numericAttr(root, 'pageHeight', DEFAULT_PAGE_HEIGHT);
    const leftMargin  = numericAttr(root, 'leftMargin', DEFAULT_MARGIN);
    const rightMargin = numericAttr(root, 'rightMargin', DEFAULT_MARGIN);
    const columnCountRaw = numericAttr(root, 'columnCount', 1);
    const columnCount = Math.max(1, Math.round(columnCountRaw));

    let columnWidth = numericAttr(root, 'columnWidth', NaN);
    if (!Number.isFinite(columnWidth) || columnWidth <= 0) {
        columnWidth = pageWidth - leftMargin - rightMargin;
    }

    return {
        name:           String(attrValue(root, 'name') || 'Report'),
        pageWidth:      positiveOr(pageWidth, DEFAULT_PAGE_WIDTH),
        pageHeight:     positiveOr(pageHeight, DEFAULT_PAGE_HEIGHT),
        leftMargin:     nonNegativeOr(leftMargin, DEFAULT_MARGIN),
        rightMargin:    nonNegativeOr(rightMargin, DEFAULT_MARGIN),
        topMargin:      nonNegativeOr(numericAttr(root, 'topMargin', DEFAULT_MARGIN), DEFAULT_MARGIN),
        bottomMargin:   nonNegativeOr(numericAttr(root, 'bottomMargin', DEFAULT_MARGIN), DEFAULT_MARGIN),
        columnWidth:    nonNegativeOr(columnWidth, 0),
        columnSpacing:  nonNegativeOr(numericAttr(root, 'columnSpacing', 0), 0),
        columnCount,
        orientation:    String(attrValue(root, 'orientation') || 'Portrait'),
        language:       String(attrValue(root, 'language') || 'java'),
        whenNoDataType: String(attrValue(root, 'whenNoDataType') || 'NoPages'),
    };
}

// ── Classic format detection ────────────────────────────────────────────────

function isClassicFormat(root: XmlNode): boolean {
    for (const node of root.walk()) {
        if (localName(node.tag) === 'reportElement') return true;

        const tag = localName(node.tag);
        if (!CLASSIC_WRAPPER_TAGS.has(tag)) continue;

        const parentTag = node.parent ? localName(node.parent.tag) : '';
        if (CLASSIC_PARENT_TAGS.has(parentTag)) return true;
    }
    return false;
}

// ── Band discovery ──────────────────────────────────────────────────────────

function collectBandDescriptors(root: XmlNode): BandDescriptor[] {
    const out: BandDescriptor[] = [];

    for (const tag of TOP_LEVEL_ORDER) pushSectionRows(out, root, tag);

    // Group headers (declaration order), then detail bands, then group footers
    // in reverse declaration order — the order JasperReports fills them in.
    const groups = directChildren(root, 'group');
    for (const group of groups) {
        const name = String(attrValue(group, 'name') || 'Group');
        const header = directChild(group, 'groupHeader');
        if (!header) continue;
        for (const node of sectionBands(header)) {
            out.push({
                key:   'groupHeader',
                label: `Group ${name} Header`,
                group: name,
                node,
            });
        }
    }

    const detailBands: XmlNode[] = [];
    for (const detail of directChildren(root, 'detail')) {
        for (const node of sectionBands(detail)) detailBands.push(node);
    }
    for (let i = 0; i < detailBands.length; i++) {
        out.push({
            key:   'detail',
            label: detailBands.length > 1 ? `Detail (${i + 1})` : 'Detail',
            group: '',
            node:  detailBands[i],
        });
    }

    for (let i = groups.length - 1; i >= 0; i--) {
        const group = groups[i];
        const name  = String(attrValue(group, 'name') || 'Group');
        const footer = directChild(group, 'groupFooter');
        if (!footer) continue;
        for (const node of sectionBands(footer)) {
            out.push({
                key:   'groupFooter',
                label: `Group ${name} Footer`,
                group: name,
                node,
            });
        }
    }

    for (const tag of BOTTOM_LEVEL_ORDER) pushSectionRows(out, root, tag);

    return out;
}

function pushSectionRows(out: BandDescriptor[], root: XmlNode, tag: string): void {
    for (const section of directChildren(root, tag)) {
        const nodes = sectionBands(section);
        for (const node of nodes) {
            out.push({ key: tag, label: SECTION_LABELS[tag], group: '', node });
        }
    }
}

/**
 * A section has either explicit <band> children (detail, group header/footer)
 * or is itself the band (Studio 7: <title height="…"> with direct <element>s).
 */
function sectionBands(section: XmlNode): XmlNode[] {
    const bands = directChildren(section, 'band');
    if (bands.length > 0) return bands;
    return [section];
}

function readBand(descriptor: BandDescriptor, ctx: ElementContext, styles: ResolvedStyles): DesignBand {
    const node = descriptor.node;
    return {
        key:      descriptor.key,
        label:    descriptor.label,
        group:    descriptor.group || '',
        height:   nonNegativeOr(numericAttr(node, 'height', 0), 0),
        offset:   node.startTag,
        end:      node.end,
        elements: readElements(node, ctx, styles),
    };
}

// ── Elements ────────────────────────────────────────────────────────────────

function readElements(container: XmlNode, ctx: ElementContext, styles: ResolvedStyles): DesignElement[] {
    const out: DesignElement[] = [];
    for (const child of container.children) {
        if (localName(child.tag) !== 'element') continue;

        if (ctx.remaining <= 0) {
            ctx.truncated = true;
            continue;
        }

        const element = readElement(child, ctx, styles);
        if (element) out.push(element);
    }
    return out;
}

function readElement(node: XmlNode, ctx: ElementContext, styles: ResolvedStyles): DesignElement {
    ctx.remaining -= 1;
    ctx.count     += 1;

    const kind = String(attrValue(node, 'kind') || localName(node.tag) || 'element');
    const key  = kind.toLowerCase();
    const style = resolveStyle(node, styles);

    const element: DesignElement = {
        kind,
        offset:      node.startTag,
        end:         node.end,
        x:           geometry(node, 'x', ctx),
        y:           geometry(node, 'y', ctx),
        width:       geometry(node, 'width', ctx),
        height:      geometry(node, 'height', ctx),
        displayText: '',
        tooltip:     '',
        attrs:       readAttrs(node),
        style,
        box:         readBox(node, style),
        line:        null,
        content:     readContent(node, key),
        children:    [],
    };

    if (key === 'statictext') {
        const textNode = findChild(node, ['text']);
        const full = textNode ? prepareText(deepText(textNode), style.markup) : '';
        element.displayText = cap(full, MAX_TEXT);
        element.fullText    = cap(full, MAX_TOOLTIP);
    } else if (key === 'textfield') {
        const expression = expressionOf(node);
        element.displayText = cap(prepareText(expression, 'none'), MAX_TEXT);
        element.fullText    = cap(prepareText(expression, 'none'), MAX_TOOLTIP);
    } else if (key === 'image' || key === 'subreport' || key === 'chart') {
        const expression = prepareText(expressionOf(node), 'none');
        element.displayText = cap(placeholderLabel(expression, key), MAX_TEXT);
        element.fullText    = cap(expression, MAX_TOOLTIP);
    } else if (key === 'component' || key === 'table' || key === 'list' || key === 'crosstab') {
        element.displayText = nestedComponentKind(node) || kind;
        element.fullText    = '';
    } else if (key === 'line') {
        element.line = readLine(node, style);
    } else if (key === 'break') {
        element.displayText = '';
    } else {
        element.displayText = kind;
        element.fullText    = '';
    }

    if (key === 'frame' || key === 'elementgroup') {
        element.children = readElements(node, ctx, styles);
    }

    element.tooltip = cap(buildTooltip(element), MAX_TOOLTIP);
    delete element.fullText;
    return element;
}

/**
 * Metadata for an element's editable text/expression content. The raw text is
 * kept separate from displayText so the inspector can edit what is really in
 * the file (including markup) without sending the whole document to the webview.
 */
function readContent(node: XmlNode, key: string): DesignContent | null {
    if (!isContentKind(key)) return null;

    const expectedTag = CONTENT_TAG_BY_KIND[key];
    const contentNode = expectedTag === 'text'
        ? directChild(node, 'text')
        : findExpressionNode(node);

    if (!contentNode) {
        return {
            tag:       expectedTag,
            raw:       '',
            cdata:     true,
            nested:    false,
            mixed:     false,
            truncated: false,
            missing:   true,
            editable:  true,
        };
    }

    const textNodes: XmlTextNode[] = [];
    for (const descendant of contentNode.walk()) {
        for (const textNode of descendant.textNodes) textNodes.push(textNode);
    }
    textNodes.sort((a, b) => a.start - b.start);

    const meaningful = textNodes.filter(textNode => textNode.text.trim() !== '');
    const hasCdata   = meaningful.some(textNode => textNode.cdata);
    const hasPlain   = meaningful.some(textNode => !textNode.cdata);
    const mixed      = hasCdata && hasPlain;
    const cdata      = meaningful.length === 0 ? true : !hasPlain;
    const nested     = contentNode.children.length > 0;

    const full = textNodes.map(textNode => textNode.text).join('');
    const raw  = cdata ? full : decodeXmlEntities(full);
    const truncated = raw.length > MAX_CONTENT;

    return {
        tag:       localName(contentNode.tag),
        raw:       cap(raw, MAX_CONTENT),
        cdata,
        nested,
        mixed,
        truncated,
        missing:   false,
        editable:  !nested && !mixed && !truncated,
    };
}

function isContentKind(value: string): value is ContentKind {
    return CONTENT_KINDS.has(value);
}

/** First direct expression child (Studio 7 spelling, with the old names as a fallback). */
function findExpressionNode(node: XmlNode): XmlNode | null {
    for (const child of node.children) {
        if (EXPRESSION_CONTENT_TAGS.includes(localName(child.tag))) return child;
    }
    return null;
}

/**
 * The element or band containing a source offset. The deepest element wins, so
 * a cursor inside a frame child selects the child. Returns null for offsets
 * outside every band (declarations, properties, …) or for an invalid model.
 */
export function findSelectionTarget(model: DesignModel | null, offset: number): SelectionTarget | null {
    if (!model || model.error || !Array.isArray(model.bands)) return null;

    for (const band of model.bands) {
        if (!(offset >= band.offset && offset < band.end)) continue;

        const element = deepestElementAt(band.elements || [], offset);
        if (element) {
            return { kind: 'element', offset: element.offset, end: element.end };
        }
        return { kind: 'band', offset: band.offset, end: band.end };
    }
    return null;
}

function deepestElementAt(elements: readonly DesignElement[], offset: number): DesignElement | null {
    for (const element of elements) {
        if (!(offset >= element.offset && offset < element.end)) continue;

        const child = deepestElementAt(element.children || [], offset);
        return child || element;
    }
    return null;
}

function buildTooltip(element: DesignElement): string {
    const geometry = `x=${fmt(element.x)} y=${fmt(element.y)} w=${fmt(element.width)} h=${fmt(element.height)}`;
    let out = `${element.kind} · ${geometry}`;
    if (element.fullText) out += `\n${element.fullText}`;
    else if (element.displayText) out += `\n${element.displayText}`;
    return out;
}

function geometry(node: XmlNode, name: string, ctx: ElementContext): number {
    const attr = node.attr(name);
    if (!attr) {
        ctx.invalid += 1;
        return 0;
    }

    const value = Number.parseFloat(attr.value);
    if (!Number.isFinite(value)) {
        ctx.invalid += 1;
        return 0;
    }
    if ((name === 'width' || name === 'height') && value < 0) {
        ctx.invalid += 1;
        return 0;
    }
    return value;
}

function readLine(node: XmlNode, style: DesignStyle): DesignLine {
    const pen      = firstDescendant(node, 'pen');
    const widthRaw = attrValue(node, 'lineWidth') ?? (pen ? attrValue(pen, 'lineWidth') : undefined);
    const width    = nonNegativeOr(Number.parseFloat(widthRaw ?? ''), 1);

    const direction = String(attrValue(node, 'direction') || '').toLowerCase() === 'bottomup'
        ? 'BottomUp'
        : 'TopDown';

    return {
        direction,
        width: Number.isFinite(width) && width > 0 ? width : 1,
        style: normalizeLineStyle(pen ? attrValue(pen, 'lineStyle') : undefined),
        color: normalizeColor(
            pen ? attrValue(pen, 'lineColor') : undefined,
            style.forecolor === 'transparent' ? DEFAULT_TEXT_COLOR : style.forecolor
        ),
    };
}

function readBox(node: XmlNode, style: DesignStyle): DesignBox {
    const box: DesignBox = {
        top:       false,
        right:     false,
        bottom:    false,
        left:      false,
        border:    false,
        width:     0,
        padding:   0,
        color:     style.forecolor === 'transparent' ? DEFAULT_TEXT_COLOR : style.forecolor,
        lineStyle: 'solid',
    };

    const boxNode = directChild(node, 'box');
    if (!boxNode) return box;

    box.padding = nonNegativeOr(numericAttr(boxNode, 'padding', 0), 0);

    const generic = directChild(boxNode, 'pen');

    const sides = ['top', 'right', 'bottom', 'left'] as const;
    for (const side of sides) {
        const pen = directChild(boxNode, `${side}Pen`) || generic;
        if (!pen || !penEnabled(pen)) continue;
        box[side] = true;
        box.border = true;
        box.width = Math.max(box.width, nonNegativeOr(Number.parseFloat(attrValue(pen, 'lineWidth') ?? ''), 1));
        box.color = normalizeColor(attrValue(pen, 'lineColor'), box.color);
        box.lineStyle = normalizeLineStyle(attrValue(pen, 'lineStyle'));
    }

    if (!box.border) box.width = 1;
    return box;
}

/**
 * Element attributes exposed to the webview are decoded: the model is a
 * display/edit representation and designEdit encodes values once on write.
 * Structural checks that need the literal source use `node.attr(name).value`.
 */
function readAttrs(node: XmlNode): Record<string, string> {
    const out: Record<string, string> = {};
    for (const attr of node.attrList) out[attr.name] = decodeXmlEntities(attr.value);
    return out;
}

function penEnabled(pen: XmlNode): boolean {
    const raw = attrValue(pen, 'lineWidth');
    if (raw === undefined) return true;
    const width = Number.parseFloat(raw);
    return Number.isFinite(width) ? width > 0 : true;
}

// ── Styles ──────────────────────────────────────────────────────────────────

function readStyles(root: XmlNode): ResolvedStyles {
    const byName = new Map<string, { name: string; props: StyleProps }>();
    const list: DesignStyleSummary[] = [];
    let defaultProps: StyleProps = {};

    for (const node of directChildren(root, 'style')) {
        const name = String(attrValue(node, 'name') || '');
        const props = pickStyleProps(node);
        const isDefault = String(attrValue(node, 'default') || '').toLowerCase() === 'true';

        if (name) {
            byName.set(name, { name, props });
            list.push({ name, default: isDefault });
        }
        if (isDefault) defaultProps = { ...defaultProps, ...props };
    }

    return { defaultProps, byName, list };
}

function resolveStyle(node: XmlNode, styles: ResolvedStyles): DesignStyle {
    const merged: StyleProps = { ...styles.defaultProps };
    const styleName = attrValue(node, 'style');

    if (styleName) {
        const named = styles.byName.get(styleName);
        if (named) Object.assign(merged, named.props);
    }
    Object.assign(merged, pickStyleProps(node));

    return normalizeStyle(merged);
}

/** Raw visual properties actually present on the node. */
function pickStyleProps(node: XmlNode): StyleProps {
    const props: StyleProps = {};
    const put = (key: keyof StyleProps, value: string | undefined): void => {
        if (value !== undefined && value !== null && value !== '') props[key] = value;
    };

    put('fontName',       attrValue(node, 'fontName'));
    put('fontSize',       attrValue(node, 'fontSize'));
    put('bold',           attrValue(node, 'bold'));
    put('italic',         attrValue(node, 'italic'));
    put('underline',      attrValue(node, 'underline'));
    put('strikeThrough',  attrValue(node, 'strikeThrough'));
    put('forecolor',      attrValue(node, 'forecolor'));
    put('backcolor',      attrValue(node, 'backcolor'));
    put('hTextAlign',     attrValue(node, 'hTextAlign'));
    put('vTextAlign',     attrValue(node, 'vTextAlign'));
    put('hAlign',         attrValue(node, 'hAlign'));
    put('vAlign',         attrValue(node, 'vAlign'));
    put('rotation',       attrValue(node, 'rotation'));
    put('markup',         attrValue(node, 'markup'));
    put('mode',           attrValue(node, 'mode'));

    return props;
}

function normalizeStyle(raw: StyleProps): DesignStyle {
    const fontSize = Number.parseFloat(raw.fontSize ?? '');
    const mode     = String(raw.mode || 'Transparent').toLowerCase();

    return {
        fontFamily:    fontStack(raw.fontName),
        fontSize:      Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_FONT_SIZE,
        bold:          isTrue(raw.bold),
        italic:        isTrue(raw.italic),
        underline:     isTrue(raw.underline),
        strikeThrough: isTrue(raw.strikeThrough),
        forecolor:     normalizeColor(raw.forecolor, DEFAULT_TEXT_COLOR),
        backcolor:     normalizeColor(raw.backcolor, 'transparent'),
        hAlign:        normalizeAlign(raw.hTextAlign ?? raw.hAlign, ALIGN_H, 'left'),
        vAlign:        normalizeAlign(raw.vTextAlign ?? raw.vAlign, ALIGN_V, 'top'),
        rotation:      normalizeRotation(raw.rotation),
        markup:        normalizeMarkup(raw.markup),
        mode:          mode === 'opaque' ? 'Opaque' : 'Transparent',
    };
}

function fontStack(value: string | undefined): string {
    if (!value) return DEFAULT_FONT_FAMILY;

    const name = String(value).replace(/[^A-Za-z0-9 _,'-]/g, '').trim().slice(0, 80);
    if (!name) return DEFAULT_FONT_FAMILY;

    const generic = /mono|courier|consolas/i.test(name) ? 'monospace' : 'sans-serif';
    return `"${name}", ${generic}`;
}

function normalizeColor(value: string | undefined, fallback: string): string {
    const color = String(value ?? '').trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) return color;
    if (color.toLowerCase() === 'transparent') return 'transparent';
    return fallback;
}

function normalizeAlign(value: string | undefined, allowed: ReadonlySet<string>, fallback: string): string {
    const align = String(value ?? '').trim().toLowerCase();
    return allowed.has(align) ? align : fallback;
}

function normalizeRotation(value: string | undefined): number {
    switch (String(value ?? '').trim().toLowerCase()) {
        case 'left':        return -90;
        case 'right':       return 90;
        case 'upsidedown':  return 180;
        default:            return 0;
    }
}

function normalizeMarkup(value: string | undefined): string {
    const markup = String(value ?? '').trim().toLowerCase();
    return MARKUPS.has(markup) ? markup : 'none';
}

function normalizeLineStyle(value: string | undefined): string {
    const style = String(value ?? '').trim().toLowerCase();
    if (style === 'dashed' || style === 'dotted' || style === 'double') return style;
    return 'solid';
}

// ── Text helpers ────────────────────────────────────────────────────────────

/**
 * Flatten a text value for display: markup tags are stripped (for styled/html/
 * rtf), entities are decoded and newlines are normalised. The webview only ever
 * receives plain text, never markup.
 */
export function prepareText(raw: string, markup: string): string {
    let out = String(raw ?? '');
    const mode = normalizeMarkup(markup);

    if (mode === 'styled' || mode === 'html' || mode === 'rtf') {
        out = flattenMarkup(out);
    }
    return decodeXmlEntities(out).replace(/\r\n?/g, '\n');
}

/** Strip markup from a styled/HTML/RTF text value, keeping the inner text. */
export function flattenMarkup(value: string): string {
    return String(value ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/\n{3,}/g, '\n\n');
}

/** Decode the predefined XML entities plus numeric character references. */
export function decodeXmlEntities(value: string): string {
    return String(value ?? '').replace(/&(#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (match: string, body: string) => {
        switch (body) {
            case 'amp':  return '&';
            case 'lt':   return '<';
            case 'gt':   return '>';
            case 'quot': return '"';
            case 'apos': return "'";
            case 'nbsp': return '\u00a0';
            default:     break;
        }

        if (body[0] === '#') {
            const hex = body[1] === 'x' || body[1] === 'X';
            const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
            if (Number.isFinite(code)) {
                try { return String.fromCodePoint(code); } catch { return match; }
            }
        }
        return match;
    });
}

/** Concatenate every text node in a subtree, in document order. */
function deepText(node: XmlNode): string {
    const parts: XmlTextNode[] = [];
    for (const descendant of node.walk()) {
        for (const textNode of descendant.textNodes) parts.push(textNode);
    }
    parts.sort((a, b) => a.start - b.start);
    return parts.map(part => part.text).join('');
}

function expressionOf(node: XmlNode): string {
    const expressionNode = findChild(node, [
        'expression', 'textFieldExpression', 'imageExpression',
        'subreportExpression', 'chartExpression',
    ]);
    return expressionNode ? deepText(expressionNode).trim() : '';
}

function placeholderLabel(expression: string, kind: string): string {
    const literal = unwrapLiteral(expression);
    if (literal !== null && literal !== '') return literal;
    if (expression) return expression;
    return kind;
}

/** Turn `"Detail.jasper"` into `Detail.jasper`; return null otherwise. */
function unwrapLiteral(expression: string): string | null {
    const match = /^"((?:\\.|[^"\\])*)"$/.exec(String(expression ?? '').trim());
    if (!match) return null;
    return match[1].replace(/\\(["\\])/g, '$1');
}

function nestedComponentKind(node: XmlNode): string {
    for (const descendant of node.walk()) {
        if (descendant === node) continue;
        if (localName(descendant.tag) !== 'component') continue;
        const kind = attrValue(descendant, 'kind');
        if (kind) return String(kind);
    }
    return '';
}

function cap(value: string, max: number): string {
    const text = String(value ?? '');
    return text.length > max ? text.slice(0, max) + '…' : text;
}

// ── XML helpers ─────────────────────────────────────────────────────────────

function directChildren(node: XmlNode, tag: string): XmlNode[] {
    const wanted = tag.toLowerCase();
    return node.children.filter(child => localName(child.tag) === wanted);
}

function findChild(node: XmlNode, tags: readonly string[]): XmlNode | null {
    const wanted = new Set(tags.map(tag => tag.toLowerCase()));
    for (const child of node.children) {
        if (wanted.has(localName(child.tag))) return child;
    }
    return null;
}

function firstDescendant(node: XmlNode, tag: string): XmlNode | null {
    const wanted = tag.toLowerCase();
    for (const child of node.walk()) {
        if (localName(child.tag) === wanted) return child;
    }
    return null;
}

function isTrue(value: string | undefined): boolean {
    return String(value ?? '').trim().toLowerCase() === 'true';
}

function nonNegativeOr(value: number, fallback: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function positiveOr(value: number, fallback: number): number {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function fmt(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export { localName, MAX_ELEMENTS, MAX_TEXT, MAX_TOOLTIP, MAX_CONTENT };
