// layoutRules.ts
// Static layout checks that JasperReports otherwise reports only at compile
// time: columns that do not fit the page, band heights that exceed the space
// between the margins, and elements that extend below their band or frame.
//
// Pure and vscode-free; diagnosticsProvider maps findings to VS Code ranges.

import { scanXml } from './xmlspan';
import type { XmlDocument, XmlNode, XmlScanResult } from './xmlspan';

import { BAND_TAGS } from './jrxmlSections';

/** A layout finding in character offsets. */
export interface LayoutFinding {
    code: string;
    message: string;
    offset: number;
    length: number;
}

interface PageMetrics {
    pageWidth: number | null;
    pageHeight: number | null;
    columnWidth: number | null;
    columnCount: number;
    columnSpacing: number;
    leftMargin: number;
    rightMargin: number;
    topMargin: number;
    bottomMargin: number;
}

export function checkLayout(text: string, providedScan: XmlScanResult | null = null): LayoutFinding[] {
    const scan = providedScan || scanXml(text);
    if (scan.error || !scan.doc || scan.doc.root.tag !== 'jasperReport') return [];

    const root    = scan.doc.root;
    const page    = pageMetrics(root);
    const findings: LayoutFinding[] = [];

    checkColumns(root, page, findings);
    checkBandHeights(root, page, findings);
    checkElementBounds(scan.doc, findings);

    return findings;
}

function pageMetrics(root: XmlNode): PageMetrics {
    return {
        pageWidth:     intAttr(root, 'pageWidth'),
        pageHeight:    intAttr(root, 'pageHeight'),
        columnWidth:   intAttr(root, 'columnWidth'),
        columnCount:   intAttr(root, 'columnCount') ?? 1,
        columnSpacing: intAttr(root, 'columnSpacing') ?? 0,
        leftMargin:    intAttr(root, 'leftMargin') ?? 0,
        rightMargin:   intAttr(root, 'rightMargin') ?? 0,
        topMargin:     intAttr(root, 'topMargin') ?? 0,
        bottomMargin:  intAttr(root, 'bottomMargin') ?? 0,
    };
}

function checkColumns(root: XmlNode, page: PageMetrics, findings: LayoutFinding[]): void {
    if (page.pageWidth === null || page.columnWidth === null) return;

    const spacing = Math.max(0, page.columnCount - 1) * page.columnSpacing;
    const used = page.leftMargin + page.columnCount * page.columnWidth
        + spacing + page.rightMargin;

    if (used <= page.pageWidth) return;

    findings.push(finding(
        'jrxml.layout.columns',
        `Report columns (${page.columnCount} × ${page.columnWidth}px) plus margins need ${used}px, but the page is ${page.pageWidth}px wide.`,
        root
    ));
}

function checkBandHeights(root: XmlNode, page: PageMetrics, findings: LayoutFinding[]): void {
    if (page.pageHeight === null) return;

    const available = page.pageHeight - page.topMargin - page.bottomMargin;
    const sum = sectionHeight(root, 'pageHeader')
        + sectionHeight(root, 'columnHeader')
        + detailHeight(root)
        + sectionHeight(root, 'columnFooter')
        + Math.max(sectionHeight(root, 'pageFooter'), sectionHeight(root, 'lastPageFooter'));

    if (sum <= available) return;

    findings.push(finding(
        'jrxml.layout.bandHeight',
        `Band heights need ${sum}px but only ${available}px fit between the margins (page ${page.pageHeight}px, margins ${page.topMargin}+${page.bottomMargin}).`,
        root
    ));
}

/** Height of a direct report section, reading a classic wrapper's <band>. */
function sectionHeight(root: XmlNode, tag: string): number {
    const node = root.children.find(child => child.tag === tag);
    if (!node) return 0;

    const direct = intAttr(node, 'height');
    if (direct !== null) return direct;

    return Math.max(0, ...node.children
        .filter(child => child.tag === 'band')
        .map(band => intAttr(band, 'height') ?? 0));
}

/** The tallest detail band; detail bands are alternatives, not a sum. */
function detailHeight(root: XmlNode): number {
    const detail = root.children.find(child => child.tag === 'detail');
    if (!detail) return 0;

    return Math.max(0, ...detail.children
        .filter(child => child.tag === 'band')
        .map(band => intAttr(band, 'height') ?? 0));
}

function checkElementBounds(doc: XmlDocument, findings: LayoutFinding[]): void {
    for (const node of doc.walk()) {
        const positioned = node.tag === 'element' || node.tag === 'reportElement';
        if (!positioned) continue;

        const y      = intAttr(node, 'y');
        const height = intAttr(node, 'height');
        if (y === null || height === null) continue;

        const container = nearestContainer(node);
        if (!container) {
            if (!hasBandAncestor(node)) {
                findings.push(finding(
                    'jrxml.layout.elementOutsideBand',
                    'Element is positioned but is not inside a band.',
                    node
                ));
            }
            continue;
        }

        if (y + height <= container.height) continue;

        findings.push(finding(
            'jrxml.layout.elementOutsideBand',
            `Element ends at ${y + height}px but its ${container.label} is only ${container.height}px tall.`,
            node
        ));
    }
}

/**
 * Nearest ancestor that bounds the element: anything with a height attribute
 * (band, contents, Studio 7 frame), or a classic <frame> whose <reportElement>
 * carries the height.
 */
function nearestContainer(node: XmlNode): { height: number; label: string } | null {
    let parent = node.parent;
    while (parent) {
        const height = intAttr(parent, 'height');
        if (height !== null) {
            const label = parent.tag === 'element'
                ? (parent.attrValue('kind') || 'element')
                : parent.tag;
            return { height, label };
        }

        if (parent.tag === 'frame') {
            const reportElement = parent.children.find(child => child.tag === 'reportElement');
            const frameHeight = reportElement ? intAttr(reportElement, 'height') : null;
            if (frameHeight !== null) return { height: frameHeight, label: 'frame' };
        }

        parent = parent.parent;
    }
    return null;
}

function hasBandAncestor(node: XmlNode): boolean {
    return node.ancestors().some(ancestor => BAND_TAGS.has(ancestor.tag));
}

function intAttr(node: XmlNode, name: string): number | null {
    const attr = node.attr(name);
    if (!attr) return null;
    const value = parseInt(attr.value, 10);
    return Number.isFinite(value) ? value : null;
}

function finding(code: string, message: string, node: XmlNode): LayoutFinding {
    return {
        code,
        message,
        offset: node.startTag,
        length: node.startTagEnd - node.startTag,
    };
}
