// reportIndex.ts
// The vscode-free report index: one place that answers "what is declared in
// this scope, what is referenced here, and what uses it?".
//
// Navigation (reportSymbols) reads the symbol view; the clear step reads
// usageNames/clearDeclarations instead of walking the tree itself.

import { resolveDeclarationScope } from './jrxmlParser';
import type { Declaration, DeclarationScope, ParseResult, Reference } from './jrxmlParser';
import { findDeclarationAtOffset, findReferenceToken } from './expressionUtils';
import type { ExpressionSigil } from './expressionUtils';
import { cdataOf, decodeXml } from './xmlRules';
import type { ContentSpan } from './xmlRules';
import { hasRole } from './expressionTags';
import { forEachReferenceToken } from './referenceTokens';
import type { ReferenceToken } from './referenceTokens';
import { scanXml } from './xmlspan';
import type { XmlNode, XmlScanResult } from './xmlspan';
import {
    BUILTIN_PARAMETERS,
    BUILTIN_VARIABLES,
    BUILTIN_PARAMETER_NAMES,
    BUILTIN_VARIABLE_NAMES,
} from './jasperBuiltins';
import type { Builtin } from './jasperBuiltins';

export type ReportSymbolKind = 'field' | 'parameter' | 'variable';

const KIND_BY_SIGIL: Readonly<Record<ExpressionSigil, ReportSymbolKind>> = {
    F: 'field', P: 'parameter', V: 'variable',
};
const LIST_BY_SIGIL: Readonly<Record<ExpressionSigil, 'fields' | 'parameters' | 'variables'>> = {
    F: 'fields', P: 'parameters', V: 'variables',
};
const CLEAR_KIND_BY_SIGIL: Readonly<Record<ExpressionSigil, ClearDeclarationKind>> = {
    F: 'FIELD', P: 'PARAMETER', V: 'VARIABLE',
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

/** A parsed reference plus the way it is written. */
export interface IndexReference extends Reference {
    readonly role: 'token' | 'attribute' | 'usage';
}

/** The symbol/usage view over one parse result. */
export interface ReportIndex {
    readonly parsed: ParseResult;
    readonly references: readonly IndexReference[];
    readonly resourceReferences: ParseResult['resourceReferences'];
    referenceAt(offset: number): IndexReference | null;
    symbolAt(at: ResolveAt): ReportSymbol | null;
    occurrences(symbol: ReportSymbol | null): IndexReference[];
    visibleDeclarations(offset?: number): DeclarationScope;
    declaredNames(scope: DeclarationScope | null, sigil: ExpressionSigil): Set<string>;
    declarationInAnyScope(token: Pick<ReferenceToken, 'sigil' | 'name'> | null): Declaration | null;
}

function builtinFor(sigil: ExpressionSigil, name: string): Builtin | null {
    if (sigil === 'P') return BUILTIN_PARAMETERS.find(parameter => parameter.name === name) || null;
    if (sigil === 'V') return BUILTIN_VARIABLES.find(variable => variable.name === name) || null;
    return null;
}

function scopeKey(scope: DeclarationScope | null): string | null {
    if (!scope || scope.kind === 'unknown') return null;
    return `${scope.kind}:${scope.datasetName || ''}`;
}

function buildIndex(parsed: ParseResult): ReportIndex {
    const references: IndexReference[] = (parsed.references || []).map(reference => ({
        ...reference,
        role: reference.role || 'token',
    }));

    const index: ReportIndex = {
        parsed,
        references,
        resourceReferences: parsed.resourceReferences || [],

        referenceAt(offset: number): IndexReference | null {
            for (const reference of references) {
                if (reference.role === 'usage') continue;
                const end = typeof reference.end === 'number'
                    ? reference.end
                    : reference.offset + reference.name.length;
                if (reference.offset <= offset && offset <= end) return reference;
            }
            return null;
        },

        symbolAt(at: ResolveAt): ReportSymbol | null {
            let token: ReferenceToken | null = null;
            let origin: 'reference' | 'declaration' = 'reference';
            let declaration: Declaration | Builtin | null = null;

            if (typeof at.lineText === 'string'
                && typeof at.character === 'number'
                && Number.isInteger(at.character)) {
                token = findReferenceToken(at.lineText, at.character);
                if (token && token.sigil === 'R') return null;
            }

            if (!token) {
                const reference = index.referenceAt(at.offset);
                if (reference) {
                    token = {
                        sigil: reference.sigil,
                        name:  reference.name,
                        bang:  !!reference.bang,
                        start: reference.offset,
                        end:   typeof reference.end === 'number'
                            ? reference.end
                            : reference.offset + reference.name.length,
                    };
                }
            }

            if (!token) {
                const found = findDeclarationAtOffset(parsed, at.offset);
                if (!found) return null;
                token = {
                    sigil: found.sigil,
                    name:  found.name,
                    bang:  false,
                    start: found.declaration.nameOffset,
                    end:   found.declaration.nameOffset + found.name.length,
                };
                origin = 'declaration';
                declaration = found.declaration;
            }

            // `$R{}` keys are resource-bundle keys, not report declarations.
            if (token.sigil === 'R') return null;
            const sigil = token.sigil;

            const scope = resolveDeclarationScope(parsed, at.offset);
            const visible = declaration || (scope[LIST_BY_SIGIL[sigil]] || [])
                .find(candidate => candidate.name === token.name) || null;
            const builtin = visible ? null : builtinFor(sigil, token.name);
            declaration = visible || builtin;
            const reportDeclaration = (!visible && origin === 'reference' && scope.kind === 'dataset')
                ? (parsed[LIST_BY_SIGIL[sigil]] || [])
                    .find(candidate => candidate.name === token.name) || null
                : null;

            return {
                token,
                origin,
                kind: KIND_BY_SIGIL[sigil],
                declaration,
                reportDeclaration,
                scope,
                builtin: !!builtin,
                outOfScope: !!reportDeclaration,
            };
        },

        occurrences(symbol: ReportSymbol | null): IndexReference[] {
            if (!symbol || !symbol.token) return [];
            const token = symbol.token;
            if (token.sigil === 'R') return [];
            const key = scopeKey(symbol.scope);

            return references.filter(reference => {
                if (reference.role === 'usage') return false;
                if (reference.sigil !== token.sigil) return false;
                if (reference.name !== token.name) return false;
                if (typeof reference.end !== 'number') return false;
                if (key === null) return true;
                return scopeKey(resolveDeclarationScope(parsed, reference.offset)) === key;
            });
        },

        visibleDeclarations(offset = -1): DeclarationScope {
            return resolveDeclarationScope(parsed, offset);
        },

        declaredNames(scope: DeclarationScope | null, sigil: ExpressionSigil): Set<string> {
            const list = (scope && scope[LIST_BY_SIGIL[sigil]]) || [];
            const names = new Set(list.map(declaration => declaration.name));
            if (sigil === 'P') for (const name of BUILTIN_PARAMETER_NAMES) names.add(name);
            if (sigil === 'V') for (const name of BUILTIN_VARIABLE_NAMES) names.add(name);
            return names;
        },

        declarationInAnyScope(token: Pick<ReferenceToken, 'sigil' | 'name'> | null): Declaration | null {
            if (!token || token.sigil === 'R') return null;
            return (parsed[LIST_BY_SIGIL[token.sigil]] || [])
                .find(candidate => candidate.name === token.name) || null;
        },
    };

    return index;
}

const indexCache = new WeakMap<ParseResult, ReportIndex>();

/** The index for one parse result, built once per parsed object. */
export function reportIndex(parsed: ParseResult | null | undefined): ReportIndex | null {
    if (!parsed) return null;
    const cached = indexCache.get(parsed);
    if (cached) return cached;
    const built = buildIndex(parsed);
    indexCache.set(parsed, built);
    return built;
}

// ── Usage ─────────────────────────────────────────────────────────────────────

const usageCache = new WeakMap<XmlScanResult, Set<string> | null>();

function addName(
    kind: ClearDeclarationKind,
    rawName: string | null | undefined,
    used: Set<string>
): void {
    const name = decodeXml(rawName || '').trim();
    if (name) used.add(kind + ':' + name);
}

/**
 * Names used anywhere an expression can appear, keyed as `KIND:name`.
 * Returns null when the document cannot be scanned, so callers can tell
 * "nothing is used" apart from "usage could not be determined".
 */
export function usageNames(scan: XmlScanResult | null): Set<string> | null {
    if (!scan) return null;
    if (usageCache.has(scan)) return usageCache.get(scan) ?? null;
    if (scan.error || !scan.doc) {
        usageCache.set(scan, null);
        return null;
    }

    const used = new Set<string>();
    const root = scan.doc.root;

    for (const node of scan.doc.walk()) {
        if (hasRole(node.tag, 'reference')) {
            forEachReferenceToken(node.textContent(), token => {
                if (token.sigil === 'R') return;
                addName(CLEAR_KIND_BY_SIGIL[token.sigil], token.name, used);
            });
        } else if (node.tag === 'subreportParameter') {
            addName('PARAMETER', node.attrValue('name'), used);
        } else if (node.tag === 'returnValue') {
            addName('VARIABLE', node.attrValue('toVariable'), used);
        } else if (node.tag === 'sortField') {
            const type = (node.attrValue('type') || 'field').toLowerCase();
            if (type === 'variable') addName('VARIABLE', node.attrValue('name'), used);
            else if (type !== 'none') addName('FIELD', node.attrValue('name'), used);
        } else if (node.tag === 'parameter' && node.parent !== root) {
            // A parameter nested in a subreport or dataset is passed in, not
            // declared here.
            addName('PARAMETER', node.attrValue('name'), used);
        }
    }

    usageCache.set(scan, used);
    return used;
}

// ── Clear-step declarations ──────────────────────────────────────────────────

export const JSONQL_FIELD_PROPERTY = 'net.sf.jasperreports.jsonql.field.expression';
export const JSON_FIELD_PROPERTY   = 'net.sf.jasperreports.json.field.expression';

export type ClearDeclarationKind = 'FIELD' | 'PARAMETER' | 'VARIABLE';

/** One report-root declaration, in the clear step's own model. */
export interface ClearDeclaration {
    kind: ClearDeclarationKind;
    name: string;
    start: number;
    end: number;
    endTag: number;
    hasDescription: boolean;
    descriptionText: string;
    descriptionStart: number;
    descriptionEnd: number;
    descriptionIndent: string;
    descriptionCdata: boolean;
    hasJsonql: boolean;
    jsonqlValue: string;
    hasLegacy: boolean;
    legacyStart: number;
    legacyEnd: number;
    legacyNameStart: number;
    legacyNameEnd: number;
}

function lineStartOf(text: string, offset: number): number {
    let i = offset;
    while (i > 0 && text[i - 1] !== '\n') i--;
    return Math.max(0, i);
}

function descriptionTextSpan(description: XmlNode, text: string): ContentSpan {
    const cdata = cdataOf(description, text);
    if (cdata) return cdata;

    const start = description.startTagEnd;
    const end   = description.endTag >= 0 ? description.endTag : description.end;
    return { start, end, content: decodeXml(text.slice(start, end).trim()) };
}

const clearCache = new WeakMap<XmlScanResult, ClearDeclaration[]>();

/** Report-root declarations the clear step may delete or annotate. */
export function clearDeclarations(text: string, providedScan: XmlScanResult | null = null): ClearDeclaration[] {
    const scan = providedScan || scanXml(text);
    if (scan.error || !scan.doc) return [];
    const cached = clearCache.get(scan);
    if (cached) return cached;

    const declarations: ClearDeclaration[] = [];
    for (const child of scan.doc.root.children) {
        if (child.tag !== 'parameter' && child.tag !== 'field' && child.tag !== 'variable') continue;

        const kind: ClearDeclarationKind =
            child.tag === 'field' ? 'FIELD'
            : child.tag === 'parameter' ? 'PARAMETER'
            : 'VARIABLE';

        const decl: ClearDeclaration = {
            kind,
            name:              decodeXml(child.attrValue('name') || ''),
            start:             child.startTag,
            end:               child.end,
            endTag:            child.endTag,
            hasDescription:    false,
            descriptionText:   '',
            descriptionStart:  -1,
            descriptionEnd:    -1,
            descriptionIndent: '',
            descriptionCdata:  false,
            hasJsonql:         false,
            jsonqlValue:       '',
            hasLegacy:         false,
            legacyStart:       -1,
            legacyEnd:         -1,
            legacyNameStart:   -1,
            legacyNameEnd:     -1,
        };

        if (decl.kind === 'FIELD') {
            for (const node of child.children) {
                if (node.tag === 'description') {
                    decl.hasDescription = true;
                    decl.descriptionCdata = cdataOf(node, text) !== null;

                    const span = descriptionTextSpan(node, text);
                    decl.descriptionText   = span.content.trim();
                    decl.descriptionStart  = span.start;
                    decl.descriptionEnd    = span.end;
                    decl.descriptionIndent = text.slice(lineStartOf(text, node.startTag), node.startTag);
                } else if (node.tag === 'property') {
                    const propertyName = decodeXml(node.attrValue('name') || '');
                    if (propertyName === JSONQL_FIELD_PROPERTY) {
                        decl.hasJsonql  = true;
                        decl.jsonqlValue = decodeXml(node.attrValue('value') || '').trim();
                    } else if (propertyName === JSON_FIELD_PROPERTY) {
                        decl.hasLegacy    = true;
                        decl.legacyStart  = node.startTag;
                        decl.legacyEnd    = node.end;
                        const nameAttr    = node.attr('name');
                        if (nameAttr) {
                            decl.legacyNameStart = nameAttr.valueStart;
                            decl.legacyNameEnd   = nameAttr.valueEnd;
                        }
                    }
                } else if (node.tag === 'propertyExpression') {
                    if (decodeXml(node.attrValue('name') || '') === JSONQL_FIELD_PROPERTY) {
                        decl.hasJsonql = true; // value is not used for syncing
                    }
                }
            }
        }

        declarations.push(decl);
    }

    clearCache.set(scan, declarations);
    return declarations;
}
