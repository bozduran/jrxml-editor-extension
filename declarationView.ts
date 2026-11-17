// declarationView.ts
// The structural view of report declarations that the pure rules consume.
//
// `jrxmlParser.Declaration` is the full parser record: it carries offsets,
// descriptions and the resolved `typeSource`. The rules here only need a name
// and the declared type, and they are deliberately free of the parser (and of
// everything the parser pulls in), so they take this narrow view instead.
// Parser declarations are assignable to it, so callers pass parser output
// straight through without mapping.
//
// `memberResolver` and `booleanEqualsRule` both used to declare their own copy
// of these two interfaces; they now share this one.

/** A field, parameter or variable, as the rules see it. */
export interface Declaration {
    readonly name: string;
    readonly type?: string;
    readonly fullType?: string;
    readonly typeSource?: string;
}

/** The declaration collections a rule may consult, in either parser spelling. */
export interface Declarations {
    readonly fields?: readonly Declaration[];
    readonly parameters?: readonly Declaration[];
    readonly variables?: readonly Declaration[];
    readonly allFields?: readonly Declaration[];
    readonly allParameters?: readonly Declaration[];
    readonly allVariables?: readonly Declaration[];
}
