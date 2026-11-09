// ifElseBuilder.ts
// Pure model, generator and reverse parser for the If / Else expression builder.
//
// This module deliberately has no `vscode` and no DOM dependency, and it makes
// no module-loader calls: the webview inlines this exact file (see
// ifElsePanelHtml.js) so the browser and the tests share one implementation.
// Keep it self-contained — test/ifElsePanelHtml.test.js enforces that.

// ── Operators ────────────────────────────────────────────────────────────────

export type BuilderType = 'String' | 'Number' | 'Boolean';
export type BuilderStyle = 'ternary' | 'functions';
export type ReferenceSigil = 'F' | 'P' | 'V';
export type Join = '&&' | '||';
export type ConditionType = BuilderType | 'Custom';
export type ResultKind = 'text' | 'number' | 'expr' | 'null';

export type OperatorPair = readonly [value: string, label: string];

export const OPS: Readonly<Record<BuilderType, readonly OperatorPair[]>> = {
    String: [
        ['equals', 'equals'],
        ['notEquals', 'does not equal'],
        ['equalsIgnoreCase', 'equals (ignore case)'],
        ['contains', 'contains'],
        ['startsWith', 'starts with'],
        ['endsWith', 'ends with'],
        ['isEmpty', 'is empty'],
    ],
    Number: [
        ['==', '=='],
        ['!=', '!='],
        ['>', '>'],
        ['>=', '>='],
        ['<', '<'],
        ['<=', '<='],
    ],
    Boolean: [
        ['isTrue', 'is true'],
        ['isFalse', 'is false'],
    ],
};

export const NULLOPS: readonly OperatorPair[] = [
    ['isNull', 'is null'],
    ['notNull', 'is not null'],
];

export const NOVAL: readonly string[] = ['isEmpty', 'isTrue', 'isFalse', 'isNull', 'notNull'];

export const KINDS: readonly OperatorPair[] = [
    ['text', 'Text'],
    ['number', 'Number'],
    ['expr', 'Expression'],
    ['null', 'null'],
];

export const REF_KINDS: readonly OperatorPair[] = [
    ['F', '$F field'],
    ['P', '$P parameter'],
    ['V', '$V variable'],
];

export const STYLE_TERNARY = 'ternary';
export const STYLE_FUNCTIONS = 'functions';

const NUMBER_TYPES = /^(Integer|Long|Short|Byte|Double|Float|BigDecimal|BigInteger|Number)$/;

// ── Model helpers ────────────────────────────────────────────────────────────

export interface Condition {
    ref: ReferenceSigil;
    name: string;
    type: ConditionType;
    op: string;
    val: string;
}

export interface BranchResult {
    kind: ResultKind;
    val: string;
}

export interface Branch {
    join: Join;
    conds: Condition[];
    res: BranchResult;
}

export interface BuilderState {
    branches: Branch[];
    els: BranchResult;
}

export interface BuilderOptions {
    nullSafe?: boolean;
    multiline?: boolean;
    style?: BuilderStyle;
}

export interface NormalizedOptions {
    nullSafe: boolean;
    multiline: boolean;
    style: BuilderStyle;
}

export interface SchemaInputEntry {
    readonly name?: string | null;
    readonly type?: string | null;
    readonly cls?: string | null;
}

export interface SchemaEntry {
    name: string;
    cls: string;
}

export interface BuilderSchema {
    F: SchemaEntry[];
    P: SchemaEntry[];
    V: SchemaEntry[];
}

export interface MakeSchemaInput {
    fields?: readonly SchemaInputEntry[];
    parameters?: readonly SchemaInputEntry[];
    variables?: readonly SchemaInputEntry[];
    builtinVariables?: readonly SchemaInputEntry[];
    builtinParameters?: readonly SchemaInputEntry[];
}

/** A new empty condition (String equals). */
export function createCondition(overrides: Partial<Condition> = {}): Condition {
    return {
        ref: 'F',
        name: '',
        type: 'String',
        op: 'equals',
        val: '',
        ...overrides,
    };
}

/** A new branch with one empty condition and an empty text result. */
export function createBranch(overrides: Partial<Branch> = {}): Branch {
    return {
        join: '&&',
        conds: [createCondition()],
        res: { kind: 'text', val: '' },
        ...overrides,
    };
}

/** The state the extension starts with: one empty branch and a text else. */
export function emptyState(): BuilderState {
    return {
        branches: [createBranch()],
        els: { kind: 'text', val: '' },
    };
}

function normalizeOptions(options: BuilderOptions = {}): NormalizedOptions {
    return {
        nullSafe: options.nullSafe !== false,
        multiline: options.multiline !== false,
        style: options.style === STYLE_FUNCTIONS ? STYLE_FUNCTIONS : STYLE_TERNARY,
    };
}

