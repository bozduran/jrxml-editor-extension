// reportSymbols.ts
// The vscode-free resolution seam for report symbols: one token, one scope,
// one declaration. Providers format this record; they do not re-implement the
// lookup.

import { resolveDeclarationScope } from './jrxmlParser';
import type { Declaration, DeclarationScope, ParseResult, Reference } from './jrxmlParser';
import { findReferenceToken, findDeclarationAtOffset } from './expressionUtils';
import type { ExpressionSigil } from './expressionUtils';
import {
    BUILTIN_PARAMETERS,
    BUILTIN_VARIABLES,
    BUILTIN_PARAMETER_NAMES,
    BUILTIN_VARIABLE_NAMES,
} from './jasperBuiltins';
import type { Builtin } from './jasperBuiltins';
import type { ReferenceToken } from './referenceTokens';

export type ReportSymbolKind = 'field' | 'parameter' | 'variable';

const KIND_BY_SIGIL: Readonly<Record<ExpressionSigil, ReportSymbolKind>> = {
    F: 'field', P: 'parameter', V: 'variable',
};
const LIST_BY_SIGIL: Readonly<Record<ExpressionSigil, 'fields' | 'parameters' | 'variables'>> = {
    F: 'fields', P: 'parameters', V: 'variables',
};

/** Where the cursor was: a document offset plus an optional line/column. */
export interface ResolveAt {
    offset: number;
    lineText?: string;
    character?: number;
}

/** One resolved symbol: the token, its declaration and its scope. */
export interface ReportSymbol {
    token: ReferenceToken;
    origin: 'reference' | 'declaration';
    kind: ReportSymbolKind;
    declaration: Declaration | Builtin | null;
    reportDeclaration: Declaration | null;
    scope: DeclarationScope;
    builtin: boolean;
    outOfScope: boolean;
}

function builtinFor(sigil: ExpressionSigil, name: string): Builtin | null {
    if (sigil === 'P') return BUILTIN_PARAMETERS.find(parameter => parameter.name === name) || null;
    if (sigil === 'V') return BUILTIN_VARIABLES.find(variable => variable.name === name) || null;
    return null;
}

/**
 * Resolve the report symbol at an offset.
 *
 * @param parsed parseDeclarations result
 */
function resolveSymbol(parsed: ParseResult | null, { offset, lineText, character }: ResolveAt): ReportSymbol | null {
    if (!parsed) return null;

    let token: ReferenceToken | null = null;
    let origin: 'reference' | 'declaration' = 'reference';
    let declaration: Declaration | Builtin | null = null;

    if (typeof lineText === 'string' && typeof character === 'number' && Number.isInteger(character)) {
        token = findReferenceToken(lineText, character);
        if (token && token.sigil === 'R') return null;
    }

    if (!token) {
        const at = findDeclarationAtOffset(parsed, offset);
        if (!at) return null;
        token = {
            sigil: at.sigil,
            name: at.name,
            bang: false,
            start: at.declaration.nameOffset,
            end: at.declaration.nameOffset + at.name.length,
        };
        origin = 'declaration';
        declaration = at.declaration;
    }

    // `$R{}` keys are resource-bundle keys, not declarations.
    const resolvedToken: ReferenceToken = token;
    const sigil = resolvedToken.sigil;
    if (sigil === 'R') return null;

    const scope = resolveDeclarationScope(parsed, offset);
    const visible = declaration || (scope[LIST_BY_SIGIL[sigil]] || [])
        .find(candidate => candidate.name === resolvedToken.name) || null;
    const builtin = visible ? null : builtinFor(sigil, resolvedToken.name);
    declaration = visible || builtin;
    const reportDeclaration = (!visible && origin === 'reference' && scope.kind === 'dataset')
        ? (parsed[LIST_BY_SIGIL[sigil]] || []).find(candidate => candidate.name === resolvedToken.name) || null
        : null;

    return {
        token: resolvedToken,
        origin,
        kind: KIND_BY_SIGIL[sigil],
        declaration,
        reportDeclaration,
        scope,
        builtin: !!builtin,
        outOfScope: !!reportDeclaration,
    };
}

/**
 * The declarations visible at an offset. A negative offset means report scope,
 * so callers never pass the magic -1 themselves.
 */
function visibleDeclarations(parsed: ParseResult, offset = -1): DeclarationScope {
    return resolveDeclarationScope(parsed, offset);
}

/** Declaration names visible in a scope, including JasperReports built-ins. */
function declaredNames(scope: DeclarationScope | null, sigil: ExpressionSigil): Set<string> {
    const list = (scope && scope[LIST_BY_SIGIL[sigil]]) || [];
    const names = new Set(list.map(declaration => declaration.name));
    if (sigil === 'P') for (const name of BUILTIN_PARAMETER_NAMES) names.add(name);
    if (sigil === 'V') for (const name of BUILTIN_VARIABLE_NAMES) names.add(name);
    return names;
}

/** Merged lookup for a scope that cannot be identified. */
function declarationInAnyScope(
    parsed: ParseResult | null,
    token: Pick<ReferenceToken, 'sigil' | 'name'> | null
): Declaration | null {
    if (!parsed || !token) return null;
    if (token.sigil === 'R') return null;
    return (parsed[LIST_BY_SIGIL[token.sigil]] || [])
        .find(candidate => candidate.name === token.name) || null;
}

function scopeKey(scope: DeclarationScope | null): string | null {
    if (!scope || scope.kind === 'unknown') return null;
    return `${scope.kind}:${scope.datasetName || ''}`;
}

/**
 * Every reference token of the same symbol in the same declaration scope.
 * A scope that cannot be identified (`unknown`) falls back to every same-named
 * token, matching the current Find All References behaviour.
 */
function occurrences(parsed: ParseResult | null, symbol: ReportSymbol | null): Reference[] {
    if (!parsed || !symbol || !symbol.token) return [];

    const key = scopeKey(symbol.scope);
    const token = symbol.token;
    return (parsed.references || []).filter(reference => {
        if (reference.sigil !== token.sigil) return false;
        if (reference.name !== token.name) return false;
        if (typeof reference.end !== 'number') return false;
        if (key === null) return true;
        return scopeKey(resolveDeclarationScope(parsed, reference.offset)) === key;
    });
}

export {
    resolveSymbol,
    occurrences,
    visibleDeclarations,
    declaredNames,
    declarationInAnyScope,
};
