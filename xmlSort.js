// xmlSort.js
// The hook's `sort` step: reorder each band/frame container's direct <element>
// children by geometry (y then x, stable), moving each element's preceding
// trivia with it.
//
// Pure and vscode-free. Returns a single whole-file edit plus the hook's exact
// summary/warning description lines.

const { scanXml } = require('./xmlspan');

function isContainer(node) {
    return node.tag === 'band' || (node.tag === 'element' && node.kind === 'frame');
}

function lineOf(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

/** Parse an integer attribute; missing or non-numeric yields 0 + a warning. */
function coordinate(element, name, text, warnings) {
    const attr = element.attr(name);
    const value = attr ? attr.value.trim() : null;

    if (value === null || !/^[+-]?\d+$/.test(value)) {
        warnings.push(`warning: missing or non-numeric ${name} on ${element.kind} (line ${lineOf(text, element.startTag)})`);
        return 0;
    }
    return Number.parseInt(value, 10);
}

function toChild(element, text, warnings) {
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

function parse(text) {
    const scan = scanXml(text);
    if (scan.error) return null;

    const containers = [];
    const warnings   = [];

    // Iterative pre-order walk: deep nesting must not overflow the stack.
    const stack = [scan.doc.root];
    while (stack.length > 0) {
        const node = stack.pop();

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

function sortedChildren(children) {
    return [...children].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function reorderChanged(container) {
    if (container.children.length < 2) return false;
    const sorted = sortedChildren(container.children);
    return sorted.some((child, i) => child !== container.children[i]);
}

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w
        && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlaps(children) {
    const out = [];
    for (let i = 0; i < children.length; i++) {
        for (let j = i + 1; j < children.length; j++) {
            if (rectsOverlap(children[i], children[j])) out.push([children[i], children[j]]);
        }
    }
    return out;
}

function trailingWhitespace(text) {
    let end = text.length;
    while (end > 0 && /\s/.test(text[end - 1])) end--;
    return text.slice(end);
}

function reorderContainer(text, container) {
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

function applyReorders(text, containers) {
    const ordered = [...containers].sort((a, b) => b.innerStart - a.innerStart);
    let result = text;
    for (const container of ordered) result = reorderContainer(result, container);
    return result;
}

function describe(child) {
    return `${child.kind}(${child.x},${child.y})`;
}

function orderSummary(children) {
    const before = children.map(describe).join(', ');
    const after  = sortedChildren(children).map(describe).join(', ');
    return `reorder [${before}] -> [${after}]`;
}

/**
 * @returns {{ description:string, edit:{start:number,end:number,replacement:string} }|null}
 */
function discoverSortFix(text) {
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

module.exports = {
    discoverSortFix,
    parse,
    sortedChildren,
    reorderChanged,
    overlaps,
    rectsOverlap,
    applyReorders,
    orderSummary,
};
