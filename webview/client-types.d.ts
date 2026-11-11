// Shapes used by the design-view browser client.
//
// The client is inlined as a plain script (no imports/exports), so it cannot
// import the host's designModel types. These declarations mirror the
// JSON-serializable model that designViewHtml embeds; keep them in sync with
// designModel.ts when the payload changes. The client is deliberately tolerant
// of missing optional fields because a panel update may race a model change.

interface DesignReport {
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

interface DesignStyleSummary {
    name: string;
    default: boolean;
}

interface DesignStyle {
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
    mode: string;
}

interface DesignContent {
    tag: string;
    raw: string;
    cdata: boolean;
    nested: boolean;
    mixed: boolean;
    truncated: boolean;
    missing: boolean;
    editable: boolean;
}

interface DesignBox {
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

interface DesignLine {
    direction: string;
    width: number;
    style: string;
    color: string;
}

interface DesignElement {
    kind: string;
    offset: number;
    end: number;
    x: number;
    y: number;
    width: number;
    height: number;
    displayText?: string;
    tooltip?: string;
    attrs?: Record<string, string>;
    style?: DesignStyle;
    box?: DesignBox;
    line?: DesignLine | null;
    content?: DesignContent | null;
    children?: DesignElement[];
}

interface DesignBand {
    key: string;
    label: string;
    group: string;
    height: number;
    offset: number;
    end: number;
    elements: DesignElement[];
}

interface DesignModel {
    format: string;
    error: string | null;
    unsupported: string | null;
    report: DesignReport;
    bands: DesignBand[];
    styles: DesignStyleSummary[];
    warnings: string[];
    truncated: boolean;
    counts: { bands: number; elements: number };
}

interface SelectionTarget {
    kind: 'element' | 'band';
    offset: number;
    end: number;
}

interface Geometry {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface GeometryLike {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface BandRow {
    band: DesignBand;
    top: number;
    displayHeight: number;
}

interface DragState {
    pointerId: number;
    mode: 'move' | 'resize';
    handle: string | null;
    node: HTMLElement;
    element: DesignElement;
    startClientX: number;
    startClientY: number;
    startGeometry: Geometry;
    geometry: Geometry | null;
    started: boolean;
}

interface CompletionPlaceholder {
    start: number;
    end: number;
}

interface CompletionItem {
    label: string;
    kind?: string;
    detail?: string;
    documentation?: string;
    filterText?: string;
    insertTextPlain?: string;
    placeholder?: CompletionPlaceholder | null;
}

interface CompletionReplace {
    start: number;
    end: number;
}

interface CompletionResult {
    items: CompletionItem[];
    mode?: string;
    prefix?: string;
    replace?: CompletionReplace | null;
}

interface WebviewState {
    editMode?: boolean;
    followCursor?: boolean;
}

interface HostMessage {
    command?: string;
    model?: DesignModel | null;
    fileName?: string;
    version?: number | null;
    target?: SelectionTarget | null;
    result?: CompletionResult | null;
    requestId?: number;
    reason?: string;
    message?: string;
}

/** A design-view edit patch; its inner shape is owned by designEdit.ts. */
interface DesignPatch {
    [key: string]: unknown;
}

interface InspectorInputs {
    x: HTMLInputElement;
    y: HTMLInputElement;
    width: HTMLInputElement;
    height: HTMLInputElement;
    text: HTMLTextAreaElement;
    textApply: HTMLButtonElement;
    fontName: HTMLInputElement;
    fontSize: HTMLInputElement;
    bold: HTMLInputElement;
    italic: HTMLInputElement;
    underline: HTMLInputElement;
    strike: HTMLInputElement;
    hAlign: HTMLSelectElement;
    vAlign: HTMLSelectElement;
    rotation: HTMLSelectElement;
    markup: HTMLSelectElement;
    mode: HTMLSelectElement;
    forecolor: HTMLInputElement;
    backcolor: HTMLInputElement;
    style: HTMLSelectElement;
    positionType: HTMLSelectElement;
    stretchType: HTMLSelectElement;
    printRepeated: HTMLInputElement;
    removeLine: HTMLInputElement;
    printFirstWhole: HTMLInputElement;
    printDetail: HTMLInputElement;
    printGroup: HTMLInputElement;
    evaluationTime: HTMLSelectElement;
    evaluationGroup: HTMLInputElement;
    bookmarkLevel: HTMLInputElement;
    key: HTMLInputElement;
    textAdjust: HTMLSelectElement;
    pattern: HTMLInputElement;
    blankNull: HTMLInputElement;
    scaleImage: HTMLSelectElement;
    hImageAlign: HTMLSelectElement;
    vImageAlign: HTMLSelectElement;
    onError: HTMLSelectElement;
    linkType: HTMLSelectElement;
    usingCache: HTMLInputElement;
    lazy: HTMLInputElement;
    lineDirection: HTMLSelectElement;
    lineWidth: HTMLInputElement;
    lineStyle: HTMLSelectElement;
    lineColor: HTMLInputElement;
    radius: HTMLInputElement;
    breakType: HTMLSelectElement;
    subreportCache: HTMLInputElement;
    runToBottom: HTMLInputElement;
    boxBorder: HTMLInputElement;
    boxWidth: HTMLInputElement;
    boxStyle: HTMLSelectElement;
    boxColor: HTMLInputElement;
    boxPadding: HTMLInputElement;
    newAttrName: HTMLInputElement;
    newAttrValue: HTMLInputElement;
    addAttribute: HTMLButtonElement;
}
