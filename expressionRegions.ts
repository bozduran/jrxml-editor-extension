// expressionRegions.ts
// The expression elements of a report, derived from the XML scan tree.
//
// One region record carries the whole-element span and the content span, so the
// editor, completion and diagnostics ask the same question of the same data.

import { EXPRESSION_TAGS } from './expressionTags';
import type { XmlScanResult } from './xmlspan';

/** One expression-bearing element and the content span inside it. */
export interface ExpressionRegion {
    tag: string;
    start: number;
    end: number;
    innerStart: number;
    innerEnd: number;
    expression: string;
    contentStart: number;
    cdata: boolean;
    fullMatch: string;
}

const REGION_TAGS: ReadonlySet<string> = new Set([...EXPRESSION_TAGS, 'query']);

function stripExpressionContent(raw: string): string {
    return String(raw ?? '')
        .replace(/^\s*<!\[CDATA\[/, '')
        .replace(/\]\]>\s*$/, '')
        .trim();
}

/** Every expression-bearing element in document order. */
export function regions(scan: XmlScanResult | null, text: string = ''): ExpressionRegion[] {
    if (!scan || scan.error || !scan.doc) return [];

    const source = typeof text === 'string' ? text : '';
    const found: ExpressionRegion[] = [];

    for (const node of scan.doc.walk()) {
        if (!REGION_TAGS.has(node.tag)) continue;

        const start      = node.startTag;
        const end        = node.end;
        const innerStart = node.startTagEnd;
        const innerEnd   = node.endTag >= 0 ? node.endTag : node.end;
        const raw        = source ? source.slice(innerStart, innerEnd) : node.textContent();
        const expression = stripExpressionContent(raw);
        const index      = expression ? raw.indexOf(expression) : -1;

        found.push({
            tag: node.tag,
            start,
            end,
            innerStart,
            innerEnd,
            expression,
            contentStart: index >= 0 ? innerStart + index : innerStart,
            cdata: /^\s*<!\[CDATA\[/.test(raw),
            fullMatch: source ? source.slice(start, end) : '',
        });
    }

    return found;
}

/** The innermost region containing `offset`, or null. */
export function regionAt(
    found: readonly ExpressionRegion[] | null | undefined,
    offset: number
): ExpressionRegion | null {
    let best: ExpressionRegion | null = null;
    for (const region of found || []) {
        if (offset < region.start || offset > region.end) continue;
        if (!best || (region.end - region.start) < (best.end - best.start)) best = region;
    }
    return best;
}

export function forEachRegion(
    found: readonly ExpressionRegion[] | null | undefined,
    callback: (region: ExpressionRegion) => void
): void {
    for (const region of found || []) callback(region);
}
