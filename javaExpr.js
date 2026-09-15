// javaExpr.js
// Java-expression spacing formatter, ported from the hook's JavaExpr/AST rules.
//
// The hook masks string/char/text-block literals and JasperReports
// $F{}/$P{}/$V{}/$P!{} references, parses the result as Java, and applies edits
// from the AST. This port keeps the masking step but uses a scoped, conservative
// token walk instead of a full Java parser:
//
//   - binary == != <= >= && || always get exactly one surrounding space
//   - < and > get spaces only when they are NOT part of a generic type argument
//   - ternary ? and : get spaces only when they pair as a conditional
//   - a comma followed by a non-space gets one space
//   - an uppercase reference-type cast (Type)x gets a space: (Type) x
//
// Literals and references are never modified. When the input does not look like
// well-formed Java (unbalanced brackets, unterminated literal) the whole
// expression is returned unchanged, matching the hook's "never guess" policy.

const MASK_PREFIX = '__jrxml_';

// ── Masking ───────────────────────────────────────────────────────────────────

/**
 * Replace literals and JasperReports references with identifier-shaped
 * placeholders so the remaining text can be tokenised as plain Java.
 */
function maskLiteralsAndRefs(code) {
    let out = '';
    const replacements = [];
    let terminated = true;
    let i = 0;
    const n = code.length;

    while (i < n) {
        if (code.startsWith('"""', i)) {
            const end = scanTextBlock(code, i + 3);
            if (!(end >= i + 6 && code.startsWith('"""', end - 3))) terminated = false;
            replacements.push(code.slice(i, end));
            out += MASK_PREFIX + (replacements.length - 1) + '__';
            i = end;
            continue;
        }
        const c = code[i];
        if (c === '"' || c === "'") {
            const end = scanQuoted(code, i, c);
            if (!(end > i + 1 && code[end - 1] === c)) terminated = false;
            replacements.push(code.slice(i, end));
            out += MASK_PREFIX + (replacements.length - 1) + '__';
            i = end;
            continue;
        }
        if (c === '$' && i + 1 < n && /[A-Za-z]/.test(code[i + 1])) {
            const end = scanJrReference(code, i);
            replacements.push(code.slice(i, end));
            out += MASK_PREFIX + (replacements.length - 1) + '__';
            i = end;
            continue;
        }
        out += c;
        i++;
    }

    return { text: out, replacements, terminated };
}

function unmask(text, replacements) {
    let result = text;
    for (let k = replacements.length - 1; k >= 0; k--) {
        result = result.split(MASK_PREFIX + k + '__').join(replacements[k]);
    }
    return result;
}

/**
 * Index one past the Java literal starting at `start` (string, char or the
 * opening `"""` of a text block), or -1 when no literal starts there.
 * Unterminated literals extend to the end of the input.
 */
function literalEnd(code, start) {
    if (start < 0 || start >= code.length) return -1;
    if (code.startsWith('"""', start)) return scanTextBlock(code, start + 3);
    const c = code[start];
    if (c === '"' || c === "'") return scanQuoted(code, start, c);
    return -1;
}

function scanQuoted(s, start, quote) {
    let i = start + 1;
    while (i < s.length) {
        const c = s[i];
        if (c === '\\') { i += 2; continue; }
        if (c === quote) return i + 1;
        i++;
    }
    return s.length;
}

function scanTextBlock(s, start) {
    let i = start;
    while (i + 2 < s.length) {
        const c = s[i];
        if (c === '\\') { i += 2; continue; }
        if (s.startsWith('"""', i)) return i + 3;
        i++;
    }
    return s.length;
}

