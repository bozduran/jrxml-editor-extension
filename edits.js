// edits.js
// Offset-based edit application for .jrxml documents.
//
// An edit is { start, end, replacement } in CHARACTER offsets. Edits are applied
// highest-offset first and overlapping edits are rejected rather than silently
// mangling the document.

/**
 * @typedef {{ start:number, end:number, replacement:string }} Edit
 */

/** Return the first overlapping pair of edits, or null. */
function findOverlap(edits) {
    const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end) {
            return [sorted[i - 1], sorted[i]];
        }
    }
    return null;
}

/**
 * Apply edits to `text`.
 * @param {string} text
 * @param {Edit[]} edits
 * @returns {string}
 * @throws {Error} when two edits overlap
 */
function applyEdits(text, edits) {
    if (!edits || edits.length === 0) return text;

    const overlap = findOverlap(edits);
    if (overlap) {
        throw new Error(
            `overlapping edits: [${overlap[0].start},${overlap[0].end}) and [${overlap[1].start},${overlap[1].end})`
        );
    }

    const sorted = [...edits].sort((a, b) => b.start - a.start);
    let out = text;
    for (const edit of sorted) {
        out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
    }
    return out;
}

/**
 * Widen `[start, end)` to whole lines when the span is alone on its line
 * (nothing but whitespace before it and after it). Consumes the line
 * terminator so deleting a declaration does not leave a blank line behind.
 * Returns the original span otherwise, so neighbouring elements and
 * same-line comments are never touched.
 *
 * @returns {{ start:number, end:number }}
 */
function lineAwareSpan(text, start, end) {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    if (text.slice(lineStart, start).trim() !== '') return { start, end };

    const nl = text.indexOf('\n', end);
    const after = nl === -1 ? text.slice(end) : text.slice(end, nl);
    if (after.trim() !== '') return { start, end };

    return { start: lineStart, end: nl === -1 ? text.length : nl + 1 };
}

module.exports = { applyEdits, findOverlap, lineAwareSpan };
