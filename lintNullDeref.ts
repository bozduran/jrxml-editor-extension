// lintNullDeref.ts
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

import { maskReferences } from './expressionMask';
import { parseExpression, childExpressions } from './javaParser';
import type { BinaryNode, JavaExpressionNode, MethodCallNode } from './javaParser';

export type NullDerefSigil = 'F' | 'P' | 'V';

function isSigil(value: string): value is NullDerefSigil {
    return value === 'F' || value === 'P' || value === 'V';
}

/** The reference behind a masked `$K_name_` name. */
export interface NullDerefReference {
    kind: NullDerefSigil;
    name: string;
    key: string;
    display: string;
}

/** One warning, with offsets relative to the checked expression. */
export interface NullDerefWarning {
    offset: number;
    length: number;
    message: string;
}

// ── Reference recognition ─────────────────────────────────────────────────────

/** The reference behind a masked `$K_name_` name, or null. */
function refName(node: JavaExpressionNode): NullDerefReference | null {
    const e = unwrap(node);
    if (e.kind !== 'name') return null;

    const id = e.name;
    if (id.length < 5 || id[0] !== '$' || id[2] !== '_' || id[id.length - 1] !== '_') return null;

    const kind = id.charAt(1);
    if (!isSigil(kind)) return null;

    const name = id.slice(3, id.length - 1);
    if (!name) return null;

    return { kind, name, key: `${kind}:${name}`, display: `$${kind}{${name}}` };
}

function unwrap(node: JavaExpressionNode): JavaExpressionNode {
    let e = node;
    while (e && e.kind === 'enclosed') e = e.expr;
    return e;
}

function union(base: ReadonlySet<string>, extra: ReadonlySet<string>): ReadonlySet<string> {
    if (extra.size === 0) return base;
    return new Set([...base, ...extra]);
}

// ── Null-check recognition ────────────────────────────────────────────────────

/** `ref == null` / `ref != null`, either operand order. */
function refComparedToNull(binary: BinaryNode): NullDerefReference | null {
    const left = refName(binary.left);
    if (left && unwrap(binary.right).kind === 'null') return left;

    const right = refName(binary.right);
    if (right && unwrap(binary.left).kind === 'null') return right;

    return null;
}

function isObjects(scope: JavaExpressionNode | null): boolean {
    if (!scope) return false;
    if (scope.kind === 'name') return scope.name === 'Objects';
    if (scope.kind === 'fieldAccess') return scope.name === 'Objects';
    return false;
}

function refWithNullArgument(args: readonly JavaExpressionNode[]): NullDerefReference | null {
    if (args.length !== 2) return null;

    const [left, right] = args;
    if (left === undefined || right === undefined) return null;

    const first = refName(left);
    if (first && unwrap(right).kind === 'null') return first;

    const second = refName(right);
    if (second && unwrap(left).kind === 'null') return second;

    return null;
}

function oneRefArgument(args: readonly JavaExpressionNode[]): NullDerefReference | null {
    const [only] = args;
    return only === undefined ? null : refName(only);
}

/** True when the call asserts the reference is null. */
function nullCheckCall(call: MethodCallNode): NullDerefReference | null {
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
function nonNullCall(call: MethodCallNode): NullDerefReference | null {
    if (call.name !== 'nonNull' || !isObjects(call.scope || null)) return null;
    return oneRefArgument(call.args);
}

/** References guaranteed non-null when `node` is true. */
function whenTrue(node: JavaExpressionNode): ReadonlySet<string> {
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
function whenFalse(node: JavaExpressionNode): ReadonlySet<string> {
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

function walk(
    node: JavaExpressionNode,
    nonNull: ReadonlySet<string>,
    warnings: NullDerefWarning[]
): void {
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
 * @param code raw expression text (no CDATA markers)
 * @returns warnings whose offsets are relative to `code`
 */
function checkNullDereference(code: string): NullDerefWarning[] {
    if (!code || code.trim() === '') return [];

    const ast = parseExpression(maskReferences(code));
    if (!ast) return [];

    const warnings: NullDerefWarning[] = [];
    walk(ast, new Set(), warnings);
    return warnings;
}

export { checkNullDereference, maskReferences, refName };
