// expressionFormatter.js
// Formats a Java/JasperReports expression into a readable multi-line form.

/**
 * Main entry point.
 * @param {string} expr      Raw expression string
 * @param {number} indentSize  Spaces per indent level
 * @returns {string} Formatted expression
 */
function formatExpression(expr, indentSize = 4) {
    if (!expr || !expr.trim()) return expr;

    const indent = ' '.repeat(indentSize);
    let result = expr.trim();

    // 1. Collapse all whitespace runs to single spaces (outside strings)
    result = normalizeWhitespace(result);

    // 2. Format ternary chains: only if there's a top-level `?`
    result = formatTernary(result, indent);

    // 3. Format method chains: only if 3+ chained CALLS (not field access)
    //    and only when not already broken by ternary formatting
    if (!result.includes('\n')) {
        result = formatMethodChain(result, indent);
    }

    // 4. Break long lines at top-level && / || / +
    //    only if still single-line
    if (!result.includes('\n')) {
        result = formatBinaryOperators(result, indent);
    }

    // 5. Expand long argument lists — using a proper paren-aware scanner
    result = formatLongArgumentLists(result, indent);

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 – Whitespace normalization
// ─────────────────────────────────────────────────────────────────────────────

function normalizeWhitespace(expr) {
    const parts = splitRespectingStrings(expr);
    return parts.map((p, i) => {
        if (i % 2 !== 0) return p;           // inside string — untouched
        return p.replace(/[ \t]+/g, ' ')      // collapse spaces/tabs
                .replace(/\n\s*/g, '\n');      // normalize newline indentation
    }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 – Ternary formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatTernary(expr, indent) {
    if (!hasTopLevelChar(expr, '?')) return expr;

    // Split into segments: [condition, thenBranch, elseBranch, ...]
    // Each `?` opens a then-branch, each `:` at depth=0 closes it.
    // We only handle the FIRST level here; nested ternaries in branches
    // are handled recursively.
    const segments = splitTernary(expr);
    if (!segments) return expr;  // didn't parse cleanly

    return buildTernaryString(segments, indent, 0);
}

/**
 * Split `condition ? then : else` at the top level.
 * Returns { cond, then, else } or null.
 */
function splitTernary(expr) {
    let depth = 0, inStr = false, strCh = '';
    let condEnd = -1, thenEnd = -1;

    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === strCh) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }

        if (ch === '?' && depth === 0 && condEnd === -1) {
            condEnd = i;
        } else if (ch === ':' && depth === 0 && condEnd !== -1 && thenEnd === -1) {
            thenEnd = i;
        }
    }

    if (condEnd === -1 || thenEnd === -1) return null;

    return {
        cond: expr.slice(0, condEnd).trim(),
        then: expr.slice(condEnd + 1, thenEnd).trim(),
        els:  expr.slice(thenEnd + 1).trim()
    };
}

function buildTernaryString(seg, indent, level) {
    const pad  = indent.repeat(level);
    const pad1 = indent.repeat(level + 1);

    // Recursively format nested ternaries in branches
    const thenStr = hasTopLevelChar(seg.then, '?')
        ? (() => { const s = splitTernary(seg.then); return s ? '\n' + buildTernaryString(s, indent, level + 2) : seg.then; })()
        : seg.then;

    const elsStr = hasTopLevelChar(seg.els, '?')
        ? (() => { const s = splitTernary(seg.els); return s ? '\n' + buildTernaryString(s, indent, level + 2) : seg.els; })()
        : seg.els;

    return [
        pad  + seg.cond,
        pad1 + '? ' + thenStr,
        pad1 + ': ' + elsStr
    ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 – Method chain formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Only break on `.methodName(` patterns — NOT on plain field access like
 * `$F{x}.something` or `net.sf.jasper` package references.
 * Requires at least 3 chained CALLS before splitting.
 */
function formatMethodChain(expr, indent) {
    // Count top-level method calls (dot followed by identifier then open paren)
    const callCount = countTopLevelMethodCalls(expr);
    if (callCount < 3) return expr;

    let result = '';
    let depth  = 0, inStr = false, strCh = '';
    let i = 0;

    while (i < expr.length) {
        const ch = expr[i];

        if (inStr) {
            result += ch;
            if (ch === '\\') { result += expr[++i]; }
            i++;
            if (ch === strCh) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; result += ch; i++; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; result += ch; i++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth--; result += ch; i++; continue; }

        // Only break at top-level `.identifier(` — method CALL, not field access
        if (ch === '.' && depth === 0 && i > 0) {
            // Peek ahead: is it identifier followed by `(`?
            const rest = expr.slice(i + 1);
            const m = rest.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/);
            if (m) {
                result += '\n' + indent + '.';
                i++;
                continue;
            }
        }

        result += ch;
        i++;
    }
    return result;
}

function countTopLevelMethodCalls(expr) {
    let count = 0, depth = 0, inStr = false, strCh = '';
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === strCh) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
        if (ch === '.' && depth === 0) {
            const rest = expr.slice(i + 1);
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/.test(rest)) count++;
        }
    }
    return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 – Binary operator line-breaking
