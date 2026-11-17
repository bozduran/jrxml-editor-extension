// jrxmlSchema.ts
// The curated JRXML vocabulary the schema checks validate against.
//
// Source of truth: the official JasperReports 6.x `jasperreport.xsd` plus the
// real files under `integration/workspace` and `test/fixtures`. The extension
// ships no XSD engine, so this table is deliberately version-tolerant:
//
//   * attributes JasperReports writes but the XSD does not declare (`uuid`,
//     `kind`) are universal;
//   * 7.x's `<element kind="…">` form and 6.x's typed element tags are both
//     modelled;
//   * elements whose attribute surface is large or version-dependent
//     (`element`, `style`, `box`, …) set `openAttributes`, so values are still
//     checked but unknown names are not reported.
//
// The fixture test in test/schemaChecks.test.js fails if a real file starts
// using something this table does not accept, so drift is caught immediately.

import { PROPERTY_SPECS } from './designSpec';

/** One attribute's constraints. */
export interface AttributeRule {
    readonly enum?: readonly string[];
    readonly required?: boolean;
    readonly deprecatedBy?: string;
}

/** One element's constraints. */
export interface ElementRule {
    readonly attrs?: Readonly<Record<string, AttributeRule>>;
    /** Skip unknown-attribute reporting; enum/required checks still run. */
    readonly openAttributes?: boolean;
    /** Fully known child vocabulary; omit when any element may appear. */
    readonly children?: readonly string[];
}

/** Attributes JasperReports/Studio write without the XSD declaring them. */
export const UNIVERSAL_ATTRIBUTES: ReadonlySet<string> = new Set(['uuid', 'kind']);

/** Element spellings that mean the same thing. */
export const TAG_ALIASES: Readonly<Record<string, string>> = {
    queryString: 'query',
};

const CALCULATION = [
    'Nothing', 'Count', 'Sum', 'Average', 'Lowest', 'Highest',
    'StandardDeviation', 'Variance', 'System', 'First', 'DistinctCount',
];
const RESET_TYPE = ['None', 'Report', 'Page', 'Column', 'Group'];
const PRINT_ORDER = ['Vertical', 'Horizontal'];
const COLUMN_DIRECTION = ['LTR', 'RTL'];
const ORIENTATION = ['Portrait', 'Landscape'];
const WHEN_NO_DATA_TYPE = ['NoPages', 'BlankPage', 'AllSectionsNoDetail', 'NoDataSection'];
const SECTION_TYPE = ['Band', 'Part'];
const WHEN_RESOURCE_MISSING = ['Null', 'Empty', 'Key', 'Error'];
const ORDER = ['Ascending', 'Descending'];
const PROPERTY_TYPE = ['default', 'simpleText'];
const EVALUATION_TIME = PROPERTY_SPECS.evaluationTime.values;

/** The 7.x `<element kind="…">` vocabulary. */
export const ELEMENT_KINDS: readonly string[] = [
    'staticText', 'textField', 'image', 'line', 'rectangle', 'ellipse', 'frame',
    'subreport', 'break', 'componentElement', 'genericElement', 'chart',
    'table', 'crosstab', 'list', 'pagination', 'generic', 'component',
];

function bool(): AttributeRule { return {}; }

/** Attributes shared by 6.x `reportElement` and 7.x `element`. */
/** A band, or a classic section that is itself a band. */
const SECTION_RULE: ElementRule = {
    attrs: { height: {}, splitType: { enum: ['Stretch', 'Prevent', 'Immediate'] } },
    openAttributes: true,
};

const REPORT_ELEMENT_ATTRS: Record<string, AttributeRule> = {
    x: { required: true },
    y: { required: true },
    width: { required: true },
    height: { required: true },
    key: {},
    style: {},
    positionType: { enum: PROPERTY_SPECS.positionType.values },
    stretchType: { enum: PROPERTY_SPECS.stretchType.values },
    isPrintRepeatedValues: bool(),
    isRemoveLineWhenBlank: bool(),
    removeLineWhenBlank: bool(),
    isPrintInFirstWholeBand: bool(),
    isPrintWhenDetailOverflows: bool(),
    printWhenGroupChanges: {},
    mode: { enum: PROPERTY_SPECS.mode.values },
    forecolor: {},
    backcolor: {},
};

