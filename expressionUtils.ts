// expressionUtils.ts
// Finds the JRXML expression element that the cursor is currently inside.

import type * as vscode from 'vscode';
import { EXPRESSION_TAGS } from './expressionTags';
import { findReferenceToken } from './referenceTokens';
import { scanXml } from './xmlspan';
import type { XmlScanResult } from './xmlspan';
import { regions, regionAt } from './expressionRegions';

/** A document the scan cache can key on and revalidate by version + text. */
export interface ScannableDocument {
    getText(): string;
    readonly version: number;
}

interface CachedScan {
    version: number;
    text: string;
    scan: XmlScanResult;
}

const scanCache = new WeakMap<object, CachedScan>();

function scanOf(document: ScannableDocument): XmlScanResult {
    const text = document.getText();
    const cached = scanCache.get(document);
    if (cached && cached.version === document.version && cached.text === text) return cached.scan;
    const scan = scanXml(text);
    scanCache.set(document, { version: document.version, text, scan });
    return scan;
}

/** The expression region at an offset, or null. */
function findExpressionRegionAt(
    document: ScannableDocument,
    offset: number,
    tags: readonly string[] = EXPRESSION_TAGS
) {
    const text = document.getText();
    const found = regions(scanOf(document), text)
        .filter(region => tags.includes(region.tag));
    return regionAt(found, offset);
}

/** An expression element under the cursor and the span of its content. */
export interface ExpressionAtCursor {
    tagName: string;
    expression: string;
    range: vscode.Range;
    fullMatch: string;
    innerStart: number;
    innerEnd: number;
}

type RangeConstructor = new (start: vscode.Position, end: vscode.Position) => vscode.Range;

function lazyRangeConstructor(): RangeConstructor {
    // The unit test installs a Module._load stub, so 'vscode' must resolve at
    // call time rather than at module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy resolution
    const vscodeModule = require('vscode') as { Range: RangeConstructor };
    return vscodeModule.Range;
}

/**
 * Find the expression element the cursor is inside.
 * Returns { tagName, expression, range } or null.
 */
function findExpressionAtCursor(
    document: vscode.TextDocument,
    position: vscode.Position
): ExpressionAtCursor | null {
    const offset = document.offsetAt(position);
    const region = findExpressionRegionAt(document, offset);

    if (!region) return null;

    const Range = lazyRangeConstructor();
    return {
        tagName: region.tag,
        expression: region.expression,
        range: new Range(
            document.positionAt(region.start),
            document.positionAt(region.end)
        ),
        fullMatch: region.fullMatch,
        innerStart: region.innerStart,
        innerEnd: region.innerEnd,
    };
}

/** Strip CDATA markers from expression content. */
function stripCdata(text: string): string {
    return text
        .replace(/^\s*<!\[CDATA\[/, '')
        .replace(/\]\]>\s*$/, '')
        .trim();
}

/** Wrap expression back in CDATA if it originally had it. */
function wrapExpression(expr: string, useCdata: boolean): string {
    if (useCdata) {
        return `<![CDATA[${expr}]]>`;
    }
    return expr;
}

/** Detect whether the original tag content used CDATA. */
function hasCdata(rawInner: string): boolean {
    return /^\s*<!\[CDATA\[/.test(rawInner);
}

function escapeRegExp(text: string): string {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The declaration fields the offset lookup reads. */
export interface DeclarationNameSpan {
    name: string;
    nameOffset: number;
}

/** A parse result's declaration lists, in the shapes the offset lookup reads. */
export interface DeclarationLookupSource<D extends DeclarationNameSpan> {
    allFields?: readonly D[];
    allParameters?: readonly D[];
    allVariables?: readonly D[];
    fields?: readonly D[];
    parameters?: readonly D[];
    variables?: readonly D[];
}

export type ExpressionSigil = 'F' | 'P' | 'V';

export interface DeclarationAtOffset<D extends DeclarationNameSpan> {
    sigil: ExpressionSigil;
    name: string;
    declaration: D;
}

/**
 * Find a declaration whose `name` attribute contains the character offset.
 *
 * @param parsed the parser's declaration lists
 * @param offset document character offset
 */
function findDeclarationAtOffset<D extends DeclarationNameSpan>(
    parsed: DeclarationLookupSource<D> | null,
    offset: number
): DeclarationAtOffset<D> | null {
    if (!parsed) return null;

    const groups: [ExpressionSigil, readonly D[]][] = [
        ['F', parsed.allFields || parsed.fields || []],
        ['P', parsed.allParameters || parsed.parameters || []],
        ['V', parsed.allVariables || parsed.variables || []],
    ];

    for (const [sigil, list] of groups) {
        for (const declaration of list) {
            if (!declaration || !declaration.name) continue;
            if (typeof declaration.nameOffset !== 'number') continue;
            if (offset >= declaration.nameOffset &&
                offset <= declaration.nameOffset + declaration.name.length) {
                return { sigil, name: declaration.name, declaration };
            }
        }
    }
    return null;
}

/** The replacement span and text for one expression tag. */
export interface TagReplacement {
    startOffset: number;
    endOffset: number;
    newTag: string;
    useCdata: boolean;
}

/**
 * Compute the replacement for the expression tag closest to `originalOffset`.
 *
 * Re-scans the live document text so a stale range from when a panel opened
 * can never apply twice. The new expression is wrapped in CDATA when the
 * original content used it.
 *
 * @param text current document text
 * @param tagName e.g. "textFieldExpression"
 * @param originalOffset character offset of the original expression tag
 * @param newExpression expression text to write inside the tag
 */
function findTagReplacement(
    text: string,
    tagName: string,
    originalOffset: number,
    newExpression: string
): TagReplacement | null {
    if (!text || !tagName) return null;

    const safeTag = escapeRegExp(tagName);
    const tagPattern = new RegExp(
        `(<${safeTag}(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/${safeTag}>)`,
        'g'
    );

    let best: { index: number; openTag: string; innerOld: string; closeTag: string } | null = null;
    let bestDistance = Infinity;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(text)) !== null) {
        const distance = Math.abs(match.index - originalOffset);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = { index: match.index, openTag: match[1], innerOld: match[2], closeTag: match[3] };
        }
    }

    if (!best) return null;

    const useCdata = hasCdata(best.innerOld);
    return {
        startOffset: best.index,
        endOffset: best.index + best.openTag.length + best.innerOld.length + best.closeTag.length,
        newTag: best.openTag + wrapExpression(newExpression, useCdata) + best.closeTag,
        useCdata,
    };
}

export {
    findExpressionAtCursor,
    findExpressionRegionAt,
    findTagReplacement,
    findReferenceToken,
    findDeclarationAtOffset,
    stripCdata,
    wrapExpression,
    hasCdata,
    EXPRESSION_TAGS,
};
