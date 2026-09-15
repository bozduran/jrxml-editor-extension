// textRules.js
// Rendered-text rules ported from the hook's textrules package:
//   Unrenderable — replace characters that fail to render, one finding per
//                  distinct character
//   PeriodSpace  — ".A" -> ". A"
//   DoubleSpace  — collapse runs of 2+ spaces
//   Newline      — normalise line breaks to the element's markup token
//
// Every function returns the transformed text and appends human-readable
// findings, in the same order and wording as the hook.

const { literalEnd } = require('./javaExpr');

// codepoint → { replacement, name }. Order defines finding order.
const UNRENDERABLE = new Map([
    [0x00A0, { replacement: ' ',  name: 'non-breaking space' }],
    [0x2007, { replacement: ' ',  name: 'figure space' }],
    [0x2009, { replacement: ' ',  name: 'thin space' }],
    [0x200A, { replacement: ' ',  name: 'hair space' }],
    [0x202F, { replacement: ' ',  name: 'narrow no-break space' }],
    [0x200B, { replacement: '',   name: 'zero-width space' }],
    [0x00AD, { replacement: '',   name: 'soft hyphen' }],
    [0x2010, { replacement: '-',  name: 'hyphen' }],
    [0x2011, { replacement: '-',  name: 'non-breaking hyphen' }],
    [0x2012, { replacement: '-',  name: 'figure dash' }],
    [0x2013, { replacement: '-',  name: 'en dash' }],
    [0x2014, { replacement: '-',  name: 'em dash' }],
    [0x2015, { replacement: '-',  name: 'horizontal bar' }],
    [0x2018, { replacement: "'",  name: 'left single quote' }],
    [0x2019, { replacement: "'",  name: 'right single quote' }],
    [0x201A, { replacement: "'",  name: 'single low-9 quote' }],
    [0x201B, { replacement: "'",  name: 'reversed-9 single quote' }],
    [0x201C, { replacement: '"',  name: 'left double quote' }],
    [0x201D, { replacement: '"',  name: 'right double quote' }],
    [0x201E, { replacement: '"',  name: 'double low-9 quote' }],
    [0x201F, { replacement: '"',  name: 'reversed-9 double quote' }],
    [0x2022, { replacement: '-',  name: 'bullet' }],
    [0x2023, { replacement: '-',  name: 'triangular bullet' }],
    [0x2026, { replacement: '...', name: 'ellipsis' }],
]);

function quote(value) {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function occurrences(n) {
    return n === 1 ? '1 occurrence' : `${n} occurrences`;
}

/** Replace unrenderable characters; one finding per distinct character. */
function applyUnrenderable(text, findings) {
    let out = '';
    const seen = new Set();

    for (let i = 0; i < text.length; ) {
        const cp = text.codePointAt(i);
        const rule = UNRENDERABLE.get(cp);
        if (rule) {
            if (!seen.has(cp)) {
                seen.add(cp);
                const hex = cp.toString(16).toUpperCase().padStart(4, '0');
                findings.push(`replace ${rule.name} (U+${hex}) with ${quote(rule.replacement)}`);
            }
            out += rule.replacement;
        } else {
            out += String.fromCodePoint(cp);
        }
        i += cp > 0xFFFF ? 2 : 1;
    }

    return out;
}

/** Add a space after a '.' directly followed by an uppercase letter. */
function applyPeriodSpace(text, findings) {
    let count = 0;
    const out = text.replace(/\.([A-Z])/g, (_, letter) => {
        count++;
        return '. ' + letter;
    });
    if (count > 0) findings.push(`add space after '.' (${occurrences(count)})`);
    return out;
}

/** Collapse runs of two or more spaces to one. */
function applyDoubleSpace(text, findings) {
    let count = 0;
    const out = text.replace(/ {2,}/g, () => {
        count++;
        return ' ';
    });
    if (count > 0) findings.push(`remove double space (${occurrences(count)})`);
    return out;
}

/** Normalise newlines to the token implied by `markup`. */
function applyNewline(text, markup) {
    let token;
    switch (markup || '') {
        case 'styled': token = '<br/>'; break;
        case 'html':   token = '<br>';  break;
        case '':
        case 'none':   token = '\\n';   break;
        default:       return text;
    }
    return text.split('<br/>').join(token)
               .split('<br>').join(token)
               .split('\\n').join(token);
}

/** Full chain applied to rendered text content. */
function transformText(content, markup, findings) {
    let out = content;
    out = applyUnrenderable(out, findings);
    out = applyPeriodSpace(out, findings);
    out = applyDoubleSpace(out, findings);

    const normalized = applyNewline(out, markup);
    if (normalized !== out) {
        findings.push('normalize newline');
        out = normalized;
    }
    return out;
}

/** Literal-safe subset: no period rule, no newline rule. */
function transformLiteral(content, findings) {
    let out = content;
    out = applyUnrenderable(out, findings);
    out = applyDoubleSpace(out, findings);
    return out;
}

/**
 * Transform the string / text-block literals inside an expression, leaving code
 * and char literals untouched.
 *
 * Deviation from the hook: comments are copied verbatim. The hook's literal
 * scanner does not know about comments, so a quote inside a comment could be
 * rewritten; skipping comments is strictly safer.
 */
function transformExpression(content, isText, markup, findings) {
    let out = '';
    let i = 0;
    const n = content.length;

    while (i < n) {
        if (content.startsWith('//', i)) {
            const nl = content.indexOf('\n', i);
            const end = nl === -1 ? n : nl;
            out += content.slice(i, end);
            i = end;
            continue;
        }
        if (content.startsWith('/*', i)) {
            const close = content.indexOf('*/', i + 2);
            const end = close === -1 ? n : close + 2;
            out += content.slice(i, end);
            i = end;
            continue;
        }

        const end = literalEnd(content, i);
        if (end < 0) {
            out += content[i];
            i++;
            continue;
        }

        const quote = content[i];
        const textBlock = quote === '"' && content.startsWith('"""', i);
        const terminated = textBlock
            ? end >= i + 6 && content.startsWith('"""', end - 3)
            : end > i + 1 && content[end - 1] === quote;

        if (!terminated) {
            out += content.slice(i);
            break;
        }
        if (quote === "'") {
            out += content.slice(i, end); // char literals are never rewritten
            i = end;
            continue;
        }

        const innerStart = textBlock ? i + 3 : i + 1;
        const innerEnd = textBlock ? end - 3 : end - 1;
        const literal = content.slice(innerStart, innerEnd);

        out += content.slice(i, innerStart);
        out += isText ? transformText(literal, markup, findings) : transformLiteral(literal, findings);
        out += content.slice(innerEnd, end);
        i = end;
    }

    return out;
}

module.exports = {
    transformText,
    transformLiteral,
    transformExpression,
    applyUnrenderable,
    applyPeriodSpace,
    applyDoubleSpace,
    applyNewline,
    UNRENDERABLE,
};