/** Strip a Java package name; `java.lang.String` -> `String`. */
export function shortClass(value: string | null | undefined): string {
    const text = String(value == null ? '' : value).trim();
    if (!text) return 'Object';
    const last = text.split('.').pop();
    return last || text;
}

/** Map a declaration class to the builder's value type. */
export function typeOfClass(cls: string | null | undefined): BuilderType {
    const simple = shortClass(cls);
    if (NUMBER_TYPES.test(simple)) return 'Number';
    if (simple === 'Boolean') return 'Boolean';
    return 'String';
}

/**
 * Build the webview schema from parsed declarations plus the JasperReports
 * built-ins. Declared names win over built-ins; order is preserved.
 */
export function makeSchema({
    fields = [],
    parameters = [],
    variables = [],
    builtinVariables = [],
    builtinParameters = [],
}: MakeSchemaInput = {}): BuilderSchema {
    const merge = (
        primary: readonly SchemaInputEntry[],
        extra: readonly SchemaInputEntry[]
    ): SchemaEntry[] => {
        const seen = new Set<string>();
        const out: SchemaEntry[] = [];
        for (const item of [...(primary || []), ...(extra || [])]) {
            if (!item || !item.name) continue;
            const name = String(item.name);
            if (seen.has(name)) continue;
            seen.add(name);
            out.push({ name, cls: shortClass(item.type != null ? item.type : item.cls) });
        }
        return out;
    };

    return {
        F: merge(fields, []),
        P: merge(parameters, builtinParameters),
        V: merge(variables, builtinVariables),
    };
}

// ── Generation: state -> expression ──────────────────────────────────────────

/** Escape a Java string literal (quotes, backslashes, newlines). */
export function escapeJavaString(value: string | null | undefined): string {
    return '"' + String(value == null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t') + '"';
}

/** True for `$F{x}` / `$P{x}` / `$V{x}`. */
export function isReference(value: string | null | undefined): boolean {
    return /^\$[FPV]\{[^}]+\}$/.test(String(value == null ? '' : value).trim());
}

function referenceText(condition: Condition): string {
    return '$' + condition.ref + '{' + (condition.name.trim() || 'name') + '}';
}

/** The right-hand side of a comparison: reference, Java string or number. */
function rhs(condition: Condition): string {
    const value = String(condition.val == null ? '' : condition.val);
    if (isReference(value)) return value.trim();
    if (condition.type === 'String') return escapeJavaString(value);
    return value.trim() || '0';
}

/** Build the text of one condition. */
export function conditionText(condition: Condition, options: BuilderOptions = {}): string {
    const opts = normalizeOptions(options);
    if (condition.type === 'Custom') {
        return String(condition.val == null ? '' : condition.val).trim() || 'true';
    }

    const ref = referenceText(condition);
    const value = rhs(condition);
    const op = condition.op;
    const nullSafe = opts.nullSafe;

    // In function style the arguments are all evaluated, so null guards are
    // written as inline ternaries instead of relying on && / || short circuit.
    const functionsStyle = opts.style === STYLE_FUNCTIONS;
    const andGuard = (guard: string, expression: string): string => functionsStyle
        ? '(' + guard + ' ? ' + expression + ' : false)'
        : guard + ' && ' + expression;
    const orGuard = (guard: string, expression: string): string => functionsStyle
        ? '(' + guard + ' ? true : ' + expression + ')'
        : '(' + guard + ' || ' + expression + ')';

    if (op === 'isNull') return ref + ' == null';
    if (op === 'notNull') return ref + ' != null';

    if (condition.type === 'String') {
        if (op === 'equals') {
            return 'EQUALS(' + ref + ', ' + value + ')';
        }
        if (op === 'notEquals') {
            return 'NOT(EQUALS(' + ref + ', ' + value + '))';
        }
        if (op === 'equalsIgnoreCase') {
            return nullSafe
                ? value + '.equalsIgnoreCase(' + ref + ')'
                : ref + '.equalsIgnoreCase(' + value + ')';
        }
        if (op === 'isEmpty') {
            return nullSafe ? orGuard(ref + ' == null', ref + '.isEmpty()') : ref + '.isEmpty()';
        }
        const call = ref + '.' + op + '(' + value + ')';
        return nullSafe ? andGuard(ref + ' != null', call) : call;
    }

    if (condition.type === 'Number') {
        if (op === '!=') {
            return nullSafe ? orGuard(ref + ' == null', ref + ' != ' + value) : ref + ' != ' + value;
        }
        const expression = ref + ' ' + op + ' ' + value;
        return nullSafe ? andGuard(ref + ' != null', expression) : expression;
    }

    if (op === 'isTrue') {
        return nullSafe ? 'EQUALS(' + ref + ', true)' : ref + '.booleanValue()';
    }
    return nullSafe ? 'EQUALS(' + ref + ', false)' : '!' + ref + '.booleanValue()';
}

