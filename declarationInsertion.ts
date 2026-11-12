// declarationInsertion.ts
// Where a new <field>/<parameter>/<variable> belongs: at report level, in the
// XSD order, after the last declaration of the same kind. Nested subreport
// parameters and dataset members are never insertion anchors.

import { scanXml } from './xmlspan';

/** Declaration kinds this module can place in the report-level XSD order. */
export type DeclarationTag = 'field' | 'parameter' | 'variable';

const TARGET_RANK: Readonly<Record<string, number>> = { parameter: 0, field: 2, variable: 4 };

const CHILD_RANK: Readonly<Record<string, number>> = {
    // Elements that precede declarations in the JRXML schema.
    property: -5, propertyExpression: -5, import: -5,
    template: -5, reportFont: -5, style: -5,
    parameter: 0,
    query: 1,
    field: 2,
    sortField: 3,
    variable: 4,
    filter: 5, filterExpression: 5,
};

/** Offset where a declaration of `tagName` should be inserted. */
export function findInsertionPoint(text: string, tagName: string): number {
    const targetRank = TARGET_RANK[tagName];
    if (targetRank === undefined) return closingTagOffset(text);

    const scan = scanXml(text);
    if (scan.error || !scan.doc || scan.doc.root.tag !== 'jasperReport') {
        return closingTagOffset(text);
    }

    const root = scan.doc.root;

    // After the last declaration of the same kind (report level only).
    const sameKind = root.children.filter(child => child.tag === tagName);
    if (sameKind.length > 0) return sameKind[sameKind.length - 1].end;

    // Otherwise before the first element that must follow this kind.
    const next = root.children.find(child => rankOf(child.tag) > targetRank);
    if (next) return next.startTag;

    return root.endTag >= 0 ? root.endTag : root.end;
}

function rankOf(tag: string): number {
    return CHILD_RANK[tag] ?? 10;
}

function closingTagOffset(text: string): number {
    const close = text.lastIndexOf('</jasperReport>');
    return close === -1 ? text.length : close;
}
