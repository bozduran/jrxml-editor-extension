// designSpec.ts
// Shared design-view vocabulary and XML helpers.
//
// The model decides what the webview may expose and the editor enforces it.
// Keeping the content limits, kind/tag mapping and property specs in one place
// means an inspector field cannot drift from what designEdit accepts.

import type { XmlNode } from './xmlspan';
import { forRole } from './expressionTags';

export const MAX_CONTENT = 8000;

export type ContentKind = 'statictext' | 'textfield' | 'image' | 'subreport' | 'chart';

// Studio 7 element kind -> the tag that holds its editable content.
export const CONTENT_TAG_BY_KIND: Readonly<Record<ContentKind, string>> = Object.freeze({
    statictext: 'text',
    textfield:  'expression',
    image:      'expression',
    subreport:  'expression',
    chart:      'expression',
});

export const CONTENT_KINDS: ReadonlySet<string> = new Set(Object.keys(CONTENT_TAG_BY_KIND));

// Expression content tags, including the classic JasperReports 6 spellings.
export const EXPRESSION_CONTENT_TAGS: readonly string[] = Object.freeze([
    ...forRole('designContent'),
]);

export interface FontNameSpec {
    readonly type: 'fontName';
}

export interface FontSizeSpec {
    readonly type: 'fontSize';
}

export interface BooleanSpec {
    readonly type: 'boolean';
}

export interface ColorSpec {
    readonly type: 'color';
}

export interface TextSpec {
    readonly type: 'text';
}

export interface RawStringSpec {
    readonly type: 'rawString';
}

export interface IntegerSpec {
    readonly type: 'integer';
    readonly min: number;
    readonly max: number;
}

export interface EnumSpec {
    readonly type: 'enum';
    readonly values: readonly string[];
}

export type PropertySpec =
    | FontNameSpec
    | FontSizeSpec
    | BooleanSpec
    | ColorSpec
    | TextSpec
    | RawStringSpec
    | IntegerSpec
    | EnumSpec;

export const PROPERTY_SPECS = {
    fontName:       { type: 'fontName' },
    fontSize:       { type: 'fontSize' },
    bold:           { type: 'boolean' },
    italic:         { type: 'boolean' },
    underline:      { type: 'boolean' },
    strikeThrough:  { type: 'boolean' },
    forecolor:      { type: 'color' },
    backcolor:      { type: 'color' },
    hTextAlign:     { type: 'enum', values: ['Left', 'Center', 'Right', 'Justify'] },
    vTextAlign:     { type: 'enum', values: ['Top', 'Middle', 'Bottom'] },
    rotation:       { type: 'enum', values: ['None', 'Left', 'Right', 'UpsideDown'] },
    markup:         { type: 'enum', values: ['none', 'styled', 'html', 'rtf'] },
    mode:           { type: 'enum', values: ['Transparent', 'Opaque'] },
    style:          { type: 'text' },

    // Layout / print behaviour.
    positionType:             { type: 'enum', values: ['Float', 'FixRelativeToTop', 'FixRelativeToBottom'] },
    stretchType:              {
        type: 'enum',
        values: [
            'NoStretch', 'ElementGroupHeight', 'ElementGroupBottom',
            'ContainerHeight', 'ContainerBottom',
            'RelativeToTallestObject', 'RelativeToBandHeight',
        ],
    },
    printRepeatedValues:      { type: 'boolean' },
    removeLineWhenBlank:      { type: 'boolean' },
    printInFirstWholeBand:    { type: 'boolean' },
    printWhenDetailOverflows: { type: 'boolean' },
    printWhenGroupChanges:    { type: 'text' },
    evaluationTime:           { type: 'enum', values: ['Now', 'Report', 'Page', 'Column', 'Group', 'Band', 'Auto', 'Master'] },
    evaluationGroup:          { type: 'text' },
    bookmarkLevel:            { type: 'integer', min: 0, max: 100000 },
    key:                      { type: 'text' },

    // Text-specific.
    textAdjust:    { type: 'enum', values: ['CutText', 'StretchHeight', 'ScaleFont'] },
    pattern:       { type: 'rawString' },
    blankWhenNull: { type: 'boolean' },

    // Image-specific.
    scaleImage:   { type: 'enum', values: ['Clip', 'FillFrame', 'RetainShape', 'RealSize', 'RealHeight', 'RealWidth'] },
    hImageAlign:  { type: 'enum', values: ['Left', 'Center', 'Right'] },
    vImageAlign:  { type: 'enum', values: ['Top', 'Middle', 'Bottom'] },
    onErrorType:  { type: 'enum', values: ['Error', 'Blank', 'Icon'] },
    usingCache:   { type: 'boolean' },
    lazy:         { type: 'boolean' },
    linkType:     { type: 'enum', values: ['None', 'Reference', 'LocalAnchor', 'LocalPage', 'RemoteAnchor', 'RemotePage'] },

    // Element-specific.
    runToBottom: { type: 'boolean' },
    direction:   { type: 'enum', values: ['TopDown', 'BottomUp'] },
    radius:      { type: 'integer', min: 0, max: 100000 },
    type:        { type: 'enum', values: ['Page', 'Column'] },
} as const satisfies Record<string, PropertySpec>;

export type DesignPropertyName = keyof typeof PROPERTY_SPECS;

/** Local XML name: strip a namespace prefix and lower-case it. */
export function localName(tag: string): string {
    const text = String(tag ?? '');
    const colon = text.indexOf(':');
    return (colon === -1 ? text : text.slice(colon + 1)).toLowerCase();
}

export function attrValue(node: XmlNode, name: string): string | undefined {
    const attr = node.attr(name);
    return attr ? attr.value : undefined;
}

export function directChild(node: XmlNode, tag: string): XmlNode | null {
    const wanted = String(tag).toLowerCase();
    for (const child of node.children) {
        if (localName(child.tag) === wanted) return child;
    }
    return null;
}

export function numericAttr(node: XmlNode, name: string, fallback: number): number {
    const raw = attrValue(node, name);
    if (raw === undefined) return fallback;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
}

export function escapeXmlAttr(value: unknown): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function escapeXmlText(value: unknown): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
