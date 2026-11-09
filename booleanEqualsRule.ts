// booleanEqualsRule.ts
// Pure style rule: prefer EQUALS($ref, true/false) / NOT(EQUALS(...)) over
// == / != on Boolean values and over Boolean.TRUE/FALSE.equals(...).
//
// The token grammar comes from referenceTokens, and the declaration scope is
// passed by the caller (the diagnostics pipeline resolves it at the expression
// offset), so a dataset shadow is judged by the declarations visible there.

import { referenceTokens } from './referenceTokens';
import type { ReferenceToken } from './referenceTokens';

export const CODE = 'jrxml.booleanEquals';
export const MESSAGE = 'Prefer EQUALS($ref, true/false) or NOT(EQUALS(...)) instead of == / != or a bare Boolean reference.';

export type ReferenceSigil = 'F' | 'P' | 'V';

export interface TypeDeclaration {
    readonly name: string;
    readonly type?: string;
    readonly fullType?: string;
}

export interface Declarations {
    readonly allFields?: readonly TypeDeclaration[];
    readonly fields?: readonly TypeDeclaration[];
    readonly allParameters?: readonly TypeDeclaration[];
    readonly parameters?: readonly TypeDeclaration[];
    readonly allVariables?: readonly TypeDeclaration[];
    readonly variables?: readonly TypeDeclaration[];
}

export interface BooleanEqualsHit {
    start: number;
    end: number;
    label: string;
    replacement: string;
}

type TypeSets = Record<ReferenceSigil, Set<string>>;

const BOOL_EQUALS_BEFORE = /(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\.equals\s*\(\s*$/;
const BOOL_EQUALS_AFTER = /^\s*\.equals\s*\(\s*(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\s*\)/;
const COMPARE_AFTER = /^\s*(==|!=)\s*(true|false)\b/;
const EXISTING_EQUALS_BEFORE = /EQUALS\s*\(\s*$/;
const MEMBER_ACCESS_AFTER = /^\./;

function isBoolean(type: string | null | undefined): boolean {
    if (!type) return false;
    const value = String(type).toLowerCase();
    return value === 'boolean' || value === 'java.lang.boolean';
}

function buildTypeSet(
    declarations: Declarations,
    predicate: (type: string | null | undefined) => boolean
): TypeSets {
    const sets: TypeSets = { F: new Set(), P: new Set(), V: new Set() };
    const fields     = declarations.allFields     || declarations.fields     || [];
    const parameters = declarations.allParameters || declarations.parameters || [];
    const variables  = declarations.allVariables  || declarations.variables  || [];

    for (const field of fields)         if (predicate(field.fullType || field.type)) sets.F.add(field.name);
    for (const parameter of parameters) if (predicate(parameter.fullType || parameter.type)) sets.P.add(parameter.name);
    for (const variable of variables)   if (predicate(parameterType(variable))) sets.V.add(variable.name);
    return sets;
}

function parameterType(declaration: TypeDeclaration): string | null | undefined {
    return declaration.fullType || declaration.type;
}

function hit(start: number, end: number, replacement: string): BooleanEqualsHit {
    return { start, end, label: `Replace with ${replacement}`, replacement };
}

/**
 * Find Boolean comparisons that should use the JasperReports EQUALS() helper.
 *
 * `declarations` is the fallback view (merged declarations); `scope`, when the
 * caller can resolve one, overrides it so a dataset declaration shadows a
 * report declaration with the same name.
 */
export function checkBooleanEquals(
    expression: string,
    declarations: Declarations,
    scope: Declarations | null = null
): BooleanEqualsHit[] {
    const expr = String(expression == null ? '' : expression);
    const boolNames = buildTypeSet(scope || declarations || {}, isBoolean);
    const tokens = referenceTokens(expr).filter(token =>
        token.sigil !== 'R' && !token.bang && token.name && boolNames[token.sigil].has(token.name));
    const hits: BooleanEqualsHit[] = [];
    const claimed = new Set<number>();

    const referenceText = (token: ReferenceToken): string => expr.slice(token.start, token.end);

    // Boolean.TRUE/FALSE.equals($F{x}) in both directions.
    for (const token of tokens) {
        const before = expr.slice(0, token.start);
        const after = expr.slice(token.end);
        const ref = referenceText(token);

        const beforeMatch = BOOL_EQUALS_BEFORE.exec(before);
        const afterMatch = BOOL_EQUALS_AFTER.exec(after);
        // The prefix form must close immediately after the token.
        const closeMatch = beforeMatch ? /^\s*\)/.exec(after) : null;
        if (beforeMatch && !closeMatch) continue;
        if (!beforeMatch && !afterMatch) continue;

        const boolValue = (beforeMatch ? beforeMatch[1] : afterMatch?.[1]) === 'TRUE' ? 'true' : 'false';
        const replacement = `EQUALS(${ref}, ${boolValue})`;
        const start = beforeMatch ? before.length - beforeMatch[0].length : token.start;
        const suffix = afterMatch ? afterMatch[0].length : (closeMatch ? closeMatch[0].length : 0);
        const end = token.end + suffix;
        hits.push(hit(start, end, replacement));
        claimed.add(token.start);
    }

    // $F{x} == true|false and $F{x} != true|false.
    for (const token of tokens) {
        if (claimed.has(token.start)) continue;
        const afterMatch = COMPARE_AFTER.exec(expr.slice(token.end));
        if (!afterMatch) continue;

        const ref = referenceText(token);
        const inner = `EQUALS(${ref}, ${afterMatch[2]})`;
        const replacement = afterMatch[1] === '!=' ? `NOT(${inner})` : inner;
        hits.push(hit(token.start, token.end + afterMatch[0].length, replacement));
        claimed.add(token.start);
    }

    // A bare Boolean reference used as a condition.
    for (const token of tokens) {
        if (claimed.has(token.start)) continue;
        const before = expr.slice(0, token.start);
        const after = expr.slice(token.end).trimStart();
        if (EXISTING_EQUALS_BEFORE.test(before)) continue;
        if (BOOL_EQUALS_BEFORE.test(before)) continue;
        if (MEMBER_ACCESS_AFTER.test(after)) continue;
        if (/^\s*[=!<>]/.test(after)) continue;

        const ref = referenceText(token);
        hits.push(hit(token.start, token.end, `EQUALS(${ref}, true)`));
        claimed.add(token.start);
    }

    return hits;
}
