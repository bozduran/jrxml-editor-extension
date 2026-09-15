// test/javaExpr.test.js
// Expression spacing formatter, including the hook's own output as ground truth.

const test   = require('node:test');
const assert = require('node:assert');

const { formatExpression, literalEnd, maskLiteralsAndRefs } = require('../javaExpr');

test('spaces binary, ternary and comma exactly like the hook', () => {
    // Recorded from `java -jar bin/myhooks.jar format` on a sample report.
    assert.strictEqual(
        formatExpression('$F{a}==null?1:($F{b}+2)'),
        '$F{a} == null ? 1 : ($F{b}+2)'
    );
    assert.strictEqual(
        formatExpression('$F{a}==null?"-":String.valueOf($F{b})+","'),
        '$F{a} == null ? "-" : String.valueOf($F{b})+","'
    );
});

test('does not space operators the hook leaves alone', () => {
    for (const expr of ['1+2', 'a-b', 'a*b', 'a/b', 'a%b', 'a<<b', 'a>>b']) {
        assert.strictEqual(formatExpression(expr), expr, expr);
    }
});

test('spaces comparisons', () => {
    assert.strictEqual(formatExpression('a<b'), 'a < b');
    assert.strictEqual(formatExpression('a>=b'), 'a >= b');
    assert.strictEqual(formatExpression('x>y>=z'), 'x > y >= z');
});

test('leaves generic type arguments alone', () => {
    for (const expr of [
        'List<String> x',
        'Map<String,List<Integer>> m',
        'new HashMap<>()',
        'new ArrayList<String>()',
        'Map<? extends Foo, ? super Bar> m',
    ]) {
        const out = formatExpression(expr);
        // Only the comma rule may apply; angle brackets must keep their spacing.
        assert.ok(!out.includes(' < '), `unexpected '<' spacing in ${out}`);
        assert.ok(!out.includes(' > '), `unexpected '>' spacing in ${out}`);
    }
});

test('spaces a cast to an uppercase reference type only', () => {
    assert.strictEqual(formatExpression('(String)x'), '(String) x');
    assert.strictEqual(formatExpression('(Foo.Bar)x'), '(Foo.Bar) x');
    assert.strictEqual(formatExpression('(int)x'), '(int)x');
    assert.strictEqual(formatExpression('(java.lang.String)x'), '(java.lang.String)x');
});

test('does not mistake a parenthesised name for a cast', () => {
    assert.strictEqual(formatExpression('(Foo).bar()'), '(Foo).bar()');
    assert.strictEqual(formatExpression('(Foo)[0]'), '(Foo)[0]');
});

test('never rewrites string, char or text-block literals', () => {
    assert.strictEqual(formatExpression('"a==b"'), '"a==b"');
    assert.strictEqual(formatExpression("'='"), "'='");
    assert.strictEqual(formatExpression('"""a==b"""'), '"""a==b"""');
    assert.strictEqual(formatExpression('"x"+"a==b"'), '"x"+"a==b"');
});

test('never rewrites JasperReports references', () => {
    assert.strictEqual(formatExpression('$F{a}'), '$F{a}');
    assert.strictEqual(formatExpression('$P!{x}==null'), '$P!{x} == null');
});

test('preserves spans that contain comments', () => {
    assert.strictEqual(formatExpression('a /* c */ == b'), 'a /* c */ == b');
});

test('returns the input unchanged when it does not look like Java', () => {
    assert.strictEqual(formatExpression('(a == b'), '(a == b');       // unbalanced
    assert.strictEqual(formatExpression('"unterminated == b'), '"unterminated == b');
    assert.strictEqual(formatExpression(''), '');
    assert.strictEqual(formatExpression('   '), '   ');
});

test('is idempotent', () => {
    const exprs = [
        '$F{a}==null?1:($F{b}+2)',
        'a<b&&c>d',
        '(String)x',
        'f(a,b)',
    ];
    for (const expr of exprs) {
        const once = formatExpression(expr);
        assert.strictEqual(formatExpression(once), once, expr);
    }
});

test('literalEnd locates strings, chars and text blocks', () => {
    assert.strictEqual(literalEnd('"ab" + x', 0), 4);
    assert.strictEqual(literalEnd("'a' + x", 0), 3);
    assert.strictEqual(literalEnd('"""ab"""', 0), 8);
    assert.strictEqual(literalEnd('x', 0), -1);
});

test('masking replaces literals and references with identifiers', () => {
    const mask = maskLiteralsAndRefs('$F{a} + "x" + \'y\'');
    assert.strictEqual(mask.text, '__jrxml_0__ + __jrxml_1__ + __jrxml_2__');
    assert.deepStrictEqual(mask.replacements, ['$F{a}', '"x"', "'y'"]);
    assert.strictEqual(mask.terminated, true);
});
