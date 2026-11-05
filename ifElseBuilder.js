// ifElseBuilder.js
// Pure model, generator and reverse parser for the If / Else expression builder.
//
// This module deliberately has no `vscode` and no DOM dependency, and it makes
// no module-loader calls: the webview inlines this exact file (see
// ifElsePanelHtml.js) so the browser and the tests share one implementation.
// Keep it self-contained — test/ifElsePanelHtml.test.js enforces that.

'use strict';

// ── Operators ────────────────────────────────────────────────────────────────

const OPS = {
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

const NULLOPS = [
    ['isNull', 'is null'],
    ['notNull', 'is not null'],
];

const NOVAL = ['isEmpty', 'isTrue', 'isFalse', 'isNull', 'notNull'];

const KINDS = [
    ['text', 'Text'],
    ['number', 'Number'],
    ['expr', 'Expression'],
    ['null', 'null'],
];

const REF_KINDS = [
    ['F', '$F field'],
    ['P', '$P parameter'],
    ['V', '$V variable'],
];

const STYLE_TERNARY = 'ternary';
const STYLE_FUNCTIONS = 'functions';

const NUMBER_TYPES = /^(Integer|Long|Short|Byte|Double|Float|BigDecimal|BigInteger|Number)$/;

// ── Model helpers ────────────────────────────────────────────────────────────

/** A new empty condition (String equals). */
function createCondition(overrides = {}) {
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
function createBranch(overrides = {}) {
    return {
        join: '&&',
        conds: [createCondition()],
        res: { kind: 'text', val: '' },
        ...overrides,
    };
}

/** The state the extension starts with: one empty branch and a text else. */
function emptyState() {
    return {
        branches: [createBranch()],
        els: { kind: 'text', val: '' },
    };
}

function normalizeOptions(options = {}) {
    return {
        nullSafe: options.nullSafe !== false,
        multiline: options.multiline !== false,
        style: options.style === STYLE_FUNCTIONS ? STYLE_FUNCTIONS : STYLE_TERNARY,
    };
}

/** Strip a Java package name; `java.lang.String` -> `String`. */
function shortClass(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return 'Object';
    const last = text.split('.').pop();
    return last || text;
}

/** Map a declaration class to the builder's value type. */
function typeOfClass(cls) {
    const simple = shortClass(cls);
    if (NUMBER_TYPES.test(simple)) return 'Number';
    if (simple === 'Boolean') return 'Boolean';
    return 'String';
}

/**
 * Build the webview schema from parsed declarations plus the JasperReports
 * built-ins. Declared names win over built-ins; order is preserved.
 *
 * @param {{fields?:Array,parameters?:Array,variables?:Array,builtinVariables?:Array,builtinParameters?:Array}} input
 * @returns {{F:Array<{name:string,cls:string}>,P:Array,V:Array}}
 */
function makeSchema({
    fields = [],
    parameters = [],
    variables = [],
    builtinVariables = [],
    builtinParameters = [],
} = {}) {
    const merge = (primary, extra) => {
        const seen = new Set();
        const out = [];
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
function escapeJavaString(value) {
    return '"' + String(value == null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t') + '"';
}

/** True for `$F{x}` / `$P{x}` / `$V{x}`. */
function isReference(value) {
    return /^\$[FPV]\{[^}]+\}$/.test(String(value == null ? '' : value).trim());
}

function referenceText(condition) {
    return '$' + condition.ref + '{' + (condition.name.trim() || 'name') + '}';
}

/** The right-hand side of a comparison: reference, Java string or number. */
function rhs(condition) {
    const value = String(condition.val == null ? '' : condition.val);
    if (isReference(value)) return value.trim();
    if (condition.type === 'String') return escapeJavaString(value);
    return value.trim() || '0';
}

/**
 * Build the text of one condition.
 *
 * @param {object} condition
 * @param {object} options normalised options ({nullSafe})
 * @returns {string}
 */
function conditionText(condition, options = {}) {
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
    const andGuard = (guard, expression) => functionsStyle
        ? '(' + guard + ' ? ' + expression + ' : false)'
        : guard + ' && ' + expression;
    const orGuard = (guard, expression) => functionsStyle
        ? '(' + guard + ' ? true : ' + expression + ')'
        : '(' + guard + ' || ' + expression + ')';

    if (op === 'isNull') return ref + ' == null';
    if (op === 'notNull') return ref + ' != null';

    if (condition.type === 'String') {
        if (op === 'equals') {
            return nullSafe ? value + '.equals(' + ref + ')' : ref + '.equals(' + value + ')';
        }
        if (op === 'notEquals') {
            return '!' + (nullSafe ? value + '.equals(' + ref + ')' : ref + '.equals(' + value + ')');
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
        return nullSafe ? 'Boolean.TRUE.equals(' + ref + ')' : ref + '.booleanValue()';
    }
    return nullSafe ? 'Boolean.FALSE.equals(' + ref + ')' : '!' + ref + '.booleanValue()';
}

/** The text of one branch's result. */
function resultText(result) {
    const value = result && result.val != null ? String(result.val) : '';
    if (!result || result.kind === 'null') return 'null';
    if (result.kind === 'text') return escapeJavaString(value);
    if (result.kind === 'number') return value.trim() || '0';
    return value.trim() || 'null';
}

/** Parenthesise an already-joined condition when precedence needs it. */
function wrapJoin(text) {
    return / (&&|\|\|) /.test(text) && !/^\(.*\)$/.test(text) ? '(' + text + ')' : text;
}

/** The text of a branch condition (conditions joined by AND/OR as chosen). */
function branchCondition(branch, options = {}) {
    const opts = normalizeOptions(options);
    const parts = (branch.conds || []).map(condition => conditionText(condition, opts));
    if (parts.length === 1) return parts[0];

    const isOr = branch.join === '||';
    if (opts.style === STYLE_FUNCTIONS) {
        return (isOr ? 'OR(' : 'AND(') + parts.join(', ') + ')';
    }
    return '(' + parts.map(wrapJoin).join(isOr ? ' || ' : ' && ') + ')';
}

function buildBranch(branches, els, index, indent, options) {
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

/**
 * Generate the JasperReports expression for a builder state.
 *
 * @param {{branches:Array,els:object}} state
 * @param {{nullSafe?:boolean,multiline?:boolean,style?:'ternary'|'functions'}} [options]
 * @returns {string}
 */
function buildExpression(state, options = {}) {
    const opts = normalizeOptions(options);
    const branches = Array.isArray(state && state.branches) ? state.branches : [];
    const els = state && state.els ? state.els : { kind: 'text', val: '' };
    if (branches.length === 0) return resultText(els);
    return buildBranch(branches, els, 0, '', opts);
}

// ── Reverse conversion: expression -> state ──────────────────────────────────

/**
 * Tokenise an expression.
 * @param {string} text
 * @returns {Array<{k:number,v:string,s:number,e:number}>}
 */
function tokenize(text) {
    const re = /\s*(?:("(?:[^"\\]|\\.)*")|(\$[FPV]\{[^}]*\})|(-?\d+(?:\.\d+)?[LlDdFf]?)|([A-Za-z_]\w*)|(&&|\|\||==|!=|>=|<=|[()?:,.!<>]))/y;
    const tokens = [];
    let index = 0;

    while (index < text.length) {
        if (/^\s*$/.test(text.slice(index))) break;
        re.lastIndex = index;
        const match = re.exec(text);
        if (!match) throw new Error('Cannot read near: ' + text.slice(index, index + 14).trim());

        const kind = [1, 2, 3, 4, 5].find(slot => match[slot] !== undefined);
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

/**
 * Parse an expression into an AST. Every node keeps `src`, the exact source
 * substring it was parsed from (without enclosing parentheses).
 *
 * @param {string} text
 * @returns {object} AST root
 */
function parseExpression(text) {
    const source = String(text == null ? '' : text).trim();
    if (!source) throw new Error('Paste an expression first.');

    const tokens = tokenize(source);
    let index = 0;

    const is = value => tokens[index] && tokens[index].k >= 4 && tokens[index].v === value;
    const need = value => {
        if (!is(value)) throw new Error('Expected ' + value);
        index++;
    };
    const mark = (node, startIndex) => {
        node.src = source.slice(tokens[startIndex].s, tokens[index - 1].e);
        return node;
    };

    const expression = () => {
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

    const list = (parseItem, operator, type) => () => {
        const start = index;
        const items = [parseItem()];
        while (is(operator)) {
            index++;
            items.push(parseItem());
        }
        return items.length > 1 ? mark({ t: type, l: items }, start) : items[0];
    };

    const comparison = () => {
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

    const unary = () => {
        const start = index;
        if (is('!')) {
            index++;
            return mark({ t: 'not', x: unary() }, start);
        }
        return postfix();
    };

    const argumentsList = () => {
        const items = [];
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

    const postfix = () => {
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

    const primary = () => {
        const start = index;
        const token = tokens[index];
        if (!token) throw new Error('Unexpected end of expression');
        index++;

        if (token.k === 1) {
            let value;
            try {
                value = JSON.parse(token.v);
            } catch (_err) {
                value = token.v.slice(1, -1);
            }
            return mark({ t: 'str', v: value }, start);
        }
        if (token.k === 2) return mark({ t: 'ref', r: token.v[1], n: token.v.slice(3, -1) }, start);
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
function nullComparison(node, operator) {
    return node.t === 'cmp' && node.op === operator && node.r.t === 'null' && node.l.t === 'ref'
        ? node.l.src
        : null;
}

/**
 * Convert an AST node into a builder condition. Unmapped parts become Custom
 * conditions whose value is the node source, so nothing is dropped silently.
 *
 * @param {object} node
 * @param {{nullSafe:boolean}} context
 * @returns {object}
 */
function toCondition(node, context) {
    const fromRef = (ref, type, op, value) => ({
        ref: ref.r,
        name: ref.n,
        type,
        op,
        val: value == null ? '' : value,
    });
    const custom = () => ({ ref: 'F', name: '', type: 'Custom', op: '', val: node.src });

    const guarded = (candidate, allowed) => {
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
    let guardedResult;
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
        const flip = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' };
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

    // 4. Method calls and static helpers.
    if (node.t === 'call' && node.o) {
        const object = node.o;
        const argument = node.args[0];
        const method = node.n;
        const valueOf = valueNode => (valueNode.t === 'str' ? valueNode.v : valueNode.src);

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

    return custom();
}

/**
 * Convert a branch-condition AST node into `{ join, conds }`.
 * @param {object} node
 * @param {{nullSafe:boolean}} context
 */
function toConditionGroup(node, context) {
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
const CLOSE_FOR = { '(': ')', '[': ']', '{': '}' };

/** Index just past the quoted literal starting at `index`. */
function skipLiteral(text, index) {
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
function skipComment(text, index) {
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
function matchBracket(text, openIndex) {
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
function isGenericWildcard(text, start, index) {
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
function genericEnd(text, index) {
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
function splitTopLevel(text, separator) {
    const parts = [];
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
function stripOuterParens(value) {
    let text = String(value == null ? '' : value).trim();
    while (text[0] === '(') {
        const close = matchBracket(text, 0);
        if (close !== text.length - 1) break;
        text = text.slice(1, -1).trim();
    }
    return text;
}

/** Index of the first `?` outside strings, comments and brackets, or -1. */
function findTopLevelQuestion(text) {
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
function findTernaryColon(text, start) {
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

/**
 * Read one conditional level: either `IF(cond, then, else)` or
 * `cond ? then : else`. Returns null when the text is a plain result.
 *
 * @returns {{style:string,cond:string,then:string,els:string}|null}
 */
function parseConditional(value) {
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
function parseStringLiteral(raw) {
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
function resultFromText(text) {
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
function conditionGroupFromText(text, context) {
    const value = String(text == null ? '' : text).trim();
    try {
        return toConditionGroup(parseExpression(value), context);
    } catch (_err) {
        return {
            join: '&&',
            conds: [{ ref: 'F', name: '', type: 'Custom', op: '', val: value }],
        };
    }
}

/**
 * Parse an expression back into builder state.
 *
 * Only the conditional structure is parsed. Branch results may be any Java /
 * JasperReports expression: they are captured verbatim and written back as-is,
 * so mixed expressions such as `$F{a} + " " + $F{b}` or `new Date()` survive a
 * load.
 *
 * @param {string} text
 * @returns {{state:{branches:Array,els:object},nullSafe:boolean,style:'ternary'|'functions'}}
 * @throws {Error} with a readable message when the expression cannot be parsed
 */
function fromExpression(text) {
    const source = String(text == null ? '' : text).trim();
    if (!source) throw new Error('Paste an expression first.');

    const context = { nullSafe: false };
    const branches = [];
    let detectedStyle = null;
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

module.exports = {
    OPS,
    NULLOPS,
    NOVAL,
    KINDS,
    REF_KINDS,
    STYLE_TERNARY,
    STYLE_FUNCTIONS,
    createCondition,
    createBranch,
    emptyState,
    shortClass,
    typeOfClass,
    makeSchema,
    escapeJavaString,
    isReference,
    conditionText,
    branchCondition,
    buildExpression,
    tokenize,
    parseExpression,
    fromExpression,
};
