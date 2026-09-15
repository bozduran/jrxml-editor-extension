// test/javaParser.test.js

const test   = require('node:test');
const assert = require('node:assert');

const { parseExpression, childExpressions } = require('../javaParser');

test('parses names, literals and null', () => {
    assert.strictEqual(parseExpression('a').kind, 'name');
    assert.strictEqual(parseExpression('1').kind, 'literal');
    assert.strictEqual(parseExpression('"s"').kind, 'literal');
    assert.strictEqual(parseExpression("'c'").kind, 'literal');
    assert.strictEqual(parseExpression('"""t"""').kind, 'literal');
    assert.strictEqual(parseExpression('null').kind, 'null');
    assert.strictEqual(parseExpression('true').kind, 'literal');
});

test('parses binary operators with precedence', () => {
    const or = parseExpression('a || b');
    assert.strictEqual(or.kind, 'binary');
    assert.strictEqual(or.op, '||');
    assert.strictEqual(or.left.kind, 'name');
    assert.strictEqual(or.right.kind, 'name');

    const mixed = parseExpression('a + b * c');
    assert.strictEqual(mixed.op, '+', '* binds tighter so + is the root');
    assert.strictEqual(mixed.right.op, '*');
});

test('parses instanceof as a binary operator', () => {
    const node = parseExpression('a instanceof String');
    assert.strictEqual(node.kind, 'binary');
    assert.strictEqual(node.op, 'instanceof');
});

test('parses ternaries, right-associatively', () => {
    const node = parseExpression('a ? b : c ? d : e');
    assert.strictEqual(node.kind, 'conditional');
    assert.strictEqual(node.els.kind, 'conditional');
});

test('parses method calls with and without a receiver', () => {
    const withScope = parseExpression('a.b(x)');
    assert.strictEqual(withScope.kind, 'methodCall');
    assert.strictEqual(withScope.name, 'b');
    assert.strictEqual(withScope.scope.kind, 'name');
    assert.strictEqual(withScope.args.length, 1);

    const plain = parseExpression('foo(x)');
    assert.strictEqual(plain.kind, 'methodCall');
    assert.strictEqual(plain.name, 'foo');
    assert.strictEqual(plain.scope, null);

    const chained = parseExpression('a.b().c()');
    assert.strictEqual(chained.kind, 'methodCall');
    assert.strictEqual(chained.name, 'c');
    assert.strictEqual(chained.scope.kind, 'methodCall');
    assert.strictEqual(chained.scope.name, 'b');
});

test('parses casts, enclosing parentheses and postfix operators', () => {
    assert.strictEqual(parseExpression('(Foo) x').kind, 'cast');
    assert.strictEqual(parseExpression('(java.lang.String) x').kind, 'cast');
    assert.strictEqual(parseExpression('(a + b)').kind, 'enclosed');
    assert.strictEqual(parseExpression('a++').kind, 'unary');
    assert.strictEqual(parseExpression('a[0]').kind, 'other');
    assert.strictEqual(parseExpression('Type::method').kind, 'other');
});

test('parses generics, new and arrays', () => {
    assert.ok(parseExpression('new HashMap<>()'));
    assert.ok(parseExpression('new HashMap<String, List<Integer>>()'));
    assert.ok(parseExpression('new String[3]'));
    assert.ok(parseExpression('new int[]{1, 2}'));
    assert.strictEqual(parseExpression('foo.<String>bar()').name, 'bar');
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
    assert.strictEqual(childExpressions(parseExpression('a + b')).length, 2);
    assert.strictEqual(childExpressions(parseExpression('!a')).length, 1);
    assert.strictEqual(childExpressions(parseExpression('a ? b : c')).length, 3);
    assert.strictEqual(childExpressions(parseExpression('a.b')).length, 1);
    assert.strictEqual(childExpressions(parseExpression('a.b(c)')).length, 2);
    assert.strictEqual(childExpressions(parseExpression('(Foo) a')).length, 1);
    assert.strictEqual(childExpressions(parseExpression('a')).length, 0);
});
