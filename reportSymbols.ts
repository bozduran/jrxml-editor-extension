// reportSymbols.ts
// The cursor-level facade over reportIndex: one token, one scope, one
// declaration. Providers format this record; they do not re-implement lookup.

import { reportIndex } from './reportIndex';
import type { ReportSymbol, ResolveAt } from './reportIndex';
import { resolveDeclarationScope } from './jrxmlParser';
import type { Declaration, DeclarationScope, ParseResult } from './jrxmlParser';
import type { ExpressionSigil } from './expressionUtils';
import type { ReferenceToken } from './referenceTokens';
import {
    BUILTIN_PARAMETER_NAMES,
    BUILTIN_VARIABLE_NAMES,
} from './jasperBuiltins';

export type { ReportSymbol, ResolveAt } from './reportIndex';

export type ReportSymbolKind = 'field' | 'parameter' | 'variable';

const LIST_BY_SIGIL: Readonly<Record<ExpressionSigil, 'fields' | 'parameters' | 'variables'>> = {
    F: 'fields', P: 'parameters', V: 'variables',
};

/** Resolve the report symbol at an offset (token, attribute or declaration). */
export function resolveSymbol(
    parsed: ParseResult | null,
    at: ResolveAt
): ReportSymbol | null {
    return reportIndex(parsed)?.symbolAt(at) ?? null;
}

/** The declarations visible at an offset; -1 means report scope. */
export function visibleDeclarations(parsed: ParseResult, offset = -1): DeclarationScope {
    return reportIndex(parsed)?.visibleDeclarations(offset)
        ?? resolveDeclarationScope(parsed, offset);
}

/** Declaration names visible in a scope, including JasperReports built-ins. */
export function declaredNames(scope: DeclarationScope | null, sigil: ExpressionSigil): Set<string> {
    const list = (scope && scope[LIST_BY_SIGIL[sigil]]) || [];
    const names = new Set(list.map(declaration => declaration.name));
    if (sigil === 'P') for (const name of BUILTIN_PARAMETER_NAMES) names.add(name);
    if (sigil === 'V') for (const name of BUILTIN_VARIABLE_NAMES) names.add(name);
    return names;
}

/** Merged lookup for a scope that cannot be identified. */
export function declarationInAnyScope(
    parsed: ParseResult | null,
    token: Pick<ReferenceToken, 'sigil' | 'name'> | null
): Declaration | null {
    return reportIndex(parsed)?.declarationInAnyScope(token) ?? null;
}

/** Every navigable reference of the same symbol in the same scope. */
export function occurrences(parsed: ParseResult | null, symbol: ReportSymbol | null) {
    return reportIndex(parsed)?.occurrences(symbol) ?? [];
}
