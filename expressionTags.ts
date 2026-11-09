// expressionTags.ts
// The single source of truth for JRXML elements whose content is an expression.
//
// One descriptor per element carries the roles it plays. Consumers ask for a
// role projection (`forRole`, `hasRole`) instead of owning a tag list; the
// TextMate grammar carries the same tags and test/expressionUtils.test.js
// asserts the two never drift apart.

export type ExpressionRole =
    | 'expression'
    | 'reference'
    | 'format'
    | 'textcheck'
    | 'designContent';

export interface ExpressionElementDescriptor {
    readonly tag: string;
    readonly roles: readonly ExpressionRole[];
}

const EXPRESSION_ELEMENT_TAGS = [
    'textFieldExpression', 'imageExpression', 'variableExpression',
    'groupExpression', 'printWhenExpression', 'initialValueExpression',
    'filterExpression', 'expression', 'jr:expression',
    'defaultValueExpression', 'anchorNameExpression',
    'bookmarkLevelExpression', 'hyperlinkReferenceExpression',
    'hyperlinkAnchorExpression', 'hyperlinkPageExpression',
    'hyperlinkTooltipExpression', 'labelExpression', 'connectionExpression',
    'subreportExpression', 'bucketExpression', 'sortFieldExpression',
    'keyExpression', 'valueExpression', 'seriesExpression',
    'categoryExpression', 'lowExpression', 'highExpression',
    'openExpression', 'closeExpression', 'volumeExpression',
    'xValueExpression', 'yValueExpression', 'zValueExpression',
    'timePeriodExpression', 'startDateExpression', 'endDateExpression',
    'colorExpression', 'sizeExpression', 'shapeExpression',
    'datasetExpression', 'customExpression', 'crosstabExpression',
    'chartTitleExpression', 'chartSubtitleExpression',
] as const;

// Elements whose body can contain $F/$P/$V references for the purpose of
// "is this declaration used?". Wider than the expression-tag set: queries,
// property expressions and the classic subreport/dataset parameter expressions
// carry real references too.
const REFERENCE_ONLY_TAGS = [
    'query', 'propertyExpression',
    'subreportParameterExpression', 'datasetParameterExpression',
] as const;

// The five element kinds the design inspector may edit content for. The
// design model lowercases element names, so these are stored lowercased.
const DESIGN_CONTENT_TAGS = [
    'expression', 'textfieldexpression', 'imageexpression',
    'subreportexpression', 'chartexpression',
] as const;

// Classic design-content spelling that is not one of the expression tags.
const DESIGN_ONLY_TAGS = ['chartExpression'] as const;

const DESIGN_CONTENT = new Set<string>(DESIGN_CONTENT_TAGS);

/** Lowercased local name: the design model and some consumers use this form. */
export function normalizeTag(tag: string): string {
    const text = String(tag ?? '');
    const colon = text.indexOf(':');
    return (colon === -1 ? text : text.slice(colon + 1)).toLowerCase();
}

const EXPRESSION_ELEMENTS: ExpressionElementDescriptor[] = [
    ...EXPRESSION_ELEMENT_TAGS.map(tag => ({
        tag,
        roles: [
            'expression',
            'reference',
            'format',
            'textcheck',
            ...(DESIGN_CONTENT.has(normalizeTag(tag)) ? ['designContent' as const] : []),
        ] as ExpressionRole[],
    })),
    ...REFERENCE_ONLY_TAGS.map(tag => ({
        tag,
        roles: ['reference'] as ExpressionRole[],
    })),
    ...DESIGN_ONLY_TAGS.map(tag => ({
        tag,
        roles: ['designContent'] as ExpressionRole[],
    })),
];

const ROLE_TAGS = buildRoleTags();

function buildRoleTags(): Record<ExpressionRole, ReadonlySet<string>> {
    const roles: Record<ExpressionRole, Set<string>> = {
        expression: new Set(),
        reference:  new Set(),
        format:     new Set(),
        textcheck:  new Set(),
        designContent: new Set(),
    };
    for (const descriptor of EXPRESSION_ELEMENTS) {
        for (const role of descriptor.roles) roles[role].add(normalizeTag(descriptor.tag));
    }
    // The design content list is authoritative for its role, including the
    // classic spellings that are not separate expression tags.
    for (const tag of DESIGN_CONTENT) roles.designContent.add(tag);
    return roles;
}

const ROLES_BY_TAG = buildRolesByTag();

function buildRolesByTag(): ReadonlyMap<string, ReadonlySet<ExpressionRole>> {
    const byTag = new Map<string, Set<ExpressionRole>>();
    for (const descriptor of EXPRESSION_ELEMENTS) {
        const key = normalizeTag(descriptor.tag);
        const roles = byTag.get(key) ?? new Set<ExpressionRole>();
        for (const role of descriptor.roles) roles.add(role);
        byTag.set(key, roles);
    }
    return byTag;
}

/** Tags that carry the named role, lowercased for case-insensitive matching. */
export function forRole(role: ExpressionRole): ReadonlySet<string> {
    return ROLE_TAGS[role];
}

/** True when `tag` plays `role`; matching ignores case and a namespace prefix. */
export function hasRole(tag: string, role: ExpressionRole): boolean {
    return ROLE_TAGS[role].has(normalizeTag(tag));
}

/** The roles one tag plays, or null when it is not an expression element. */
export function rolesOf(tag: string): ReadonlySet<ExpressionRole> | null {
    return ROLES_BY_TAG.get(normalizeTag(tag)) ?? null;
}

/** Every descriptor, in registry order. */
export function descriptors(): readonly ExpressionElementDescriptor[] {
    return EXPRESSION_ELEMENTS;
}

// ── Legacy projections ───────────────────────────────────────────────────────
// These keep the JavaScript consumers on the old exact-case sets until their
// wave switches to forRole/hasRole. They are behaviour-identical to the old
// module; the role projections above are the deepened interface.

/** Expression element tags in registry order, preserving their spelling. */
export const EXPRESSION_TAGS: readonly string[] = EXPRESSION_ELEMENT_TAGS.map(tag => tag);

/** Every element whose body can carry $F/$P/$V references. */
export const REFERENCE_CONTAINERS: ReadonlySet<string> = new Set<string>([
    ...EXPRESSION_ELEMENT_TAGS,
    ...REFERENCE_ONLY_TAGS,
]);