/** The text of one branch's result. */
function resultText(result: BranchResult | null | undefined): string {
    const value = result && result.val != null ? String(result.val) : '';
    if (!result || result.kind === 'null') return 'null';
    if (result.kind === 'text') return escapeJavaString(value);
    if (result.kind === 'number') return value.trim() || '0';
    return value.trim() || 'null';
}

/** Parenthesise an already-joined condition when precedence needs it. */
function wrapJoin(text: string): string {
    return / (&&|\|\|) /.test(text) && !/^\(.*\)$/.test(text) ? '(' + text + ')' : text;
}

/** The text of a branch condition (conditions joined by AND/OR as chosen). */
export function branchCondition(branch: Branch, options: BuilderOptions = {}): string {
    const opts = normalizeOptions(options);
    const parts = (branch.conds || []).map(condition => conditionText(condition, opts));
    if (parts.length === 1) return parts[0];

    const isOr = branch.join === '||';
    if (opts.style === STYLE_FUNCTIONS) {
        return (isOr ? 'OR(' : 'AND(') + parts.join(', ') + ')';
    }
    return '(' + parts.map(wrapJoin).join(isOr ? ' || ' : ' && ') + ')';
}

function buildBranch(
    branches: readonly Branch[],
    els: BranchResult,
    index: number,
    indent: string,
    options: NormalizedOptions
): string {
    if (index >= branches.length) return resultText(els);

    const branch = branches[index];
    const condition = branchCondition(branch, options);
    const result = resultText(branch.res);

    if (options.style === STYLE_FUNCTIONS) {
        const rest = buildBranch(branches, els, index + 1, indent + '   ', options);
        return options.multiline
            ? 'IF(' + condition + ',\n' + indent + '   ' + result + ',\n' + indent + '   ' + rest + ')'
            : 'IF(' + condition + ', ' + result + ', ' + rest + ')';
    }

    const rest = buildBranch(branches, els, index + 1, indent + '    ', options);
    return options.multiline
        ? '(' + condition + '\n' + indent + '  ? ' + result + '\n' + indent + '  : ' + rest + ')'
        : '(' + condition + ' ? ' + result + ' : ' + rest + ')';
}

/** Generate the JasperReports expression for a builder state. */
export function buildExpression(
    state: BuilderState | null | undefined,
    options: BuilderOptions = {}
): string {
    const opts = normalizeOptions(options);
    const branches: readonly Branch[] = state && Array.isArray(state.branches) ? state.branches : [];
    const els: BranchResult = state && state.els ? state.els : { kind: 'text', val: '' };
    if (branches.length === 0) return resultText(els);
    return buildBranch(branches, els, 0, '', opts);
}

// ── Reverse conversion: expression -> state ──────────────────────────────────

export interface ExpressionToken {
    k: number;
    v: string;
    s: number;
    e: number;
}

/** Tokenise an expression. */
export function tokenize(text: string): ExpressionToken[] {
    const re = /\s*(?:("(?:[^"\\]|\\.)*")|(\$[FPV]\{[^}]*\})|(-?\d+(?:\.\d+)?[LlDdFf]?)|([A-Za-z_]\w*)|(&&|\|\||==|!=|>=|<=|[()?:,.!<>]))/y;
    const tokens: ExpressionToken[] = [];
    let index = 0;

    while (index < text.length) {
        if (/^\s*$/.test(text.slice(index))) break;
        re.lastIndex = index;
        const match = re.exec(text);
        if (!match) throw new Error('Cannot read near: ' + text.slice(index, index + 14).trim());

        // The regex has one alternation per slot, so exactly one group is set.
        const kind = [1, 2, 3, 4, 5].find(slot => match[slot] !== undefined) as number;
        const value = match[kind];
        tokens.push({
            k: kind,
            v: value,
            s: re.lastIndex - value.length,
            e: re.lastIndex,
        });
        index = re.lastIndex;
    }

    return tokens;
}

// ── AST ──────────────────────────────────────────────────────────────────────

interface AstNodeBase {
    src: string;
}

export interface TernaryNode extends AstNodeBase {
    t: 'tern';
    c: AstNode;
    a: AstNode;
    b: AstNode;
    fn?: number;
}