/** Font, box and paragraph attributes 7.x merges into `<element>`. */
const ELEMENT_STYLE_ATTRS: Record<string, AttributeRule> = {
    fontName: {}, fontSize: {}, pdfFontName: {}, pdfEncoding: {}, isPdfEmbedded: bool(),
    bold: bool(), isBold: bool(),
    italic: bool(), isItalic: bool(),
    underline: bool(), isUnderline: bool(),
    strikeThrough: bool(), isStrikeThrough: bool(),
    rotation: { enum: PROPERTY_SPECS.rotation.values },
    markup: { enum: PROPERTY_SPECS.markup.values },
    pattern: {}, blankWhenNull: bool(), textAdjust: { enum: PROPERTY_SPECS.textAdjust.values },
    hTextAlign: { enum: PROPERTY_SPECS.hTextAlign.values },
    vTextAlign: { enum: PROPERTY_SPECS.vTextAlign.values },
    hAlign: { enum: PROPERTY_SPECS.hTextAlign.values },
    vAlign: { enum: PROPERTY_SPECS.vTextAlign.values },
    lineSpacing: {}, firstLineIndent: {}, leftIndent: {}, rightIndent: {},
    spacingBefore: {}, spacingAfter: {}, tabStopWidth: {},
    padding: {}, lineWidth: {}, lineStyle: {}, lineColor: {}, fill: {},
    radius: {}, direction: { enum: PROPERTY_SPECS.direction.values },
    scaleImage: { enum: PROPERTY_SPECS.scaleImage.values },
    onErrorType: { enum: PROPERTY_SPECS.onErrorType.values },
    usingCache: bool(), lazy: bool(), runToBottom: bool(), type: { enum: PROPERTY_SPECS.type.values },
    evaluationTime: { enum: EVALUATION_TIME }, evaluationGroup: {},
    bookmarkLevel: {}, hyperlinkType: { enum: PROPERTY_SPECS.linkType.values },
    hyperlinkTarget: {}, hyperlinkReference: {}, hyperlinkAnchor: {}, hyperlinkPage: {},
    hyperlinkTooltip: {}, hyperlinkParameters: {},
};

/** Attributes shared by the declaration family. */
function declarationAttrs(extra: Record<string, AttributeRule> = {}): Record<string, AttributeRule> {
    return { name: { required: true }, class: {}, ...extra };
}

