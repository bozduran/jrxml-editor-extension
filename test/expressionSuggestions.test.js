// test/expressionSuggestions.test.js
// Pure tests for the suggestion engine shared by the JRXML editor and the
// design-view inspector.

const test   = require('node:test');
const assert = require('node:assert');

const {
    buildExpressionSuggestions,
    suggestionOptions,
    plainFromSnippet,
} = require('../expressionSuggestions');

const DECLARATIONS = {
    allFields: [
        { name: 'CustomerName', type: 'String', fullType: 'java.lang.String', description: '' },
        { name: 'Unset', type: 'Object', fullType: 'java.lang.Object', description: '', typeSource: 'inferred' },
    ],
    allParameters: [
        { name: 'Total', type: 'BigDecimal', fullType: 'java.math.BigDecimal', description: '' },
    ],
    allVariables: [
        { name: 'Count', type: 'Integer', fullType: 'java.lang.Integer', description: '' },
    ],
};

function suggest(text, offset, overrides = {}) {
    return buildExpressionSuggestions({
        text,
        offset,
        declarations: DECLARATIONS,
        options: { typedCompletion: true, jdkBaseline: 8 },
        customMethods: [],
        ...overrides,
    });
}

function labels(items) {
    return items.map(item => item.label);
}

test('offers fields inside $F{ with the partial-name replacement range', () => {
    const result = suggest('$F{Cus', 6);

    assert.strictEqual(result.mode, 'field');
    assert.strictEqual(result.prefix, 'Cus');
    assert.deepStrictEqual(result.replace, { start: 3, end: 6 });
    assert.deepStrictEqual(labels(result.items), ['CustomerName', 'Unset']);
    assert.strictEqual(result.items[0].insertTextPlain, 'CustomerName}');
    assert.deepStrictEqual(result.items[0].placeholder, { start: 12, end: 12 });

    const closed = suggest('$F{Cus}', 6);
    assert.strictEqual(closed.items[0].insertTextPlain, 'CustomerName');
});

test('offers parameters and variables, including built-ins', () => {
    const params = suggest('$P{', 3);
    assert.strictEqual(params.mode, 'param');
    assert.ok(labels(params.items).includes('Total'));
    assert.ok(labels(params.items).includes('REPORT_CONNECTION'));

    const vars = suggest('$V{', 3);
    assert.strictEqual(vars.mode, 'variable');
    assert.ok(labels(vars.items).includes('Count'));
    assert.ok(labels(vars.items).includes('PAGE_NUMBER'));
});

test('offers resource keys inside $R{ when a bundle is indexed', () => {
    const resources = [
        { key: 'title', defaultValue: 'Welcome' },
        { key: 'body', defaultValue: 'Body text' },
    ];
    const result = suggest('$R{ti', 5, { resources });

    assert.strictEqual(result.mode, 'resource');
    assert.strictEqual(result.prefix, 'ti');
    assert.deepStrictEqual(result.replace, { start: 3, end: 5 });
    assert.deepStrictEqual(labels(result.items), ['title', 'body']);
    assert.strictEqual(result.items[0].insertTextPlain, 'title}');
    assert.strictEqual(result.items[0].detail, 'Welcome');

    const closed = suggest('$R{ti}', 5, { resources });
    assert.strictEqual(closed.items[0].insertTextPlain, 'title');
});

test('offers parameters inside $P!{} query fragments', () => {
    const result = suggest('$P!{', 4);

    assert.strictEqual(result.mode, 'param');
    assert.ok(labels(result.items).includes('Total'));
    assert.ok(result.items[0].insertTextPlain.endsWith('}'));
});

test('offers SQL clause names inside $X{', () => {
    const result = suggest('$X{', 4);

    assert.strictEqual(result.mode, 'clause');
    assert.ok(labels(result.items).includes('IN'));
    assert.strictEqual(result.items[0].insertTextPlain, 'IN}');
});

test('falls back to the general list when no resource bundle is indexed', () => {
    const result = suggest('$R{', 3);

    assert.strictEqual(result.mode, 'general');
    assert.ok(labels(result.items).includes('TODAY'));
});

test('offers the dollar shortcuts and replaces the typed dollar', () => {
    const result = suggest('$', 1);

    assert.strictEqual(result.mode, 'dollar');
    assert.deepStrictEqual(result.replace, { start: 0, end: 1 });
    assert.deepStrictEqual(labels(result.items), ['$F{', '$P{', '$V{', '$R{', '$X{']);
    assert.strictEqual(result.items[0].insertTextPlain, '$F{}');
    assert.ok(result.items[0].placeholder);
    assert.strictEqual(result.items[0].placeholder.start, 3);
});