export interface AndNode extends AstNodeBase {
    t: 'and';
    l: AstNode[];
}

export interface OrNode extends AstNodeBase {
    t: 'or';
    l: AstNode[];
}

export interface ComparisonNode extends AstNodeBase {
    t: 'cmp';
    op: string;
    l: AstNode;
    r: AstNode;
}

export interface NotNode extends AstNodeBase {
    t: 'not';
    x: AstNode;
}

export interface CallNode extends AstNodeBase {
    t: 'call';
    o: AstNode | null;
    n: string;
    args: AstNode[];
}

export interface DotNode extends AstNodeBase {
    t: 'dot';
    o: AstNode;
    n: string;
}

export interface StringNode extends AstNodeBase {
    t: 'str';
    v: string;
}

export interface ReferenceNode extends AstNodeBase {
    t: 'ref';
    r: ReferenceSigil;
    n: string;
}

export interface NumberNode extends AstNodeBase {
    t: 'num';
}

export interface NullNode extends AstNodeBase {
    t: 'null';
}

export interface BooleanNode extends AstNodeBase {
    t: 'bool';
    v: boolean;
}

export interface IdentifierNode extends AstNodeBase {
    t: 'id';
}

export type AstNode =
    | TernaryNode
    | AndNode
    | OrNode
    | ComparisonNode
    | NotNode
    | CallNode
    | DotNode
    | StringNode
    | ReferenceNode
    | NumberNode
    | NullNode
    | BooleanNode
    | IdentifierNode;

/** A node literal as written in the parser, before `mark` records its source. */
type WithoutSource<T> = T extends AstNode ? Omit<T, 'src'> & { src?: string } : never;
type AstNodeInit = WithoutSource<AstNode>;

/**
 * Parse an expression into an AST. Every node keeps `src`, the exact source
 * substring it was parsed from (without enclosing parentheses).
 */
export function parseExpression(text: string): AstNode {
    const source = String(text == null ? '' : text).trim();
    if (!source) throw new Error('Paste an expression first.');

    const tokens = tokenize(source);
    let index = 0;

    const is = (value: string): boolean =>
        tokens[index] && tokens[index].k >= 4 && tokens[index].v === value;

    const need = (value: string): void => {
        if (!is(value)) throw new Error('Expected ' + value);
        index++;
    };

    const mark = (node: AstNodeInit, startIndex: number): AstNode => {
        node.src = source.slice(tokens[startIndex].s, tokens[index - 1].e);
        return node as AstNode; // every parser path records src before returning
    };

    const expression = (): AstNode => {
        const start = index;
        const condition = or();
        if (is('?')) {
            index++;
            const thenNode = expression();
            need(':');
            const elseNode = expression();
            return mark({ t: 'tern', c: condition, a: thenNode, b: elseNode }, start);
        }
        return condition;
    };

    const list = (
        parseItem: () => AstNode,
        operator: string,
        type: 'and' | 'or'
    ): (() => AstNode) => () => {
        const start = index;
        const items = [parseItem()];
        while (is(operator)) {
            index++;
            items.push(parseItem());
        }
        return items.length > 1 ? mark({ t: type, l: items }, start) : items[0];
    };

    const comparison = (): AstNode => {
        const start = index;
        const left = unary();
        for (const operator of ['==', '!=', '>=', '<=', '>', '<']) {
            if (is(operator)) {
                index++;
                return mark({ t: 'cmp', op: operator, l: left, r: unary() }, start);
            }
        }
        return left;
    };

    const unary = (): AstNode => {
        const start = index;
        if (is('!')) {
            index++;
            return mark({ t: 'not', x: unary() }, start);
        }
        return postfix();
    };

    const argumentsList = (): AstNode[] => {
        const items: AstNode[] = [];
        if (is(')')) {
            index++;
            return items;
        }
        do {
            items.push(expression());
        } while (is(',') && ++index);
        need(')');
        return items;
    };

    const postfix = (): AstNode => {
        const start = index;
        let node = primary();
        while (is('.')) {
            index++;
            const name = tokens[index++].v;
            if (is('(')) {
                index++;
                node = mark({ t: 'call', o: node, n: name, args: argumentsList() }, start);
            } else {
                node = mark({ t: 'dot', o: node, n: name }, start);
            }
        }
        return node;
    };

    const primary = (): AstNode => {
        const start = index;
        const token = tokens[index];
        if (!token) throw new Error('Unexpected end of expression');
        index++;

        if (token.k === 1) {
            let value: string;
            try {
                value = JSON.parse(token.v) as string;
            } catch {
                value = token.v.slice(1, -1);
            }
            return mark({ t: 'str', v: value }, start);
        }
        if (token.k === 2) {
            return mark({ t: 'ref', r: token.v[1] as ReferenceSigil, n: token.v.slice(3, -1) }, start);
        }
        if (token.k === 3) return mark({ t: 'num' }, start);
        if (token.v === '(') {
            const inner = expression();
            need(')');
            return inner;
        }
        if (token.k === 4) {
            if (is('(')) {
                index++;
                const args = argumentsList();
                if (token.v === 'IF' && args.length === 3) {
                    return mark({ t: 'tern', c: args[0], a: args[1], b: args[2], fn: 1 }, start);
                }
                if (token.v === 'AND') return mark({ t: 'and', l: args }, start);
                if (token.v === 'OR') return mark({ t: 'or', l: args }, start);
                if (token.v === 'NOT' && args.length === 1) return mark({ t: 'not', x: args[0] }, start);
                return mark({ t: 'call', o: null, n: token.v, args }, start);
            }
            if (token.v === 'null') return mark({ t: 'null' }, start);
            if (token.v === 'true' || token.v === 'false') {
                return mark({ t: 'bool', v: token.v === 'true' }, start);
            }
            return mark({ t: 'id' }, start);
        }
        throw new Error('Unexpected ' + token.v);
    };

    const and = list(comparison, '&&', 'and');
    const or = list(and, '||', 'or');

    const root = expression();
    if (index < tokens.length) throw new Error('Unexpected ' + tokens[index].v);
    return root;
}

