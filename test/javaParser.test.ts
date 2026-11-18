// test/javaParser.test.js

import test from 'node:test';
import assert from 'node:assert';

import { parseExpression, childExpressions } from '../out/javaParser.js';
import type { BinaryNode, ConditionalNode, JavaExpressionNode, MethodCallNode } from '../out/javaParser.js';

/** Parse an expression the test expects to be well formed. */
function parse(code: string): JavaExpressionNode {
    const node = parseExpression(code);
    assert.ok(node, `expected ${code} to parse`);
    return node;
}

/** Parse a binary expression, narrowed to its node type. */
function parseBinary(code: string): BinaryNode {
    const node = parse(code);
    assert.ok(node.kind === 'binary', `expected ${code} to be binary`);
    return node;
}

/** Parse a conditional expression, narrowed to its node type. */
function parseConditional(code: string): ConditionalNode {
    const node = parse(code);
    assert.ok(node.kind === 'conditional', `expected ${code} to be conditional`);
    return node;
}

/** Parse a method call, narrowed to its node type. */
function parseMethodCall(code: string): MethodCallNode {
    const node = parse(code);
    assert.ok(node.kind === 'methodCall', `expected ${code} to be a method call`);
    return node;
}

test('parses names, literals and null', () => {
    assert.strictEqual(parse('a').kind, 'name');
    assert.strictEqual(parse('1').kind, 'literal');
    assert.strictEqual(parse('"s"').kind, 'literal');
    assert.strictEqual(parse("'c'").kind, 'literal');
    assert.strictEqual(parse('"""t"""').kind, 'literal');
    assert.strictEqual(parse('null').kind, 'null');
    assert.strictEqual(parse('true').kind, 'literal');
});

test('parses binary operators with precedence', () => {
    const or = parseBinary('a || b');
    assert.strictEqual(or.kind, 'binary');
    assert.strictEqual(or.op, '||');
    assert.strictEqual(or.left.kind, 'name');
    assert.strictEqual(or.right.kind, 'name');

    const mixed = parseBinary('a + b * c');
    assert.strictEqual(mixed.op, '+', '* binds tighter so + is the root');
    assert.ok(mixed.right.kind === 'binary', '* call must be binary');
    assert.strictEqual(mixed.right.op, '*');
});

test('parses instanceof as a binary operator', () => {
    const node = parseBinary('a instanceof String');
    assert.strictEqual(node.kind, 'binary');
    assert.strictEqual(node.op, 'instanceof');
});

test('parses ternaries, right-associatively', () => {
    const node = parseConditional('a ? b : c ? d : e');
    assert.strictEqual(node.kind, 'conditional');
    assert.strictEqual(node.els.kind, 'conditional');
});

test('parses method calls with and without a receiver', () => {
    const withScope = parseMethodCall('a.b(x)');
    assert.strictEqual(withScope.kind, 'methodCall');
    assert.strictEqual(withScope.name, 'b');
    assert.ok(withScope.scope, 'a.b(x) must have a receiver');
    assert.strictEqual(withScope.scope.kind, 'name');
    assert.strictEqual(withScope.args.length, 1);

    const plain = parseMethodCall('foo(x)');
    assert.strictEqual(plain.kind, 'methodCall');
    assert.strictEqual(plain.name, 'foo');
    assert.strictEqual(plain.scope, null);

    const chained = parseMethodCall('a.b().c()');
    assert.strictEqual(chained.kind, 'methodCall');
    assert.strictEqual(chained.name, 'c');
    assert.ok(chained.scope, 'a.b().c() must have a receiver');
    assert.strictEqual(chained.scope.kind, 'methodCall');
    assert.strictEqual(chained.scope.name, 'b');
});

test('parses casts, enclosing parentheses and postfix operators', () => {
    assert.strictEqual(parse('(Foo) x').kind, 'cast');
    assert.strictEqual(parse('(java.lang.String) x').kind, 'cast');
    assert.strictEqual(parse('(a + b)').kind, 'enclosed');
    assert.strictEqual(parse('a++').kind, 'unary');
    assert.strictEqual(parse('a[0]').kind, 'other');
    assert.strictEqual(parse('Type::method').kind, 'other');
});

test('parses generics, new and arrays', () => {
    assert.ok(parseExpression('new HashMap<>()'));
    assert.ok(parseExpression('new HashMap<String, List<Integer>>()'));
    assert.ok(parseExpression('new String[3]'));
    assert.ok(parseExpression('new int[]{1, 2}'));
    assert.strictEqual(parseMethodCall('foo.<String>bar()').name, 'bar');
});

test('returns null for input that is not a single expression', () => {
    assert.strictEqual(parseExpression(''), null);
    assert.strictEqual(parseExpression('a b'), null);
    assert.strictEqual(parseExpression('(a'), null);
    assert.strictEqual(parseExpression('a ? b'), null);
    assert.strictEqual(parseExpression('1 +'), null);
    assert.strictEqual(parseExpression('$P!{x}.foo()'), null);
});

test('childExpressions exposes the recursive children', () => {
    assert.strictEqual(childExpressions(parse('a + b')).length, 2);
    assert.strictEqual(childExpressions(parse('!a')).length, 1);
    assert.strictEqual(childExpressions(parse('a ? b : c')).length, 3);
    assert.strictEqual(childExpressions(parse('a.b')).length, 1);
    assert.strictEqual(childExpressions(parse('a.b(c)')).length, 2);
    assert.strictEqual(childExpressions(parse('(Foo) a')).length, 1);
    assert.strictEqual(childExpressions(parse('a')).length, 0);
});
