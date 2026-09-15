// test/jasperBuiltins.test.js

const test   = require('node:test');
const assert = require('node:assert');

const {
    BUILTIN_VARIABLES,
    BUILTIN_PARAMETERS,
    BUILTIN_VARIABLE_NAMES,
    BUILTIN_PARAMETER_NAMES,
} = require('../jasperBuiltins');

test('builtin lists have unique names', () => {
    for (const [label, list] of [['variables', BUILTIN_VARIABLES], ['parameters', BUILTIN_PARAMETERS]]) {
        const names = list.map(x => x.name);
        assert.strictEqual(new Set(names).size, names.length, `duplicate name in ${label}`);
    }
});

test('every builtin has a name, type and description', () => {
    for (const entry of [...BUILTIN_VARIABLES, ...BUILTIN_PARAMETERS]) {
        assert.ok(entry.name, 'name required');
        assert.ok(entry.type, `type required for ${entry.name}`);
        assert.ok(entry.description, `description required for ${entry.name}`);
    }
});

test('name sets match the arrays', () => {
    assert.deepStrictEqual([...BUILTIN_VARIABLE_NAMES].sort(), BUILTIN_VARIABLES.map(v => v.name).sort());
    assert.deepStrictEqual([...BUILTIN_PARAMETER_NAMES].sort(), BUILTIN_PARAMETERS.map(p => p.name).sort());
});

test('includes entries that the old drifted hover tables were missing', () => {
    // These were present in diagnostics/completion but absent from hover.
    assert.ok(BUILTIN_VARIABLE_NAMES.has('PAGE_VARIABLE_COUNT'));
    assert.ok(BUILTIN_PARAMETER_NAMES.has('REPORT_TEMPLATES'));
    assert.ok(BUILTIN_PARAMETER_NAMES.has('REPORT_URL_HANDLER_FACTORY'));
});