/** `ref == null` / `ref != null` -> the reference source, else null. */
function nullComparison(node: AstNode, operator: string): string | null {
    return node.t === 'cmp' && node.op === operator && node.r.t === 'null' && node.l.t === 'ref'
        ? node.l.src
        : null;
}

interface ConversionContext {
    nullSafe: boolean;
}

interface ConditionGroup {
    join: Join;
    conds: Condition[];
}

/**
 * Convert an AST node into a builder condition. Unmapped parts become Custom
 * conditions whose value is the node source, so nothing is dropped silently.
 */
function toCondition(node: AstNode, context: ConversionContext): Condition {
    const fromRef = (
        ref: ReferenceNode,
        type: ConditionType,
        op: string,
        value?: string | null
    ): Condition => ({
        ref: ref.r,
        name: ref.n,
        type,
        op,
        val: value == null ? '' : value,
    });
    const custom = (): Condition => ({ ref: 'F', name: '', type: 'Custom', op: '', val: node.src });

    const guarded = (candidate: AstNode, allowed: readonly string[]): Condition | null => {
        const condition = toCondition(candidate, context);
        if (condition.type !== 'Custom' && allowed.includes(condition.op)) {
            context.nullSafe = true;
            return condition;
        }
        return null;
    };

    const andOps = ['contains', 'startsWith', 'endsWith', '>', '>=', '<', '<=', '=='];
    const orOps = ['isEmpty', '!='];

    // 1. Null guards.
    let guardedResult: Condition | null = null;
    if (node.t === 'and' && node.l.length === 2) {
        const reference = nullComparison(node.l[0], '!=');
        if (reference && node.l[1].src.includes(reference) &&
            (guardedResult = guarded(node.l[1], andOps))) return guardedResult;
    }
    if (node.t === 'or' && node.l.length === 2) {
        const reference = nullComparison(node.l[0], '==');
        if (reference && node.l[1].src.includes(reference) &&
            (guardedResult = guarded(node.l[1], orOps))) return guardedResult;
    }
    if (node.t === 'tern') {
        if (nullComparison(node.c, '!=') && node.b.t === 'bool' && !node.b.v &&
            (guardedResult = guarded(node.a, andOps))) return guardedResult;
        if (nullComparison(node.c, '==') && node.a.t === 'bool' && node.a.v &&
            (guardedResult = guarded(node.b, orOps))) return guardedResult;
    }

    // 2. Negation.
    if (node.t === 'not') {
        const condition = toCondition(node.x, context);
        if (condition.type === 'String' && condition.op === 'equals') {
            return { ...condition, op: 'notEquals' };
        }
        if (condition.type === 'Boolean' && condition.op === 'isTrue') {
            return { ...condition, op: 'isFalse' };
        }
        return custom();
    }

    // 3. Comparisons.
    if (node.t === 'cmp') {
        const { l, r, op } = node;
        const flip: Readonly<Record<string, string>> = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' };
        if (r.t === 'null' && l.t === 'ref' && (op === '==' || op === '!=')) {
            // A null check only says the type is nullable; keep String as the
            // reference UI does and let the user pick a type if they need to.
            return fromRef(l, 'String', op === '==' ? 'isNull' : 'notNull');
        }
        if (l.t === 'ref' && (r.t === 'num' || r.t === 'ref')) {
            return fromRef(l, 'Number', op, r.src);
        }
        if (r.t === 'ref' && l.t === 'num') {
            return fromRef(r, 'Number', flip[op] || op, l.src);
        }
    }

    // 4. Calls: JasperReports helpers and Java methods.
    if (node.t === 'call') {
        const args = node.args || [];
        const argument = args[0];
        const valueOf = (valueNode: AstNode): string =>
            (valueNode.t === 'str' ? valueNode.v : valueNode.src);

        if (!node.o && node.n === 'EQUALS' && args.length === 2) {
            const [left, right] = args;
            if (left.t === 'ref' && right.t === 'bool') {
                context.nullSafe = true;
                return fromRef(left, 'Boolean', right.v ? 'isTrue' : 'isFalse');
            }
            if (right.t === 'ref' && left.t === 'bool') {
                context.nullSafe = true;
                return fromRef(right, 'Boolean', left.v ? 'isTrue' : 'isFalse');
            }
            if (left.t === 'ref' && right.t === 'null') {
                return fromRef(left, 'String', 'isNull');
            }
            if (right.t === 'ref' && left.t === 'null') {
                return fromRef(right, 'String', 'isNull');
            }
            if (left.t === 'ref' && right.t === 'num') {
                return fromRef(left, 'Number', '==', right.src);
            }
            if (right.t === 'ref' && left.t === 'num') {
                return fromRef(right, 'Number', '==', left.src);
            }
            if (left.t === 'ref' && (right.t === 'str' || right.t === 'ref')) {
                return fromRef(left, 'String', 'equals', valueOf(right));
            }
            if (right.t === 'ref' && left.t === 'str') {
                return fromRef(right, 'String', 'equals', left.v);
            }
        }

        if (node.o) {
            const object = node.o;
            const method = node.n;

            if (object.src === 'Boolean.TRUE' && argument && argument.t === 'ref') {
                context.nullSafe = true;
                return fromRef(argument, 'Boolean', 'isTrue');
            }
            if (object.src === 'Boolean.FALSE' && argument && argument.t === 'ref') {
                context.nullSafe = true;
                return fromRef(argument, 'Boolean', 'isFalse');
            }
            if (method === 'booleanValue' && object.t === 'ref') {
                return fromRef(object, 'Boolean', 'isTrue');
            }
            if (method === 'isEmpty' && object.t === 'ref') {
                return fromRef(object, 'String', 'isEmpty');
            }
            if (['equals', 'equalsIgnoreCase', 'contains', 'startsWith', 'endsWith'].includes(method) && argument) {
                if (object.t === 'ref' && (argument.t === 'str' || argument.t === 'ref')) {
                    return fromRef(object, 'String', method, valueOf(argument));
                }
                if (object.t === 'str' && argument.t === 'ref' && method.startsWith('equals')) {
                    context.nullSafe = true;
                    return fromRef(argument, 'String', method, object.v);
                }
            }
        }
    }

    return custom();
}

