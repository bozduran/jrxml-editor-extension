// memberResolver.ts
// Answers one question: what type is the expression immediately before a `.`?
//
// `$F{CustomerName}.` → java.lang.String, `$V{total}.` → java.math.BigDecimal,
// `$F{items}.get(0).` → the element type when it can be known, otherwise an
// honest "unresolved" with a reason the completion provider can explain.
//
// The receiver is peeled from the right — reference, literal, method call, `new`
// — which is all a single Java expression can contain, and the return types come
// from an injected `lookup` so this module stays vscode-free and testable.

import type { Ambiguity, MemberLookup } from './jdkMemberIndex';

export const MAX_DEPTH = 8;

export type ReferenceSigil = 'F' | 'P' | 'V';

export type ResolutionReason =
    | 'ok'
    | 'unknown-ref'
    | 'no-class'
    | 'unknown-type'
    | 'ambiguous'
    | 'unknown-method'
    | 'no-return-type'
    | 'type-variable'
    | 'unknown-return-type'
    | 'not-a-receiver'
    | 'too-deep';

export interface Resolution {
    resolved: boolean;
    reason: ResolutionReason;
    typeKey: string | null;
    declaredType: string | null;
    sigil?: ReferenceSigil;
    name?: string;
    reference?: string;
    methodName?: string;
    ambiguity?: Ambiguity | null;
    chain?: string[];
}

export interface TrailingReference {
    sigil: ReferenceSigil;
    name: string;
    start: number;
    reference: string;
}

export interface Declaration {
    readonly name: string;
    readonly type?: string;
    readonly fullType?: string;
    readonly typeSource?: string;
}

export interface Declarations {
    readonly fields?: readonly Declaration[];
    readonly parameters?: readonly Declaration[];
    readonly variables?: readonly Declaration[];
}

export interface MethodSignature {
    readonly name: string;
    readonly params?: readonly string[];
    readonly returns?: string;
    readonly varargs?: boolean;
}

export interface ResolverContext {
    readonly declarations?: Declarations;
    readonly lookup: (typeKey: string | null) => MemberLookup | null | undefined;
}

const REFERENCE_RE = /\$(F|P|V)\{([^{}]*)\}$/;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const NUMBER_LITERALS: readonly { re: RegExp; type: string }[] = [
    { re: /0[xX][0-9a-fA-F_]+[lL]?$/, type: 'int' },
    { re: /\d[\d_]*[lL]$/, type: 'long' },
    { re: /\d[\d_]*\.\d[\d_]*[fF]$|\.\d[\d_]*[fF]$|\d[\d_]*[fF]$/, type: 'float' },
    { re: /\d[\d_]*\.\d[\d_]*([dD])?$|\.\d[\d_]*([dD])?$|\d[\d_]*[dD]$/, type: 'double' },
    { re: /\d[\d_]*$/, type: 'int' },
];

function outcome(reason: ResolutionReason, extra: Partial<Resolution> = {}): Resolution {
    // `extra` often carries a resolved receiver for context; the failure must
    // win, so `resolved`/`reason` are set after the spread.
    return { typeKey: null, declaredType: null, ...extra, resolved: false, reason };
}

/** A `$F{Name}` / `$P{Name}` / `$V{Name}` reference directly before the dot. */
export function matchTrailingReference(text: string): TrailingReference | null {
    const match = REFERENCE_RE.exec(text);
    if (!match) return null;
    return {
        sigil: match[1] as ReferenceSigil,
        name: match[2].trim(),
        start: match.index,
        reference: match[0],
    };
}

/** Index of the `(` matching the `)` at the end of `text`, or -1. */
export function matchingOpenParen(text: string): number {
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i--) {
        const ch = text[i];

        if (ch === '"' || ch === "'") {
            // Skip the whole literal; unterminated literals mean "not a receiver".
            const start = findLiteralStart(text, i, ch);
            if (start === -1) return -1;
            i = start;
            continue;
        }
        if (ch === ')') depth++;
        else if (ch === '(') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Index of the opening quote of the literal ending at `end`, or -1. */
function findLiteralStart(text: string, end: number, quote: string): number {
    for (let i = end - 1; i >= 0; i--) {
        if (text[i] === '\\') { i--; continue; }
        if (text[i] === quote) return i;
    }
    return -1;
}

/** Top-level argument count of `(a, b(c), "d,e")`. */
export function countArguments(inner: string): number {
    const text = inner.trim();
    if (!text) return 0;

    let count = 1;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (ch === '"' || ch === "'") {
            i++;
            while (i < text.length && text[i] !== ch) {
                if (text[i] === '\\') i++;
                i++;
            }
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
        else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) count++;
    }
    return count;
}

/** Can this member be selected for a call with `argCount` arguments? */
export function arityMatches(member: MethodSignature, argCount: number): boolean {
    const params = member.params || [];
    if (argCount === params.length) return true;
    return !!member.varargs && argCount >= params.length - 1;
}

/**
 * Resolve a `$F/$P/$V` reference to a member list.
 * `context.declarations` holds the parsed report declarations; the first match
 * wins (fields, then parameters, then variables).
 */
