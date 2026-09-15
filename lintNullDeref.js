// lintNullDeref.js
// The hook's `unchecked-null-dereference` rule: warn when a $F/$P/$V reference
// is the receiver of a method call without a dominating null check.
//
// Short-circuit aware, exactly like the hook:
//   $V{v} != null && $V{v}.foo()          safe
//   $V{v} == null || $V{v}.foo()          safe
//   $V{v} != null ? $V{v}.foo() : ""      safe (the null branch is still checked)
//   !($V{v} == null) && $V{v}.foo()       safe
//   EQUALS($V{v}, null) ? "" : $V{v}.foo() safe
//   Objects.nonNull($V{v}) && $V{v}.foo()  safe
//   $V{v}.foo()                            flagged
//
// References are masked to same-length identifiers before parsing so the AST
// offsets map back to the raw expression. Anything that is not parseable Java
// (or a reference name that is not an identifier) is skipped, never guessed at.

const { literalEnd } = require('./javaExpr');
const { parseExpression, childExpressions } = require('./javaParser');

const KINDS = new Set(['F', 'P', 'V']);

// ── Masking ───────────────────────────────────────────────────────────────────

/**
 * Replace `$F{name}` / `$P{name}` / `$V{name}` with `$F_name_` (same length) so
 * the text parses as Java. Literals are copied unchanged, so a reference inside
 * a string or char literal is never masked.
 */
function maskReferences(code) {
    let out = '';
    let i = 0;
    const n = code.length;

    while (i < n) {
        const end = literalEnd(code, i);
        if (end > i) {
            out += code.slice(i, end);
            i = end;
            continue;
        }

        const c = code[i];
        if (c === '$' && i + 2 < n) {
            const kind = code[i + 1];
            if (KINDS.has(kind) && code[i + 2] === '{') {
                const close = code.indexOf('}', i + 3);
                if (close > i + 3) {
                    const name = code.slice(i + 3, close);
                    const masked = `$${kind}_${name}_`;
                    if (masked.length === close + 1 - i && isIdentifier(name)) {
                        out += masked;
                        i = close + 1;
                        continue;
                    }
                }
            }
        }

        out += c;
        i++;
    }

    return out;
}

function isIdentifier(name) {
    if (!name || !/[A-Za-z_]/.test(name[0])) return false;
    for (let i = 1; i < name.length; i++) {
        if (!/[A-Za-z0-9_]/.test(name[i])) return false;
    }
    return true;
}

// ── Reference recognition ─────────────────────────────────────────────────────

/** The reference behind a masked `$K_name_` name, or null. */
function refName(node) {
    const e = unwrap(node);
    if (e.kind !== 'name') return null;

    const id = e.name;
    if (id.length < 5 || id[0] !== '$' || id[2] !== '_' || id[id.length - 1] !== '_') return null;

    const kind = id[1];
    if (!KINDS.has(kind)) return null;

    const name = id.slice(3, id.length - 1);
    if (!name) return null;

    return { kind, name, key: `${kind}:${name}`, display: `$${kind}{${name}}` };
}

function unwrap(node) {
    let e = node;
    while (e && e.kind === 'enclosed') e = e.expr;
    return e;
}

function union(base, extra) {
    if (extra.size === 0) return base;
    return new Set([...base, ...extra]);
}

// ── Null-check recognition ────────────────────────────────────────────────────

/** `ref == null` / `ref != null`, either operand order. */
function refComparedToNull(binary) {
    const left = refName(binary.left);
    if (left && unwrap(binary.right).kind === 'null') return left;

    const right = refName(binary.right);
    if (right && unwrap(binary.left).kind === 'null') return right;

    return null;
}

function isObjects(scope) {
    if (!scope) return false;
    if (scope.kind === 'name') return scope.name === 'Objects';
    if (scope.kind === 'fieldAccess') return scope.name === 'Objects';
    return false;
}

function refWithNullArgument(args) {
    if (args.length !== 2) return null;

    const first = refName(args[0]);
    if (first && unwrap(args[1]).kind === 'null') return first;

    const second = refName(args[1]);
    if (second && unwrap(args[0]).kind === 'null') return second;

    return null;
}