/** Convert a branch-condition AST node into `{ join, conds }`. */
function toConditionGroup(node: AstNode, context: ConversionContext): ConditionGroup {
    const condition = toCondition(node, context);
    if (condition.type !== 'Custom' || (node.t !== 'and' && node.t !== 'or')) {
        return { join: '&&', conds: [condition] };
    }
    return {
        join: node.t === 'and' ? '&&' : '||',
        conds: node.l.map(item => toCondition(item, context)),
    };
}

// ── Structured reverse parsing ───────────────────────────────────────────────
//
// The builder owns only the conditional skeleton. A branch result is arbitrary
// Java/JasperReports source (`$F{first} + " " + $F{last}`, `new Date()`, a
// method chain, …), so results are captured verbatim instead of being fed to
// the condition parser. Conditions still go through the AST parser above; a
// condition it cannot read becomes a Custom condition and is written back as-is.

const OPEN_BRACKETS = '([{';
const CLOSE_FOR: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

/** Index just past the quoted literal starting at `index`. */
function skipLiteral(text: string, index: number): number {
    const quote = text[index];
    let i = index + 1;
    while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) return i + 1;
        i += 1;
    }
    throw new Error('Expected ' + quote);
}

/** Index just past a comment starting at `index`, or -1 when there is none. */
function skipComment(text: string, index: number): number {
    if (text[index] !== '/') return -1;
    if (text[index + 1] === '/') {
        const end = text.indexOf('\n', index + 2);
        return end === -1 ? text.length : end;
    }
    if (text[index + 1] === '*') {
        const end = text.indexOf('*/', index + 2);
        if (end === -1) throw new Error('Expected */');
        return end + 2;
    }
    return -1;
}