function scanJrReference(s, start) {
    let i = start + 1;
    if (i < s.length && /[A-Za-z]/.test(s[i])) i++;
    if (i < s.length && s[i] === '!') i++;
    if (i < s.length && s[i] === '{') {
        const close = s.indexOf('}', i + 1);
        return close < 0 ? s.length : close + 1;
    }
    return start + 1;
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

const OPERATORS = [
    '>>>=', '>>>', '>>=', '<<=', '...', '->', '::', '++', '--', '&&', '||',
    '==', '!=', '<=', '>=', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=',
    '|=', '^=', '<', '>', '=', '!', '~', '?', ':', '+', '-', '*', '/', '%',
    '&', '|', '^', '.', ',', '(', ')', '[', ']', '{', '}', ';', '@',
];

const NUMBER_RE = /^(?:0[xX][0-9a-fA-F_]+[lL]?|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?[fFdDlL]?|\.\d[\d_]*(?:[eE][+-]?\d+)?[fFdDlL]?)/;

function tokenize(code) {
    const tokens = [];
    let i = 0;
    const n = code.length;

    while (i < n) {
        const c = code[i];

        if (/\s/.test(c)) {
            const start = i;
            while (i < n && /\s/.test(code[i])) i++;
            tokens.push({ type: 'ws', value: code.slice(start, i), start, end: i });
            continue;
        }
        if (code.startsWith('//', i)) {
            const start = i;
            i += 2;
            while (i < n && code[i] !== '\n') i++;
            tokens.push({ type: 'comment', value: code.slice(start, i), start, end: i });
            continue;
        }
        if (code.startsWith('/*', i)) {
            const start = i;
            i += 2;
            while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
            i = Math.min(n, i + 2);
            tokens.push({ type: 'comment', value: code.slice(start, i), start, end: i });
            continue;
        }
        if (/[A-Za-z_$]/.test(c)) {
            const start = i;
            while (i < n && /[A-Za-z0-9_$]/.test(code[i])) i++;
            tokens.push({ type: 'ident', value: code.slice(start, i), start, end: i });
            continue;
        }

        const numMatch = NUMBER_RE.exec(code.slice(i));
        if (numMatch) {
            tokens.push({ type: 'number', value: numMatch[0], start: i, end: i + numMatch[0].length });
            i += numMatch[0].length;
            continue;
        }

        const op = OPERATORS.find(o => code.startsWith(o, i));
        if (op) {
            tokens.push({ type: 'op', value: op, start: i, end: i + op.length });
            i += op.length;
            continue;
        }

        tokens.push({ type: 'punct', value: c, start: i, end: i + 1 });
        i++;
    }

    return tokens;
}

// ── Structure helpers ─────────────────────────────────────────────────────────

// Null-prototype map: a token named `valueOf`/`constructor` must not resolve to
// Object.prototype members when used as a key.
const OPENERS = Object.assign(Object.create(null), { '(': ')', '[': ']', '{': '}' });

function bracketsBalanced(sig) {
    const stack = [];
    for (const t of sig) {
        if (OPENERS[t.value]) stack.push(OPENERS[t.value]);
        else if (t.value === ')' || t.value === ']' || t.value === '}') {
            if (stack.pop() !== t.value) return false;
        }
    }
    return stack.length === 0;
}

/** Tokens (by index) that belong to a generic type-argument list. */
function findGenericTokenIndices(sig) {
    const detect = buildDetectTokens(sig);
    const inside = new Set();

    for (let i = 0; i < detect.length; i++) {
        if (detect[i].value !== '<' || i === 0) continue;

        const prev = detect[i - 1];
        const prevOk = prev.type === 'ident'
            || prev.value === '>' || prev.value === ']' || prev.value === '.' || prev.value === '?';
        if (!prevOk) continue;

        const end = matchTypeArgs(detect, i);
        if (end === -1) continue;

        const after = detect[end + 1];
        if (!after) continue;
        const afterOk = after.type === 'ident'
            || ['(', ')', '[', ']', '.', ',', '>', '{', '}', ':', '::', '&', '?', '<', '='].includes(after.value);
        if (!afterOk) continue;

        for (let k = i; k <= end; k++) inside.add(detect[k].orig);
        i = end;
    }

    return inside;
}

/**
 * A detection view of the token stream where `>>` / `>>>` (and their
 * assignment forms) are split into single `>` tokens, so nested generic
 * closers are matched. Each entry keeps the index of the real token so the
 * result can be mapped back for spacing decisions.
 */
function buildDetectTokens(sig) {
    const detect = [];
    sig.forEach((t, orig) => {
        const leading = /^>+/.exec(t.value);
        if (leading && (t.value === '>>' || t.value === '>>>' || t.value === '>=' || t.value === '>>=' || t.value === '>>>=')) {
            for (let k = 0; k < leading[0].length; k++) detect.push({ type: 'op', value: '>', orig });
            const rest = t.value.slice(leading[0].length);
            if (rest) detect.push({ type: 'op', value: rest, orig });
            return;
        }
        detect.push({ type: t.type, value: t.value, orig });
    });
    return detect;
}

/** Index of the `>` closing the type-argument list opening at `lt`, or -1. */
function matchTypeArgs(sig, lt) {
    // Empty diamond: `new HashMap<>()`
    if (sig[lt + 1] && sig[lt + 1].value === '>') return lt + 1;

    let k = lt + 1;
    for (;;) {
        const next = matchTypeArg(sig, k);
        if (next === -1) return -1;
        k = next;
        if (sig[k] && sig[k].value === ',') { k++; continue; }
        if (sig[k] && sig[k].value === '>') return k;
        return -1;
    }
}

function matchTypeArg(sig, k) {
    if (sig[k] && sig[k].value === '?') {
        k++;
        if (sig[k] && (sig[k].value === 'extends' || sig[k].value === 'super')) return matchType(sig, k + 1);
        return k;
    }
    return matchType(sig, k);
}

function matchType(sig, k) {
    if (!sig[k] || sig[k].type !== 'ident') return -1;
    k++;
    for (;;) {
        if (sig[k] && sig[k].value === '<') {
            const end = matchTypeArgs(sig, k);
            if (end === -1) return -1;
            k = end + 1;
        }
        if (sig[k] && sig[k].value === '.') {
            if (!sig[k + 1] || sig[k + 1].type !== 'ident') return -1;
            k += 2;
            continue;
        }
        break;
    }
    while (sig[k] && sig[k].value === '[' && sig[k + 1] && sig[k + 1].value === ']') k += 2;
    return k;
}

/** Indices of `?` and `:` tokens that form a conditional expression. */
function findTernaryIndices(sig, generics) {
    const questions = new Set();
    const colons = new Set();

    for (let i = 0; i < sig.length; i++) {
        if (sig[i].value !== '?' || generics.has(i)) continue;

        let pending = 1;
        for (let j = i + 1; j < sig.length; j++) {
            const v = sig[j].value;
            if (v === '?') {
                if (!generics.has(j)) pending++;
            } else if (v === ':') {
                if (generics.has(j)) continue;
                pending--;
                if (pending === 0) {
                    questions.add(i);
                    colons.add(j);
                    break;
                }
            } else if (v === ';') {
                break;
            }
        }
    }

    return { questions, colons };
}

const SPACED_BINARY = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const CAST_FOLLOW = new Set([
    '(', '!', '~', '++', '--', 'new', 'this', 'super', 'true', 'false', 'null',
]);

// ── Formatter ─────────────────────────────────────────────────────────────────

/**
 * Format the spacing of a Java expression. Returns the input unchanged when it
 * is not confidently parseable.
 */
function formatExpression(code) {
    if (code === null || code === undefined || code.trim() === '') return code;

    const mask = maskLiteralsAndRefs(code);
    if (!mask.terminated) return code;

    const tokens = tokenize(mask.text);
    const sig = tokens.filter(t => t.type !== 'ws' && t.type !== 'comment');
    if (sig.length === 0 || !bracketsBalanced(sig)) return code;

    const generics = findGenericTokenIndices(sig);
    const { questions, colons } = findTernaryIndices(sig, generics);
    const edits = [];

    const spaceAround = (index) => {
        const prev = sig[index - 1];
        const next = sig[index + 1];
        if (!prev || !next) return;
        // Never rewrite a span that contains a comment.
        const between = mask.text.slice(prev.end, next.start);
        if (between.includes('/*') || between.includes('//')) return;
        edits.push({ start: prev.end, end: next.start, replacement: ` ${sig[index].value} ` });
    };

    for (let i = 0; i < sig.length; i++) {
        const t = sig[i];
        if (t.type !== 'op') continue;

        if (SPACED_BINARY.has(t.value)) {
            spaceAround(i);
        } else if ((t.value === '<' || t.value === '>') && !generics.has(i)) {
            spaceAround(i);
        } else if (t.value === '?' && questions.has(i)) {
            spaceAround(i);
        } else if (t.value === ':' && colons.has(i)) {
            spaceAround(i);
        } else if (t.value === ',') {
            const after = mask.text[t.end];
            if (after !== undefined && !/\s/.test(after)) {
                edits.push({ start: t.end, end: t.end, replacement: ' ' });
            }
        }
    }

    // Uppercase reference-type cast: (Type)x -> (Type) x
    for (let i = 0; i < sig.length; i++) {
        if (sig[i].value !== '(') continue;

        let k = i + 1;
        let typeText = '';
        while (sig[k] && sig[k].value !== ')') {
            if (sig[k].type === 'ident' || sig[k].value === '.') typeText += sig[k].value;
            else { typeText = null; break; }
            k++;
        }
        if (typeText === null || !sig[k] || sig[k].value !== ')') continue;
        if (!/^[A-Z][A-Za-z0-9_$.]*$/.test(typeText)) continue;

        const after = sig[k + 1];
        if (!after) continue;
        // Whitespace immediately after ')' means the cast is already spaced.
        if (/\s/.test(mask.text[sig[k].end] || '')) continue;
        if (after.value === ')' || after.value === '.' || after.value === '::' || after.value === '[') continue;

        const isCastFollow = after.type === 'ident' || after.type === 'number'
            || after.value === '(' || CAST_FOLLOW.has(after.value);
        if (!isCastFollow) continue;

        edits.push({ start: after.start, end: after.start, replacement: ' ' });
    }

    if (edits.length === 0) return code;

    let formatted = applyEdits(mask.text, edits);
    formatted = unmask(formatted, mask.replacements);
    return formatted;
}

/** Apply highest-offset first, skipping any that overlap an already-applied one. */
function applyEdits(text, edits) {
    const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
    let out = text;
    let lastStart = Infinity;
    for (const edit of sorted) {
        if (edit.end > lastStart) continue; // overlap — drop the later edit
        out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
        lastStart = edit.start;
    }
    return out;
}

module.exports = {
    formatExpression,
    maskLiteralsAndRefs,
    unmask,
    tokenize,
    literalEnd,
    bracketsBalanced,
    findGenericTokenIndices,
    findTernaryIndices,
    MASK_PREFIX,
};