function resolveReference(ref: TrailingReference, context: ResolverContext): Resolution {
    const declarations = context.declarations || {};
    const decl = (declarations.fields || []).find(d => d.name === ref.name)
        || (declarations.parameters || []).find(d => d.name === ref.name)
        || (declarations.variables || []).find(d => d.name === ref.name);

    const root = { sigil: ref.sigil, name: ref.name, reference: ref.reference };

    if (!decl) return outcome('unknown-ref', { ...root });

    const declaredType = decl.fullType || decl.type || null;
    if (decl.typeSource === 'inferred' || !declaredType) {
        return outcome('no-class', { ...root, declaredType: null });
    }

    const members = context.lookup(declaredType);
    if (!members || !members.resolved) {
        return outcome('unknown-type', {
            ...root,
            declaredType,
            typeKey: members ? members.typeKey : declaredType,
        });
    }
    if (members.ambiguous) {
        return outcome('ambiguous', {
            ...root,
            declaredType,
            typeKey: members.typeKey,
            ambiguity: members.ambiguity,
        });
    }

    return {
        resolved: true,
        reason: 'ok',
        typeKey: members.typeKey,
        declaredType,
        ...root,
    };
}

/** Type of the value a called method returns, or an unresolved reason. */
function resolveReturnType(
    receiver: Resolution,
    methodName: string,
    argCount: number,
    context: ResolverContext
): Resolution {
    const members = context.lookup(receiver.typeKey);
    if (!members || !members.resolved) {
        return outcome('unknown-type', {
            ...receiver,
            declaredType: receiver.declaredType || receiver.typeKey,
        });
    }

    const candidates = members.methods.filter(
        (m: MethodSignature) => m.name === methodName && arityMatches(m, argCount)
    );
    if (candidates.length === 0) {
        return outcome('unknown-method', { ...receiver, methodName });
    }

    const returns = candidates.find(m => m.returns)?.returns;
    if (!returns) return outcome('no-return-type', { ...receiver, methodName });

    const next = context.lookup(returns);
    if (!next || !next.resolved) {
        // A generic type variable (`E`, `T`) is not a failure — it is simply not
        // knowable from the declaration, so the caller falls back quietly.
        return outcome(isTypeVariable(returns) ? 'type-variable' : 'unknown-return-type', {
            ...receiver,
            methodName,
            typeKey: returns,
        });
    }

    return {
        resolved: true,
        reason: 'ok',
        typeKey: next.typeKey,
        declaredType: returns,
        sigil: receiver.sigil,
        name: receiver.name,
        reference: receiver.reference,
        chain: [...(receiver.chain || []), methodName],
    };
}

export function isTypeVariable(type: string | null | undefined): boolean {
    return /^[A-Z](\[\])*$/.test(String(type || '').trim());
}

/** Type of a trailing literal (string, char, number, boolean) or null. */
export function literalType(text: string): string | null {
    if (/"(?:[^"\\]|\\.)*"$/.test(text)) return 'java.lang.String';
    if (/'((?:[^'\\]|\\.)*)'$/.test(text)) return 'java.lang.Character';
    if (/\btrue$|\bfalse$/.test(text)) return 'java.lang.Boolean';
    for (const { re, type } of NUMBER_LITERALS) {
        if (re.test(text)) return type;
    }
    return null;
}

/**
 * Walk the expression to the left of a dot and report the type it evaluates to.
 */
export function resolveReceiver(
    textBeforeDot: string | null | undefined,
    context: ResolverContext
): Resolution {
    const text = String(textBeforeDot ?? '').replace(/\s+$/, '');
    if (!text) return outcome('not-a-receiver');
    return resolveExpression(text, context, 0);
}

export function resolveExpression(
    rawText: string,
    context: ResolverContext,
    depth: number
): Resolution {
    if (depth > MAX_DEPTH) return outcome('too-deep');

    const text = rawText.replace(/\s+$/, '');
    if (!text) return outcome('not-a-receiver');

    const ref = matchTrailingReference(text);
    if (ref) return resolveReference(ref, context);

    const literal = literalType(text);
    if (literal) {
        return { resolved: true, reason: 'ok', typeKey: literal, declaredType: literal };
    }

    if (text.endsWith(')')) {
        const open = matchingOpenParen(text);
        if (open === -1) return outcome('not-a-receiver');

        const beforeArgs = text.slice(0, open).replace(/\s+$/, '');
        const argCount = countArguments(text.slice(open + 1, text.length - 1));

        const constructorMatch = /(?:^|[^\w$.])new\s+([\w.$]+)$/.exec(beforeArgs);
        if (constructorMatch) {
            return {
                resolved: true,
                reason: 'ok',
                typeKey: constructorMatch[1],
                declaredType: constructorMatch[1],
            };
        }

        const nameMatch = /([A-Za-z_$][\w$]*)$/.exec(beforeArgs);
        if (!nameMatch) return outcome('not-a-receiver');

        // Drop the `.` that joined the method to its receiver: `a.trim` peels
        // back to the receiver `a`, which is then resolved on its own.
        const receiverText = beforeArgs.slice(0, nameMatch.index).replace(/\.\s*$/, '');
        const receiver = resolveExpression(receiverText, context, depth + 1);
        if (!receiver.resolved) return receiver;

        return resolveReturnType(receiver, nameMatch[1], argCount, context);
    }

    // A bare identifier is a local variable or a class name: neither is a
    // receiver we can type in a JRXML expression, so the caller keeps its
    // existing completion behaviour.
    if (IDENTIFIER_RE.test(text)) return outcome('not-a-receiver');

    return outcome('not-a-receiver');
}
