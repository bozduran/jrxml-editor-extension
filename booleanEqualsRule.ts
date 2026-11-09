// booleanEqualsRule.ts
// Pure style rule: prefer EQUALS($ref, true/false) / NOT(EQUALS(...)) over
// == / != on Boolean values and over Boolean.TRUE/FALSE.equals(...).
//
// This used to be the only rule in the Best Practices view. It now runs as a
// normal JRXML diagnostic (and quick fix) so the extension keeps one findings
// surface. Kept vscode-free for unit testing.

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
    for (const variable of variables)   if (predicate(variable.fullType || variable.type)) sets.V.add(variable.name);
    return sets;
}

/**
 * Find Boolean comparisons that should use the JasperReports EQUALS() helper.
 * `expression` is the raw expression text (CDATA markers removed) and
 * `declarations` the parsed report declarations.
 */
export function checkBooleanEquals(
    expression: string,
    declarations: Declarations
): BooleanEqualsHit[] {
    const expr = String(expression == null ? '' : expression);
    const boolNames = buildTypeSet(declarations || {}, isBoolean);
    const hits: BooleanEqualsHit[] = [];

    // Boolean.FALSE.equals($F{x}) and $F{x}.equals(Boolean.FALSE)
    const boolEqualsRe = /(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\.equals\s*\(\s*(\$(F|P|V)\{([\w.]+)\})\s*\)|(\$(F|P|V)\{([\w.]+)\})\.equals\s*\(\s*(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = boolEqualsRe.exec(expr)) !== null) {
        const full      = match[0];
        const boolConst = match[1] || match[8];
        const ref       = match[2] || match[5];
        const sigil     = (match[3] || match[6]) as ReferenceSigil;
        const name      = match[4] || match[7];
        if (!boolNames[sigil].has(name)) continue;

        const boolValue   = boolConst === 'TRUE' ? 'true' : 'false';
        const replacement = `EQUALS(${ref}, ${boolValue})`;
        hits.push({
            start:       match.index,
            end:         match.index + full.length,
            label:       `Replace with ${replacement}`,
            replacement,
        });
    }

    // $F{x} == true|false  /  $F{x} != true|false
    const compareRe = /(\$(F|P|V)\{([\w.]+)\})\s*(==|!=)\s*(true|false)/g;
    while ((match = compareRe.exec(expr)) !== null) {
        const [full, ref, sigilText, name, operator, boolValue] = match;
        const sigil = sigilText as ReferenceSigil;
        if (!boolNames[sigil].has(name)) continue;

        const inner       = `EQUALS(${ref}, ${boolValue})`;
        const replacement = operator === '!=' ? `NOT(${inner})` : inner;
        hits.push({
            start:       match.index,
            end:         match.index + full.length,
            label:       `Replace with ${replacement}`,
            replacement,
        });
    }

    // A bare Boolean reference used as a condition.
    const bareRe = /(\$(F|P|V)\{([\w.]+)\})(?!\s*[=!<>])/g;
    while ((match = bareRe.exec(expr)) !== null) {
        const [full, ref, sigilText, name] = match;
        const sigil = sigilText as ReferenceSigil;
        if (!boolNames[sigil].has(name)) continue;

        const before = expr.slice(0, match.index);
        const after  = expr.slice(match.index + full.length).trimStart();
        if (/EQUALS\s*\(\s*$/.test(before)) continue;
        if (/(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\.equals\s*\(\s*$/.test(before)) continue;
        if (/^\.equals\s*\(\s*(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\s*\)/.test(after)) continue;
        if (/^(==|!=)\s*(true|false)/.test(after)) continue;
        if (/^\./.test(after)) continue; // member access, e.g. .booleanValue()

        const replacement = `EQUALS(${ref}, true)`;
        hits.push({
            start:       match.index,
            end:         match.index + full.length,
            label:       `Replace with ${replacement}`,
            replacement,
        });
    }

    return hits;
}