test('offers the full general list with fields, functions and Java statics', () => {
    const result = suggest('', 0);
    const all = labels(result.items);

    assert.strictEqual(result.mode, 'general');
    assert.ok(all.includes('$F{CustomerName}'));
    assert.ok(all.includes('$P{Total}'));
    assert.ok(all.includes('$V{Count}'));
    assert.ok(all.includes('TODAY'));
    assert.ok(all.includes('IF'));
    assert.ok(all.includes('String'));
    assert.ok(all.includes('Math.round'));
    assert.strictEqual(
        result.items.find(item => item.label === '$F{CustomerName}').insertTextPlain,
        '$F{CustomerName}'
    );
});

test('reads the shared completion options from configuration', () => {
    const requested = [];
    const config = {
        get(key, fallback) {
            requested.push(key);
            if (key === 'typeCompletion.enabled') return false;
            if (key === 'typeCompletion.jdkBaseline') return '17';
            return fallback;
        },
    };

    assert.deepStrictEqual(suggestionOptions(config), {
        typedCompletion: false,
        jdkBaseline: '17',
    });
    assert.deepStrictEqual(requested, [
        'typeCompletion.enabled',
        'typeCompletion.jdkBaseline',
    ]);
});

test('keeps the suggestion counts and plain insertion for each category', () => {
    const result = suggest('', 0, {
        customMethods: [
            { label: 'Util.trim', detail: 'Util.trim(String value) : String', doc: '**Class:** `Util`', snippet: 'Util.trim(${1:value})' },
            { label: 'Util.isEmpty', detail: 'Util.isEmpty(String value) : boolean', doc: '**Class:** `Util`', snippet: 'Util.isEmpty(${1:value})' },
        ],
    });

    assert.strictEqual(result.items.filter(item => item.kind === 'function').length, 66);
    assert.strictEqual(result.items.filter(item => item.kind === 'class').length, 22);
    assert.strictEqual(result.items.filter(item => item.kind === 'method').length, 2);

    for (const [label, plain] of [
        ['IF', 'IF(condition, trueVal, falseVal)'],
        ['String', 'String'],
        ['Util.trim', 'Util.trim(value)'],
    ]) {
        const item = result.items.find(candidate => candidate.label === label);
        assert.ok(item, `missing ${label}`);
        assert.strictEqual(item.insertTextPlain, plain, label);
    }
});

test('offers typed members after a declared receiver', () => {
    const expression = '$F{CustomerName}.sub';
    const result = suggest(expression, expression.length);

    assert.strictEqual(result.mode, 'member');
    assert.strictEqual(result.prefix, 'sub');
    assert.deepStrictEqual(result.replace, {
        start: expression.length - 3,
        end: expression.length,
    });
    const substring = result.items.find(item => item.filterText === 'substring' || item.label === 'substring');
    assert.ok(substring, 'expected substring');
    assert.ok(result.items.every(item => item.kind === 'method' || item.kind === 'field'));
});

test('offers the type hint when the receiver cannot be typed', () => {
    const expression = '$F{Unset}.';
    const result = suggest(expression, expression.length);

    assert.strictEqual(result.mode, 'member');
    assert.strictEqual(result.items.length, 1);
    assert.match(result.items[0].label, /is not declared/);
    assert.strictEqual(result.items[0].insertTextPlain, '');
    assert.strictEqual(result.items[0].kind, 'text');
});

test('falls back to the general list for decimal points and disabled typed completion', () => {
    const decimal = suggest('1.5', 3);
    assert.strictEqual(decimal.mode, 'general');
    assert.ok(labels(decimal.items).includes('TODAY'));

    const disabled = suggest('$F{CustomerName}.', '$F{CustomerName}.'.length, {
        options: { typedCompletion: false, jdkBaseline: 8 },
    });
    assert.strictEqual(disabled.mode, 'general');
    assert.ok(labels(disabled.items).includes('TODAY'));
});

test('includes local custom static methods', () => {
    const result = suggest('', 0, {
        customMethods: [{
            label: 'Util.trim',
            detail: 'Util.trim(String value) : String',
            doc: '**Class:** `com.acme.Util`',
            snippet: 'Util.trim(${1:value})',
        }],
    });

    const method = result.items.find(item => item.label === 'Util.trim');
    assert.ok(method);
    assert.strictEqual(method.insertTextPlain, 'Util.trim(value)');
    assert.deepStrictEqual(method.placeholder, { start: 10, end: 15 });
});

test('converts snippets to plain text and exposes the first placeholder', () => {
    assert.deepStrictEqual(plainFromSnippet('IF(${1:condition}, ${2:trueVal})'), {
        text: 'IF(condition, trueVal)',
        placeholder: { start: 3, end: 12 },
    });
    assert.deepStrictEqual(plainFromSnippet('\\$F{Name}'), {
        text: '$F{Name}',
        placeholder: null,
    });
    assert.deepStrictEqual(plainFromSnippet('$0'), {
        text: '',
        placeholder: { start: 0, end: 0 },
    });

    const ifItem = suggest('', 0).items.find(item => item.label === 'IF');
    assert.strictEqual(ifItem.insertTextPlain, 'IF(condition, trueVal, falseVal)');
    assert.deepStrictEqual(ifItem.placeholder, { start: 3, end: 12 });
});