export const ELEMENT_RULES: Readonly<Record<string, ElementRule>> = {
    // ── Report-level ────────────────────────────────────────────────────────
    jasperReport: {
        attrs: {
            name: { required: true },
            language: {},
            columnCount: {},
            printOrder: { enum: PRINT_ORDER },
            columnDirection: { enum: COLUMN_DIRECTION },
            pageWidth: {}, pageHeight: {},
            orientation: { enum: ORIENTATION },
            whenNoDataType: { enum: WHEN_NO_DATA_TYPE },
            sectionType: { enum: SECTION_TYPE },
            columnWidth: {}, columnSpacing: {},
            leftMargin: {}, rightMargin: {}, topMargin: {}, bottomMargin: {},
            isTitleNewPage: bool(),
            isSummaryNewPage: bool(),
            isSummaryWithPageHeaderAndFooter: bool(),
            isFloatColumnFooter: bool(),
            scriptletClass: {},
            resourceBundle: {},
            whenResourceMissingType: { enum: WHEN_RESOURCE_MISSING },
            isIgnorePagination: bool(),
            formatFactoryClass: {},
        },
        children: [
            'property', 'propertyExpression', 'import', 'template', 'reportFont',
            'style', 'subDataset', 'dataset', 'scriptlet', 'parameter', 'query',
            'field', 'sortField', 'variable', 'filterExpression', 'group',
            'background', 'title', 'pageHeader', 'columnHeader', 'detail',
            'columnFooter', 'pageFooter', 'lastPageFooter', 'summary', 'noData',
            'part',
        ],
    },
    property: { attrs: { name: { required: true }, value: {} } },
    propertyExpression: {
        attrs: {
            name: { required: true },
            type: { enum: PROPERTY_TYPE },
            evaluationTime: { enum: ['Early', 'Late', 'Report'] },
        },
    },
    import: { attrs: { value: { required: true } } },
    template: { attrs: { class: {} } },
    reportFont: { attrs: {}, openAttributes: true },
    scriptlet: { attrs: { name: {}, class: {} }, openAttributes: true },
    style: {
        attrs: {
            name: {}, default: bool(), isDefault: bool(), style: {},
            mode: { enum: PROPERTY_SPECS.mode.values },
            markup: { enum: PROPERTY_SPECS.markup.values },
            ...ELEMENT_STYLE_ATTRS,
        },
        openAttributes: true,
        children: ['pen', 'box', 'paragraph', 'conditionalStyle', 'property', 'propertyExpression'],
    },
    conditionalStyle: {
        attrs: { ...ELEMENT_STYLE_ATTRS },
        openAttributes: true,
        children: ['conditionExpression', 'pen', 'box', 'paragraph'],
    },
    subDataset: {
        attrs: { name: { required: true }, language: {} },
        openAttributes: true,
    },
    dataset: {
        attrs: { name: { required: true }, language: {} },
        openAttributes: true,
    },
    parameter: { attrs: declarationAttrs({ isForPrompting: bool(), uuid: {} }) },
    field: { attrs: declarationAttrs({ uuid: {} }) },
    variable: {
        attrs: declarationAttrs({
            calculation: { enum: CALCULATION },
            resetType: { enum: RESET_TYPE },
            resetGroup: {},
            incrementerFactoryClass: {},
            uuid: {},
        }),
    },
    sortField: {
        attrs: { name: {}, order: { enum: ORDER }, class: {}, type: {} },
        openAttributes: true,
    },
    query: { attrs: { language: {}, uuid: {} }, openAttributes: true },
    filterExpression: {},

    // ── Sections and bands ──────────────────────────────────────────────────
    // Classic reports make the section itself the band (`<title height="…">`
    // with elements directly inside), so sections carry band attributes and
    // accept any element: their child vocabulary is left open on purpose.
    background: SECTION_RULE,
    title: SECTION_RULE,
    pageHeader: SECTION_RULE,
    columnHeader: SECTION_RULE,
    detail: SECTION_RULE,
    columnFooter: SECTION_RULE,
    pageFooter: SECTION_RULE,
    lastPageFooter: SECTION_RULE,
    summary: SECTION_RULE,
    noData: SECTION_RULE,
    band: SECTION_RULE,
    group: {
        attrs: { name: { required: true }, minHeightToStartNewPage: {}, keepTogether: bool(), uuid: {} },
        openAttributes: true,
    },
    groupHeader: SECTION_RULE,
    groupFooter: SECTION_RULE,
    part: { attrs: { evaluationTime: { enum: ['Now', 'Report', 'Group'] }, evaluationGroup: {} }, openAttributes: true },

    // ── 6.x elements ────────────────────────────────────────────────────────
    reportElement: {
        attrs: REPORT_ELEMENT_ATTRS,
        children: ['property', 'propertyExpression', 'printWhenExpression'],
    },
    textElement: {
        attrs: { ...ELEMENT_STYLE_ATTRS },
        openAttributes: true,
        children: ['font', 'paragraph', 'property', 'propertyExpression'],
    },
    textField: {
        attrs: {
            isStretchWithOverflow: { deprecatedBy: 'textAdjust="StretchHeight"' },
            textAdjust: { enum: PROPERTY_SPECS.textAdjust.values },
            pattern: {},
            isBlankWhenNull: { deprecatedBy: 'blankWhenNull' },
            blankWhenNull: bool(),
            bookmarkLevel: {},
            evaluationTime: { enum: EVALUATION_TIME },
            evaluationGroup: {},
        },
        openAttributes: true,
        children: ['reportElement', 'textElement', 'textFieldExpression', 'patternExpression', 'property', 'propertyExpression'],
    },
    staticText: {
        attrs: {},
        openAttributes: true,
        children: ['reportElement', 'textElement', 'text', 'property', 'propertyExpression'],
    },
    image: {
        attrs: {},
        openAttributes: true,
        children: [
            'reportElement', 'box', 'graphicElement', 'imageExpression',
            'anchorNameExpression', 'hyperlinkReferenceExpression',
            'hyperlinkWhenExpression', 'hyperlinkAnchorExpression',
            'hyperlinkPageExpression', 'hyperlinkTooltipExpression',
            'hyperlinkParameter', 'property', 'propertyExpression',
        ],
    },
    line: { attrs: { direction: { enum: PROPERTY_SPECS.direction.values } }, children: ['reportElement', 'graphicElement'] },
    rectangle: { attrs: { radius: {} }, children: ['reportElement', 'graphicElement'] },
    ellipse: { attrs: {}, children: ['reportElement', 'graphicElement'] },
    frame: {
        attrs: {},
        openAttributes: true,
        children: ['reportElement', 'box', 'property', 'propertyExpression'],
    },
    subreport: {
        attrs: { isUsingCache: bool(), runToBottom: bool() },
        openAttributes: true,
        children: [
            'reportElement', 'subreportExpression', 'connectionExpression',
            'dataSourceExpression', 'datasetRun', 'subreportParameter', 'returnValue',
            'property', 'propertyExpression',
        ],
    },
    break: { attrs: { type: { enum: PROPERTY_SPECS.type.values } }, children: ['reportElement'] },
    component: { attrs: { kind: {} }, openAttributes: true },
    componentElement: { attrs: {}, openAttributes: true },
    datasetRun: {
        attrs: { subDataset: {}, uuid: {}, dataSourceExpression: {} },
        openAttributes: true,
        children: ['datasetParameter', 'parameter', 'connectionExpression', 'dataSourceExpression'],
    },
    datasetParameter: { attrs: { name: { required: true } }, openAttributes: true },
    subreportParameter: { attrs: { name: { required: true } }, openAttributes: true },
    returnValue: {
        attrs: { name: {}, toVariable: {}, calculation: { enum: CALCULATION }, incrementerFactoryClass: {} },
        openAttributes: true,
    },
    box: {
        attrs: { style: {}, padding: {}, border: {}, borderColor: {}, ...ELEMENT_STYLE_ATTRS },
        openAttributes: true,
        children: ['pen', 'topPen', 'leftPen', 'bottomPen', 'rightPen'],
    },
    pen: { attrs: { lineWidth: {}, lineStyle: {}, lineColor: {} }, openAttributes: true },
    topPen: { attrs: { lineWidth: {}, lineStyle: {}, lineColor: {} }, openAttributes: true },
    leftPen: { attrs: { lineWidth: {}, lineStyle: {}, lineColor: {} }, openAttributes: true },
    bottomPen: { attrs: { lineWidth: {}, lineStyle: {}, lineColor: {} }, openAttributes: true },
    rightPen: { attrs: { lineWidth: {}, lineStyle: {}, lineColor: {} }, openAttributes: true },
    font: {
        attrs: {
            fontName: {}, size: {}, isBold: bool(), isItalic: bool(),
            isUnderline: bool(), isStrikeThrough: bool(),
            pdfFontName: {}, pdfEncoding: {}, isPdfEmbedded: bool(),
        },
        openAttributes: true,
    },
    paragraph: {
        attrs: { lineSpacing: {}, firstLineIndent: {}, leftIndent: {}, rightIndent: {}, spacingBefore: {}, spacingAfter: {}, tabStopWidth: {} },
        openAttributes: true,
        children: ['tabStop'],
    },
    tabStop: { attrs: {}, openAttributes: true },
    text: { attrs: {} },
    description: { attrs: {} },

    // ── 7.x element form ────────────────────────────────────────────────────
    element: {
        attrs: {
            ...REPORT_ELEMENT_ATTRS,
            ...ELEMENT_STYLE_ATTRS,
            kind: { required: true, enum: ELEMENT_KINDS },
        },
        openAttributes: true,
    },
    expression: { attrs: {} },
    textFieldExpression: { attrs: {} },
    patternExpression: { attrs: {} },
    imageExpression: { attrs: {} },
    subreportExpression: { attrs: {} },
    connectionExpression: { attrs: {} },
    dataSourceExpression: { attrs: {} },
    variableExpression: { attrs: {} },
    initialValueExpression: { attrs: {} },
    groupExpression: { attrs: {} },
    conditionExpression: { attrs: {} },
    printWhenExpression: { attrs: {} },
    partNameExpression: { attrs: {} },
};

/**
 * Direct children of `<jasperReport>` in schema order. `query` and
 * `queryString` share a rank via TAG_ALIASES.
 */
export const REPORT_LEVEL_ORDER: readonly string[] = [
    'property', 'propertyExpression', 'import', 'template', 'reportFont', 'style',
    'subDataset', 'dataset', 'scriptlet', 'parameter', 'query', 'field',
    'sortField', 'variable', 'filterExpression', 'group', 'background', 'title',
    'pageHeader', 'columnHeader', 'detail', 'columnFooter', 'pageFooter',
    'lastPageFooter', 'summary', 'noData', 'part',
];
