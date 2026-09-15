// javaParser.js
// A small, scoped Java expression parser.
//
// It supports the subset the null-dereference rule needs and nothing more:
// literals, names, field access, method calls, array access, casts, unary and
// binary operators, ternaries, `new`, and `instanceof`. Anything it does not
// understand makes `parseExpression` return null, which callers treat as
// "not valid Java — leave it alone" (the hook's own policy).
//
// Nodes carry the character offset where they start so diagnostics can be
// anchored back onto the original expression.

const { literalEnd } = require('./javaExpr');

// Longest-first so `>>` wins over `>`.
const OPERATORS = [
    '>>>=', '>>>', '>>=', '<<=', '...', '->', '::', '++', '--', '&&', '||',
    '==', '!=', '<=', '>=', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=',
    '|=', '^=', '<', '>', '=', '!', '~', '?', ':', '+', '-', '*', '/', '%',
    '&', '|', '^', '.', ',', '(', ')', '[', ']', '{', '}', ';', '@',
];

const NUMBER_RE = /^(?:0[xX][0-9a-fA-F_]+[lL]?|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?[fFdDlL]?|\.\d[\d_]*(?:[eE][+-]?\d+)?[fFdDlL]?)/;

const BINARY_PRECEDENCE = {
    '||': 1,
    '&&': 2,
    '|': 3,
    '^': 4,
    '&': 5,
    '==': 6, '!=': 6,
    '<': 7, '>': 7, '<=': 7, '>=': 7, 'instanceof': 7,
    '<<': 8, '>>': 8, '>>>': 8,
    '+': 9, '-': 9,
    '*': 10, '/': 10, '%': 10,
};

const ASSIGNMENT_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=']);

const FAIL = new Error('parse-fail');

// Deeply nested input (parentheses, unary chains, casts) must not overflow the
// stack; exceeding this fails the parse, which callers treat as "not Java".
const MAX_DEPTH = 200;

