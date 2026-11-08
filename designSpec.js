// designSpec.js
// Shared design-view vocabulary and XML helpers.
//
// The model decides what the webview may expose and the editor enforces it.
// Keeping the content limits, kind/tag mapping and property specs in one place
// means an inspector field cannot drift from what designEdit accepts.

const MAX_CONTENT = 8000;

// Studio 7 element kind -> the tag that holds its editable content.
const CONTENT_TAG_BY_KIND = Object.freeze({
    statictext: 'text',
    textfield:  'expression',
    image:      'expression',
    subreport:  'expression',
    chart:      'expression',
});

const CONTENT_KINDS = new Set(Object.keys(CONTENT_TAG_BY_KIND));

// Expression content tags, including the classic JasperReports 6 spellings.
const EXPRESSION_CONTENT_TAGS = Object.freeze([
    'expression', 'textfieldexpression', 'imageexpression', 'subreportexpression', 'chartexpression',
]);

const PROPERTY_SPECS = {
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
};

/** Local XML name: strip a namespace prefix and lower-case it. */
function localName(tag) {
    const text = String(tag ?? '');
    const colon = text.indexOf(':');
    return (colon === -1 ? text : text.slice(colon + 1)).toLowerCase();
}

function attrValue(node, name) {
    const attr = node.attr(name);
    return attr ? attr.value : undefined;
}

function directChild(node, tag) {
    const wanted = String(tag).toLowerCase();
    for (const child of node.children) {
        if (localName(child.tag) === wanted) return child;
    }
    return null;
}

function numericAttr(node, name, fallback) {
    const raw = attrValue(node, name);
    if (raw === undefined) return fallback;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
}

function escapeXmlAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeXmlText(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = {
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
};