/** Index of the bracket that closes the one at `openIndex`. */
function matchBracket(text: string, openIndex: number): number {
    const open = text[openIndex];
    const close = CLOSE_FOR[open];
    let depth = 0;

    for (let i = openIndex; i < text.length;) {
        const ch = text[i];
        if (ch === '"' || ch === "'") { i = skipLiteral(text, i); continue; }

        const commentEnd = skipComment(text, i);
        if (commentEnd !== -1) { i = commentEnd; continue; }

        if (ch === open) depth += 1;
        else if (ch === close) {
            depth -= 1;
            if (depth === 0) return i;
        }
        i += 1;
    }
    throw new Error('Expected ' + close);
}

/**
 * A `?` in a generic type list is a wildcard, not a ternary. Reject it when it
 * sits in an operator position (`a < b ? c > d`) or starts something that is
 * not `>`, `,`, `extends` or `super`.
 */
function isGenericWildcard(text: string, start: number, index: number): boolean {
    let before = index - 1;
    while (before >= start && /\s/.test(text[before])) before -= 1;
    if (before >= start && text[before] !== '<' && text[before] !== ',') return false;

    let after = index + 1;
    while (after < text.length && /\s/.test(text[after])) after += 1;
    const rest = text.slice(after);
    return rest === '' || rest[0] === '>' || rest[0] === ',' || /^(extends|super)\b/.test(rest);
}

/**
 * End of a generic type-argument list starting at `<`, or -1 when this is an
 * ordinary comparison. Inside type arguments a `,` separates parameters and a
 * `?` is a wildcard — neither may split or open a conditional.
 */
function genericEnd(text: string, index: number): number {
    if (text[index] !== '<') return -1;

    let depth = 0;
    for (let i = index; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '<') { depth += 1; continue; }
        if (ch === '>') {
            depth -= 1;
            if (depth === 0) return i + 1;
            continue;
        }
        if (ch === '?' && depth > 0 && !isGenericWildcard(text, index + 1, i)) return -1;
        // Anything that cannot appear in a type list means this was `<`, not a generic.
        if (/[(){};=+*/%&|!~^:"'$]/.test(ch)) return -1;
    }
    return -1;
}

/** Split on `separator` occurrences outside strings, comments and brackets. */
function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let start = 0;

    for (let i = 0; i < text.length;) {
        const ch = text[i];
        if (ch === '"' || ch === "'") { i = skipLiteral(text, i); continue; }

        const commentEnd = skipComment(text, i);
        if (commentEnd !== -1) { i = commentEnd; continue; }

        if (OPEN_BRACKETS.includes(ch)) { i = matchBracket(text, i) + 1; continue; }

        const generic = genericEnd(text, i);
        if (generic !== -1) { i = generic; continue; }

        if (ch === separator) { parts.push(text.slice(start, i)); start = i + 1; }
        i += 1;
    }
    parts.push(text.slice(start));
    return parts;
}

/** Remove parentheses that enclose the whole value (`(a ? b : c)`). */
function stripOuterParens(value: string | null | undefined): string {
    let text = String(value == null ? '' : value).trim();
    while (text[0] === '(') {
        const close = matchBracket(text, 0);
        if (close !== text.length - 1) break;
        text = text.slice(1, -1).trim();
    }
    return text;
}

/** Index of the first `?` outside strings, comments and brackets, or -1. */
function findTopLevelQuestion(text: string): number {
    for (let i = 0; i < text.length;) {
        const ch = text[i];
        if (ch === '"' || ch === "'") { i = skipLiteral(text, i); continue; }

        const commentEnd = skipComment(text, i);
        if (commentEnd !== -1) { i = commentEnd; continue; }

        if (OPEN_BRACKETS.includes(ch)) { i = matchBracket(text, i) + 1; continue; }

        const generic = genericEnd(text, i);
        if (generic !== -1) { i = generic; continue; }

        if (ch === '?') return i;
        i += 1;
    }
    return -1;
}

/** The `:` matching the `?` before `start`, honouring nested ternaries. */
function findTernaryColon(text: string, start: number): number {
    let nested = 0;

    for (let i = start; i < text.length;) {
        const ch = text[i];
        if (ch === '"' || ch === "'") { i = skipLiteral(text, i); continue; }

        const commentEnd = skipComment(text, i);
        if (commentEnd !== -1) { i = commentEnd; continue; }

        if (OPEN_BRACKETS.includes(ch)) { i = matchBracket(text, i) + 1; continue; }

        const generic = genericEnd(text, i);
        if (generic !== -1) { i = generic; continue; }

        if (ch === '?') { nested += 1; i += 1; continue; }
        if (ch === ':') {
            if (text[i + 1] === ':') { i += 2; continue; } // method reference
            if (nested === 0) return i;
            nested -= 1;
        }
        i += 1;
    }
    throw new Error('Expected :');
}

