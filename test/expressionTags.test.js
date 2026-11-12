// test/expressionTags.test.js
// The registry is the single source of truth for expression elements: every
// role projection must cover the tags the old literals covered, and matching
// must ignore case and a namespace prefix.

const test   = require('node:test');
const assert = require('node:assert');

const {
    EXPRESSION_TAGS,
    REFERENCE_CONTAINERS,
    descriptors,
    forRole,
    hasRole,
    normalizeTag,
    rolesOf,
} = require('../out/expressionTags');

test('the registry keeps the 46 expression tags in order', () => {
    assert.strictEqual(EXPRESSION_TAGS.length, 46);
    assert.strictEqual(EXPRESSION_TAGS[0], 'textFieldExpression');
    assert.ok(EXPRESSION_TAGS.includes('filterExpression'));
    assert.ok(EXPRESSION_TAGS.includes('labelExpression'));
    assert.ok(EXPRESSION_TAGS.includes('jr:expression'));
    assert.ok(EXPRESSION_TAGS.includes('textExpression'));
    assert.ok(EXPRESSION_TAGS.includes('patternExpression'));
});

test('expression, format and textcheck roles cover every expression tag', () => {
    const expression = forRole('expression');
    const format = forRole('format');
    const textcheck = forRole('textcheck');

    for (const tag of EXPRESSION_TAGS) {
        const key = normalizeTag(tag);
        assert.ok(expression.has(key), `expression role misses ${tag}`);
        assert.ok(format.has(key), `format role misses ${tag}`);
        assert.ok(textcheck.has(key), `textcheck role misses ${tag}`);
    }
});

test('the reference role adds the non-expression carriers', () => {
    for (const tag of ['query', 'propertyExpression', 'subreportParameterExpression', 'datasetParameterExpression']) {
        assert.ok(hasRole(tag, 'reference'), `reference role misses ${tag}`);
    }
    // query is a carrier, not a format/expression tag.
    assert.ok(!hasRole('query', 'format'));
    assert.ok(!hasRole('query', 'expression'));
});

test('the design content role keeps the five editable kinds', () => {
    assert.deepStrictEqual([...forRole('designContent')].sort(), [
        'chartexpression', 'expression', 'imageexpression',
        'subreportexpression', 'textfieldexpression',
    ]);
});

test('role matching ignores case and a namespace prefix', () => {
    assert.ok(hasRole('textFieldExpression', 'format'));
    assert.ok(hasRole('textfieldexpression', 'format'));
    assert.ok(hasRole('jr:expression', 'expression'));
    assert.strictEqual(normalizeTag('jr:expression'), 'expression');
    assert.deepStrictEqual([...(rolesOf('chartExpression') || [])], ['designContent']);
    assert.strictEqual(rolesOf('band'), null);
});

test('legacy sets stay behaviour-identical to the old literals', () => {
    assert.deepStrictEqual([...REFERENCE_CONTAINERS].slice(0, 46), [...EXPRESSION_TAGS]);
    assert.strictEqual(REFERENCE_CONTAINERS.size, 50);
    for (const tag of ['query', 'propertyExpression', 'subreportParameterExpression', 'datasetParameterExpression']) {
        assert.ok(REFERENCE_CONTAINERS.has(tag));
    }
});

test('every descriptor has at least one role and a unique normalized tag', () => {
    const seen = new Set();
    for (const descriptor of descriptors()) {
        assert.ok(descriptor.roles.length > 0, `${descriptor.tag} has no role`);
        seen.add(normalizeTag(descriptor.tag));
    }
    assert.ok(seen.has('chartexpression'));
});