// ─────────────────────────────────────────────────────────────────────────────

function formatBinaryOperators(expr, indent) {
    // Only break if the whole expression is longer than 100 chars
    if (expr.length < 100) return expr;

    const ops = ['&&', '||'];   // removed `+` — too aggressive for string concat
    let result = '', depth = 0, inStr = false, strCh = '';
    let i = 0;

    while (i < expr.length) {
        const ch = expr[i];

        if (inStr) {
            result += ch;
            if (ch === '\\') { result += expr[++i]; }
            i++;
            if (ch === strCh) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; result += ch; i++; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; result += ch; i++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth--; result += ch; i++; continue; }

        if (depth === 0) {
            let found = false;
            for (const op of ops) {
                if (expr.startsWith(op, i)) {
                    // Trim trailing space, then op, then newline+indent
                    result = result.trimEnd();
                    result += ' ' + op + '\n' + indent;
                    i += op.length;
                    while (i < expr.length && expr[i] === ' ') i++;
                    found = true;
                    break;
                }
            }
            if (found) continue;
        }

        result += ch;
        i++;
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 – Long argument list expansion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans for function calls whose argument span is > 80 chars,
 * then puts each argument on its own line.
 * Uses a character-level scanner so nested parens don't confuse it.
 */
function formatLongArgumentLists(expr, indent) {
    let result = '';
    let i = 0;

    while (i < expr.length) {
        // Find next `identifier(`
        const identMatch = expr.slice(i).match(/^([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*\(/);
        if (!identMatch) {
            result += expr[i++];
            continue;
        }

        const fnName  = identMatch[1];
        const parenStart = i + identMatch[0].length - 1; // index of `(`

        // Find the matching closing paren
        const parenEnd = findMatchingParen(expr, parenStart);
        if (parenEnd === -1) {
            // No match found — emit as-is
            result += expr[i++];
            continue;
        }

        const argsText = expr.slice(parenStart + 1, parenEnd);

        // Only expand if the argument block is long enough AND has multiple args
        if (argsText.length > 60) {
            const args = splitTopLevelCommas(argsText);
            if (args.length >= 2) {
                // Recursively format each argument (handles nested calls)
                const formattedArgs = args
                    .map(a => indent + formatLongArgumentLists(a.trim(), indent + '    '))
                    .join(',\n');
                result += fnName + '(\n' + formattedArgs + '\n' + indent.slice(0, Math.max(0, indent.length - 4)) + ')';
                i = parenEnd + 1;
                continue;
            }
        }

        // Short enough — emit unchanged
        result += expr.slice(i, parenEnd + 1);
        i = parenEnd + 1;
    }

    return result;
}

/**
 * Given the index of `(`, return the index of the matching `)`.
 * Returns -1 if not found.
 */
function findMatchingParen(expr, openIdx) {
    let depth = 0, inStr = false, strCh = '';
    for (let i = openIdx; i < expr.length; i++) {
        const ch = expr[i];
        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === strCh) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared low-level helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True if `char` appears at depth=0 outside strings */
function hasTopLevelChar(expr, char) {
    let depth = 0, inStr = false, strCh = '';
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === strCh) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === char && depth === 0) return true;
    }
    return false;
}

/**
 * Split string into alternating outside/inside-string parts.
 * Even indices = outside strings, odd = inside string literals.
 */
function splitRespectingStrings(expr) {
    const parts = [];
    let buf = '', i = 0;

    while (i < expr.length) {
        const ch = expr[i];
        if (ch === '"' || ch === "'") {
            parts.push(buf); buf = ch; i++;
            while (i < expr.length) {
                const c = expr[i];
                buf += c;
                if (c === '\\') { buf += expr[++i]; i++; continue; }
                if (c === ch)   { i++; break; }
                i++;
            }
            parts.push(buf); buf = '';
        } else {
            buf += ch; i++;
        }
    }
    parts.push(buf);
    return parts;
}

function splitTopLevelCommas(str) {
    const result = [];
    let depth = 0, inStr = false, strCh = '', buf = '';

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (inStr) {
            buf += ch;
            if (ch === '\\') { buf += str[++i]; continue; }
            if (ch === strCh) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; buf += ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; buf += ch; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth--; buf += ch; continue; }
        if (ch === ',' && depth === 0) { result.push(buf); buf = ''; continue; }
        buf += ch;
    }
    if (buf) result.push(buf);
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// On-save lightweight cleanup (comma/operator spacing only — no line breaks)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeCommaSpacing(expr) {
    if (!expr || !expr.trim()) return expr;
    try {
        const parts = splitRespectingStrings(expr);
        return parts.map((p, i) => {
            if (i % 2 !== 0) return p; // inside string — untouched
            return p
                .replace(/\s*,\s*/g, ', ')
                .replace(/\s*;\s*/g, '; ')
                .replace(/([^!<>=])\s*(==|!=|<=|>=|&&|\|\|)\s*/g, '$1 $2 ')
                .replace(/([^ \t\n]) {2,}/g, '$1 ');
        }).join('');
    } catch (_) {
        return expr;
    }
}

module.exports = { formatExpression, normalizeCommaSpacing };