export interface ParsedConditional {
    style: BuilderStyle;
    cond: string;
    then: string;
    els: string;
}

/**
 * Read one conditional level: either `IF(cond, then, else)` or
 * `cond ? then : else`. Returns null when the text is a plain result.
 */
function parseConditional(value: string | null | undefined): ParsedConditional | null {
    const text = stripOuterParens(value);
    if (!text) return null;

    const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(text);
    if (call && text[text.length - 1] === ')') {
        const open = call[0].lastIndexOf('(');
        if (matchBracket(text, open) === text.length - 1 && call[1] === 'IF') {
            const args = splitTopLevel(text.slice(open + 1, -1), ',');
            if (args.length === 3) {
                return {
                    style: STYLE_FUNCTIONS,
                    cond: args[0],
                    then: args[1],
                    els:  args[2],
                };
            }
        }
    }

    const question = findTopLevelQuestion(text);
    if (question !== -1) {
        const colon = findTernaryColon(text, question + 1);
        return {
            style: STYLE_TERNARY,
            cond: text.slice(0, question),
            then: text.slice(question + 1, colon),
            els:  text.slice(colon + 1),
        };
    }
    return null;
}

/** Decode a Java string literal (the inverse of escapeJavaString). */
function parseStringLiteral(raw: string): string {
    const body = raw.slice(1, -1);
    let out = '';

    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (ch !== '\\') { out += ch; continue; }

        const next = body[i + 1];
        i += 1;
        switch (next) {
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'u': {
                const hex = body.slice(i + 1, i + 5);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                    out += String.fromCharCode(parseInt(hex, 16));
                    i += 4;
                } else {
                    out += 'u';
                }
                break;
            }
            case undefined: break;
            default: out += next;
        }
    }
    return out;
}

/**
 * Classify a result as a text/number/null literal or an opaque expression.
 * The raw source is kept for expressions so nothing is normalised away.
 */
function resultFromText(text: string | null | undefined): BranchResult {
    const raw = String(text == null ? '' : text).trim();
    const literal = stripOuterParens(raw);

    if (literal === 'null') return { kind: 'null', val: '' };
    if (/^"(?:[^"\\]|\\.)*"$/.test(literal)) {
        return { kind: 'text', val: parseStringLiteral(literal) };
    }
    if (/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[LlDdFf])?$/.test(literal)) {
        return { kind: 'number', val: literal };
    }
    return { kind: 'expr', val: raw };
}

/** Conditions keep their structured form when possible; otherwise stay raw. */
function conditionGroupFromText(
    text: string | null | undefined,
    context: ConversionContext
): ConditionGroup {
    const value = String(text == null ? '' : text).trim();
    try {
        return toConditionGroup(parseExpression(value), context);
    } catch {
        return {
            join: '&&',
            conds: [{ ref: 'F', name: '', type: 'Custom', op: '', val: value }],
        };
    }
}

export interface FromExpressionResult {
    state: BuilderState;
    nullSafe: boolean;
    style: BuilderStyle;
}

/**
 * Parse an expression back into builder state.
 *
 * Only the conditional structure is parsed. Branch results may be any Java /
 * JasperReports expression: they are captured verbatim and written back as-is,
 * so mixed expressions such as `$F{a} + " " + $F{b}` or `new Date()` survive a
 * load.
 *
 * @throws {Error} with a readable message when the expression cannot be parsed
 */
export function fromExpression(text: string | null | undefined): FromExpressionResult {
    const source = String(text == null ? '' : text).trim();
    if (!source) throw new Error('Paste an expression first.');

    const context: ConversionContext = { nullSafe: false };
    const branches: Branch[] = [];
    let detectedStyle: BuilderStyle | null = null;
    let rest = source;

    while (true) {
        const part = parseConditional(rest);
        if (!part) break;

        detectedStyle = detectedStyle || part.style;
        const group = conditionGroupFromText(part.cond, context);
        branches.push({
            join: group.join,
            conds: group.conds,
            res: resultFromText(part.then),
        });
        rest = part.els;
    }

    return {
        state: {
            branches: branches.length ? branches : [createBranch()],
            els: resultFromText(rest),
        },
        nullSafe: context.nullSafe,
        style: detectedStyle || STYLE_TERNARY,
    };
}