function oneRefArgument(args) {
    return args.length === 1 ? refName(args[0]) : null;
}

/** True when the call asserts the reference is null. */
function nullCheckCall(call) {
    const name = call.name || '';
    const scope = call.scope || null;

    if (!scope && name.toLowerCase() === 'equals') return refWithNullArgument(call.args);
    if (isObjects(scope)) {
        if (name === 'equals') return refWithNullArgument(call.args);
        if (name === 'isNull') return oneRefArgument(call.args);
    }
    return null;
}

/** True when the call asserts the reference is non-null (Objects.nonNull). */
function nonNullCall(call) {
    if (call.name !== 'nonNull' || !isObjects(call.scope || null)) return null;
    return oneRefArgument(call.args);
}

/** References guaranteed non-null when `node` is true. */
function whenTrue(node) {
    const e = unwrap(node);

    if (e.kind === 'unary' && e.op === '!') return whenFalse(e.expr);

    if (e.kind === 'binary') {
        if (e.op === '&&') return union(whenTrue(e.left), whenTrue(e.right));
        if (e.op === '!=') {
            const ref = refComparedToNull(e);
            return ref ? new Set([ref.key]) : new Set();
        }
        return new Set();
    }

    if (e.kind === 'methodCall') {
        const ref = nonNullCall(e);
        return ref ? new Set([ref.key]) : new Set();
    }

    return new Set();
}

/** References guaranteed non-null when `node` is false. */
function whenFalse(node) {
    const e = unwrap(node);

    if (e.kind === 'unary' && e.op === '!') return whenTrue(e.expr);

    if (e.kind === 'binary') {
        if (e.op === '||') return union(whenFalse(e.left), whenFalse(e.right));
        if (e.op === '==') {
            const ref = refComparedToNull(e);
            return ref ? new Set([ref.key]) : new Set();
        }
        return new Set();
    }

    if (e.kind === 'methodCall') {
        const ref = nullCheckCall(e);
        return ref ? new Set([ref.key]) : new Set();
    }

    return new Set();
}

// ── Flow walk ─────────────────────────────────────────────────────────────────

function walk(node, nonNull, warnings) {
    const e = unwrap(node);
    if (!e) return;

    if (e.kind === 'conditional') {
        walk(e.cond, nonNull, warnings);
        walk(e.then, union(nonNull, whenTrue(e.cond)), warnings);
        walk(e.els,  union(nonNull, whenFalse(e.cond)), warnings);
        return;
    }

    if (e.kind === 'binary') {
        if (e.op === '&&') {
            walk(e.left, nonNull, warnings);
            walk(e.right, union(nonNull, whenTrue(e.left)), warnings);
            return;
        }
        if (e.op === '||') {
            walk(e.left, nonNull, warnings);
            walk(e.right, union(nonNull, whenFalse(e.left)), warnings);
            return;
        }
        walk(e.left, nonNull, warnings);
        walk(e.right, nonNull, warnings);
        return;
    }

    if (e.kind === 'methodCall') {
        if (e.scope) {
            const receiver = refName(e.scope);
            if (receiver) {
                if (!nonNull.has(receiver.key)) {
                    warnings.push({
                        offset:  e.start,
                        length:  receiver.display.length,
                        message: `${receiver.display} may be null when .${e.name}(...) is called; check it for null first`,
                    });
                }
            } else {
                walk(e.scope, nonNull, warnings);
            }
        }
        for (const argument of e.args) walk(argument, nonNull, warnings);
        return;
    }

    if (e.kind === 'cast') {
        walk(e.expr, nonNull, warnings);
        return;
    }

    for (const child of childExpressions(e)) walk(child, nonNull, warnings);
}

/**
 * @param {string} code raw expression text (no CDATA markers)
 * @returns {{ offset:number, length:number, message:string }[]} offsets relative to `code`
 */
function checkNullDereference(code) {
    if (!code || code.trim() === '') return [];

    const ast = parseExpression(maskReferences(code));
    if (!ast) return [];

    const warnings = [];
    walk(ast, new Set(), warnings);
    return warnings;
}

module.exports = { checkNullDereference, maskReferences, refName };
