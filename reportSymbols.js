// reportSymbols.js
// The vscode-free resolution seam for report symbols: one token, one scope,
// one declaration. Providers format this record; they do not re-implement the
// lookup.

const { resolveDeclarationScope } = require('./jrxmlParser');
const { findReferenceToken, findDeclarationAtOffset } = require('./expressionUtils');
const {
    BUILTIN_PARAMETERS,
    BUILTIN_VARIABLES,
    BUILTIN_PARAMETER_NAMES,
    BUILTIN_VARIABLE_NAMES,
} = require('./jasperBuiltins');

const KIND_BY_SIGIL = { F: 'field', P: 'parameter', V: 'variable' };
const LIST_BY_SIGIL = { F: 'fields', P: 'parameters', V: 'variables' };

function builtinFor(sigil, name) {
    if (sigil === 'P') return BUILTIN_PARAMETERS.find(parameter => parameter.name === name) || null;
    if (sigil === 'V') return BUILTIN_VARIABLES.find(variable => variable.name === name) || null;
    return null;
}

/**
 * Resolve the report symbol at an offset.
 *
 * @param {object} parsed parseDeclarations result
 * @param {{offset:number, lineText?:string, character?:number}} at
 * @returns {object|null}
 */
function resolveSymbol(parsed, { offset, lineText, character }) {
    if (!parsed) return null;

    let token = null;
    let origin = 'reference';
    let declaration = null;

    if (typeof lineText === 'string' && Number.isInteger(character)) {
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

    const scope = resolveDeclarationScope(parsed, offset);
    const visible = declaration || (scope[LIST_BY_SIGIL[token.sigil]] || [])
        .find(candidate => candidate.name === token.name) || null;
    const builtin = visible ? null : builtinFor(token.sigil, token.name);
    declaration = visible || builtin;
    const reportDeclaration = (!visible && origin === 'reference' && scope.kind === 'dataset')
        ? (parsed[LIST_BY_SIGIL[token.sigil]] || []).find(candidate => candidate.name === token.name) || null
        : null;

    return {
        token,
        origin,
        kind: KIND_BY_SIGIL[token.sigil],
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
function visibleDeclarations(parsed, offset = -1) {
    return resolveDeclarationScope(parsed, offset);
}

/** Declaration names visible in a scope, including JasperReports built-ins. */
function declaredNames(scope, sigil) {
    const list = (scope && scope[LIST_BY_SIGIL[sigil]]) || [];
    const names = new Set(list.map(declaration => declaration.name));
    if (sigil === 'P') for (const name of BUILTIN_PARAMETER_NAMES) names.add(name);
    if (sigil === 'V') for (const name of BUILTIN_VARIABLE_NAMES) names.add(name);
    return names;
}

/** Merged lookup for a scope that cannot be identified. */
function declarationInAnyScope(parsed, token) {
    if (!parsed || !token) return null;
    return (parsed[LIST_BY_SIGIL[token.sigil]] || []).find(candidate => candidate.name === token.name) || null;
}

function scopeKey(scope) {
    if (!scope || scope.kind === 'unknown') return null;
    return `${scope.kind}:${scope.datasetName || ''}`;
}

/**
 * Every reference token of the same symbol in the same declaration scope.
 * A scope that cannot be identified (`unknown`) falls back to every same-named
 * token, matching the current Find All References behaviour.
 */
function occurrences(parsed, symbol) {
    if (!parsed || !symbol || !symbol.token) return [];

    const key = scopeKey(symbol.scope);
    return (parsed.references || []).filter(reference => {
        if (reference.sigil !== symbol.token.sigil) return false;
        if (reference.name !== symbol.token.name) return false;
        if (typeof reference.end !== 'number') return false;
        if (key === null) return true;
        return scopeKey(resolveDeclarationScope(parsed, reference.offset)) === key;
    });
}

module.exports = {
    resolveSymbol,
    occurrences,
    visibleDeclarations,
    declaredNames,
    declarationInAnyScope,
};
