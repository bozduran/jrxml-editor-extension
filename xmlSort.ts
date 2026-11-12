// xmlSort.ts
// The hook's `sort` step: reorder each band/frame container's direct <element>
// children by geometry (y then x, stable), moving each element's preceding
// trivia with it.
//
// Pure and vscode-free. Returns a single whole-file edit plus the hook's exact
// summary/warning description lines.

import { scanXml } from './xmlspan';
import type { XmlNode } from './xmlspan';
import type { Edit } from './edits';

/** One element positioned inside a band or frame. */
export interface SortChild {
    kind: string;
    x: number;
    y: number;
    w: number;
    h: number;
    start: number;
    end: number;
}

/** A band or frame whose direct `element` children can be reordered. */
export interface SortContainer {
    kind: string;
    innerStart: number;
    innerEnd: number;
    children: SortChild[];
}

/** The parsed document: every reorderable container plus coordinate warnings. */
export interface ParsedSort {
    containers: SortContainer[];
    warnings: string[];
}

/** A whole-file reorder edit and the hook's description lines. */
export interface SortFix {
    description: string;
    edit: Edit;
}

function isContainer(node: XmlNode): boolean {
    return node.tag === 'band' || (node.tag === 'element' && node.kind === 'frame');
}

function lineOf(text: string, offset: number): number {
    return text.slice(0, offset).split('\n').length;
}

/** Parse an integer attribute; missing or non-numeric yields 0 + a warning. */
function coordinate(element: XmlNode, name: string, text: string, warnings: string[]): number {
    const attr = element.attr(name);
    const value = attr ? attr.value.trim() : null;

    if (value === null || !/^[+-]?\d+$/.test(value)) {
        warnings.push(`warning: missing or non-numeric ${name} on ${element.kind} (line ${lineOf(text, element.startTag)})`);
        return 0;
    }
    return Number.parseInt(value, 10);
}

function toChild(element: XmlNode, text: string, warnings: string[]): SortChild {
    return {
        kind: element.kind,
        x:    coordinate(element, 'x', text, warnings),
        y:    coordinate(element, 'y', text, warnings),
        w:    coordinate(element, 'width', text, warnings),
        h:    coordinate(element, 'height', text, warnings),
        start: element.startTag,
        end:   element.end,
    };
}

export function parse(text: string): ParsedSort | null {
    const scan = scanXml(text);
    if (scan.error || !scan.doc) return null;

    const containers: SortContainer[] = [];
    const warnings: string[] = [];

    // Iterative pre-order walk: deep nesting must not overflow the stack.
    const stack: XmlNode[] = [scan.doc.root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) break;

        if (isContainer(node)) {
            const children = node.children
                .filter(child => child.tag === 'element')
                .map(child => toChild(child, text, warnings));
            containers.push({
                kind:       node.kind,
                innerStart: node.startTagEnd,
                innerEnd:   node.endTag >= 0 ? node.endTag : node.end,
                children,
            });
        }

        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }

    return { containers, warnings };
}

export function sortedChildren<T extends { x: number; y: number }>(children: readonly T[]): T[] {
    return [...children].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

export function reorderChanged(container: SortContainer): boolean {
    if (container.children.length < 2) return false;
    const sorted = sortedChildren(container.children);
    return sorted.some((child, i) => child !== container.children[i]);
}

export function rectsOverlap(a: SortChild, b: SortChild): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w
        && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function overlaps(children: readonly SortChild[]): [SortChild, SortChild][] {
    const out: [SortChild, SortChild][] = [];
    for (let i = 0; i < children.length; i++) {
        for (let j = i + 1; j < children.length; j++) {
            if (rectsOverlap(children[i], children[j])) out.push([children[i], children[j]]);
        }
    }
    return out;
}

function trailingWhitespace(text: string): string {
    let end = text.length;
    while (end > 0 && /\s/.test(text[end - 1])) end--;
    return text.slice(end);
}

function reorderContainer(text: string, container: SortContainer): string {
    if (!reorderChanged(container)) return text;

    const original = container.children;
    const sorted   = sortedChildren(original);
    const count    = original.length;

    const prefix = text.slice(container.innerStart, original[0].start);
    const prefixWhitespace = trailingWhitespace(prefix);
    const containerTrivia  = prefix.slice(0, prefix.length - prefixWhitespace.length);

    let separator = prefixWhitespace;
    if (separator === '') separator = trailingWhitespace(text.slice(original[0].end, original[1].start));
    if (separator === '') separator = '\n';

    let out = containerTrivia;
    for (const child of sorted) {
        const index = original.indexOf(child);
        if (index === 0) {
            out += separator + text.slice(original[0].start, child.end);
        } else {
            out += text.slice(original[index - 1].end, child.end);
        }
    }
    out += text.slice(original[count - 1].end, container.innerEnd);

    return text.slice(0, container.innerStart) + out + text.slice(container.innerEnd);
}

export function applyReorders(text: string, containers: readonly SortContainer[]): string {
    const ordered = [...containers].sort((a, b) => b.innerStart - a.innerStart);
    let result = text;
    for (const container of ordered) result = reorderContainer(result, container);
    return result;
}

function describe(child: SortChild): string {
    return `${child.kind}(${child.x},${child.y})`;
}

export function orderSummary(children: readonly SortChild[]): string {
    const before = children.map(describe).join(', ');
    const after  = sortedChildren(children).map(describe).join(', ');
    return `reorder [${before}] -> [${after}]`;
}

export function discoverSortFix(text: string): SortFix | null {
    const parsed = parse(text);
    if (!parsed) return null;

    const changed = parsed.containers.filter(reorderChanged);
    if (changed.length === 0) return null;

    const details = [...parsed.warnings];
    for (const container of changed) {
        details.push(orderSummary(container.children));
        for (const [a, b] of overlaps(container.children)) {
            details.push(`warning: overlap ${describe(a)} <-> ${describe(b)}`);
        }
    }

    return {
        description: details.join('\n'),
        edit: { start: 0, end: text.length, replacement: applyReorders(text, parsed.containers) },
    };
}