function tokenize(code) {
    const tokens = [];
    let i = 0;
    const n = code.length;

    while (i < n) {
        const c = code[i];

        if (/\s/.test(c)) { i++; continue; }
        if (code.startsWith('//', i)) { i += 2; while (i < n && code[i] !== '\n') i++; continue; }
        if (code.startsWith('/*', i)) {
            i += 2;
            while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
            i = Math.min(n, i + 2);
            continue;
        }
        if (c === '"' || c === "'") {
            const start = i;
            const end = literalEnd(code, i);
            const type = code.startsWith('"""', i) ? 'textblock' : (c === '"' ? 'string' : 'char');
            tokens.push({ type, value: code.slice(start, end), start, end });
            i = end;
            continue;
        }
        if (/[A-Za-z_$]/.test(c)) {
            const start = i;
            while (i < n && /[A-Za-z0-9_$]/.test(code[i])) i++;
            tokens.push({ type: 'ident', value: code.slice(start, i), start, end: i });
            continue;
        }

        const num = NUMBER_RE.exec(code.slice(i));
        if (num) {
            tokens.push({ type: 'number', value: num[0], start: i, end: i + num[0].length });
            i += num[0].length;
            continue;
        }

        const op = OPERATORS.find(o => code.startsWith(o, i));
        if (op) {
            tokens.push({ type: 'op', value: op, start: i, end: i + op.length });
            i += op.length;
            continue;
        }

        tokens.push({ type: 'punct', value: c, start: i, end: i + 1 });
        i++;
    }

    return tokens;
}

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.i = 0;
        this.depth = 0;
    }

    /** Depth guard around the recursive-descent entry points. */
    guarded(fn) {
        if (++this.depth > MAX_DEPTH) {
            this.depth--;
            throw FAIL;
        }
        try {
            return fn();
        } finally {
            this.depth--;
        }
    }

    peek(k = 0) { return this.tokens[this.i + k]; }
    next() { const t = this.tokens[this.i++]; if (!t) throw FAIL; return t; }
    at(value) { const t = this.peek(); return !!t && t.value === value; }

    eat(value) {
        if (!this.at(value)) return false;
        this.i++;
        return true;
    }

    expect(value) {
        if (!this.eat(value)) throw FAIL;
    }

    parseExpression() {
        return this.parseAssignment();
    }

    parseAssignment() {
        return this.guarded(() => {
            const left = this.parseTernary();
            const t = this.peek();
            if (t && ASSIGNMENT_OPS.has(t.value)) {
                this.next();
                return { kind: 'binary', op: t.value, left, right: this.parseAssignment(), start: left.start };
            }
            return left;
        });
    }

    parseTernary() {
        const cond = this.parseBinary(1);
        if (this.eat('?')) {
            const then = this.parseAssignment();
            this.expect(':');
            const els = this.parseAssignment();
            return { kind: 'conditional', cond, then, els, start: cond.start };
        }
        return cond;
    }

    parseBinary(minPrecedence) {
        let left = this.parseUnary();

        for (;;) {
            const t = this.peek();
            if (!t) break;

            const value = (t.type === 'ident' && t.value === 'instanceof') ? 'instanceof' : t.value;
            const precedence = BINARY_PRECEDENCE[value];
            if (!precedence || precedence < minPrecedence) break;

            this.next();
            const right = this.parseBinary(precedence + 1);
            left = { kind: 'binary', op: value, left, right, start: left.start };
        }

        return left;
    }

    parseUnary() {
        return this.guarded(() => {
            const t = this.peek();
            if (t && (t.value === '!' || t.value === '~' || t.value === '+' || t.value === '-'
                || t.value === '++' || t.value === '--')) {
                this.next();
                return { kind: 'unary', op: t.value, expr: this.parseUnary(), start: t.start };
            }

            const cast = this.tryCast();
            if (cast) return cast;

            return this.parsePostfix();
        });
    }

    /** Backtracking cast: `(Type) expr`. Returns null when it is not a cast. */
    tryCast() {
        if (!this.at('(')) return null;
        const save = this.i;
        const open = this.peek();

        try {
            this.next();
            this.parseType();
            if (!this.at(')')) throw FAIL;
            this.next();
            const expr = this.parseUnary();
            return { kind: 'cast', expr, start: open.start };
        } catch {
            this.i = save;
            return null;
        }
    }

    parsePostfix() {
        let node = this.parsePrimary();

        for (;;) {
            if (this.at('.')) {
                this.next();
                if (this.at('<')) this.skipTypeArgs(); // explicit type arguments

                const nameToken = this.peek();
                if (!nameToken || nameToken.type !== 'ident') throw FAIL;
                this.next();

                if (this.at('(')) {
                    node = {
                        kind: 'methodCall', scope: node, name: nameToken.value,
                        args: this.parseArguments(), start: node.start,
                    };
                } else {
                    node = { kind: 'fieldAccess', scope: node, name: nameToken.value, start: node.start };
                }
                continue;
            }

            if (this.at('(')) {
                // A call with no receiver: `foo(...)` or the JasperReports
                // function form `EQUALS(a, b)`. Keep the name so the null-check
                // recogniser can see it.
                const args = this.parseArguments();
                node = node.kind === 'name'
                    ? { kind: 'methodCall', scope: null, name: node.name, args, start: node.start }
                    : { kind: 'other', children: [node, ...args], start: node.start };
                continue;
            }

            if (this.at('[')) {
                this.next();
                this.parseAssignment();
                this.expect(']');
                node = { kind: 'other', children: [node], start: node.start };
                continue;
            }

            if (this.at('::')) {
                this.next();
                if (this.at('<')) this.skipTypeArgs();
                const nameToken = this.peek();
                if (nameToken && nameToken.type === 'ident') this.next();
                node = { kind: 'other', children: [node], start: node.start };
                continue;
            }

            if (this.at('++') || this.at('--')) {
                this.next();
                node = { kind: 'unary', op: 'post', expr: node, start: node.start };
                continue;
            }

            break;
        }

        return node;
    }

    parseArguments() {
        this.expect('(');
        const args = [];
        if (this.eat(')')) return args;

        for (;;) {
            args.push(this.parseAssignment());
            if (this.eat(',')) continue;
            this.expect(')');
            return args;
        }
    }

    parsePrimary() {
        const t = this.peek();
        if (!t) throw FAIL;

        if (t.type === 'number' || t.type === 'string' || t.type === 'char' || t.type === 'textblock') {
            this.next();
            return { kind: 'literal', start: t.start };
        }

        if (t.type === 'ident') {
            if (t.value === 'null') { this.next(); return { kind: 'null', start: t.start }; }
            if (t.value === 'true' || t.value === 'false') { this.next(); return { kind: 'literal', start: t.start }; }
            if (t.value === 'new') return this.parseNew();
            if (t.value === 'this' || t.value === 'super') { this.next(); return { kind: 'other', children: [], start: t.start }; }

            this.next();
            return { kind: 'name', name: t.value, start: t.start };
        }

        if (t.value === '(') {
            const open = t;
            this.next();
            const inner = this.parseAssignment();
            this.expect(')');
            return { kind: 'enclosed', expr: inner, start: open.start };
        }

        if (t.value === '{') {
            const open = t;
            this.next();
            const children = [];
            if (!this.eat('}')) {
                for (;;) {
                    children.push(this.parseAssignment());
                    if (this.eat(',')) { if (this.at('}')) { this.next(); break; } continue; }
                    this.expect('}');
                    break;
                }
            }
            return { kind: 'other', children, start: open.start };
        }

        throw FAIL;
    }

    parseNew() {
        const start = this.next().start; // 'new'
        if (this.at('<')) this.skipTypeArgs();
        this.parseType();

        const children = [];
        if (this.at('(')) children.push(...this.parseArguments());

        if (this.at('{')) {
            const init = this.parsePrimary();
            children.push(init);
            return { kind: 'other', children, start };
        }
        while (this.at('[')) {
            this.next();
            if (!this.at(']')) children.push(this.parseAssignment());
            this.expect(']');
        }
        return { kind: 'other', children, start };
    }

    parseType() {
        const t = this.peek();
        if (!t || t.type !== 'ident') throw FAIL;
        this.next();

        for (;;) {
            if (this.at('.')) {
                this.next();
                const nameToken = this.peek();
                if (!nameToken || nameToken.type !== 'ident') throw FAIL;
                this.next();
                continue;
            }
            if (this.at('<')) { this.skipTypeArgs(); continue; }
            break;
        }

        while (this.at('[') && this.peek(1) && this.peek(1).value === ']') {
            this.next();
            this.next();
        }
    }

    /**
     * Skip a balanced generic type-argument list. `>>` / `>>>` close more than
     * one level, which is why the depth is decremented by their length.
     */
    skipTypeArgs() {
        if (!this.at('<')) return;
        this.next();

        let depth = 1;
        while (depth > 0) {
            const t = this.next();
            if (t.value === '<') depth++;
            else if (t.value === '>') depth--;
            else if (t.value === '>>') depth -= 2;
            else if (t.value === '>>>') depth -= 3;
        }
    }
}

/**
 * Parse a Java expression. Returns an AST node, or null when the text is not a
 * single well-formed expression in the supported subset.
 */
function parseExpression(code) {
    if (code === null || code === undefined) return null;

    let tokens;
    try {
        tokens = tokenize(code);
    } catch {
        return null;
    }
    if (tokens.length === 0) return null;

    const parser = new Parser(tokens);
    try {
        const node = parser.parseExpression();
        if (parser.i !== tokens.length) return null; // trailing tokens
        return node;
    } catch {
        return null;
    }
}

/** Expression children of a node, for generic recursion. */
function childExpressions(node) {
    switch (node.kind) {
        case 'binary':      return [node.left, node.right];
        case 'unary':       return [node.expr];
        case 'conditional': return [node.cond, node.then, node.els];
        case 'fieldAccess': return [node.scope];
        case 'methodCall':  return [...(node.scope ? [node.scope] : []), ...node.args];
        case 'cast':        return [node.expr];
        case 'enclosed':    return [node.expr];
        case 'other':       return node.children || [];
        default:            return [];
    }
}

module.exports = { parseExpression, childExpressions, tokenize };
