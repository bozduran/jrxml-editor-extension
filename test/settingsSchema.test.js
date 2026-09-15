// test/settingsSchema.test.js
// The panel schema must never drift from package.json.

const test   = require('node:test');
const assert = require('node:assert');

const pkg = require('../package.json');
const {
    SECTION,
    SETTINGS_GROUPS,
    allSettings,
    defaults,
} = require('../settingsSchema');

test('every panel setting is declared in package.json with the same type and default', () => {
    const properties = pkg.contributes.configuration.properties;

    for (const setting of allSettings()) {
        const key = `${SECTION}.${setting.key}`;
        const declared = properties[key];

        assert.ok(declared, `missing ${key} in package.json`);
        assert.strictEqual(declared.type, setting.type, `${key} type`);
        assert.deepStrictEqual(declared.default, setting.default, `${key} default`);
    }
});

test('every declared jrxml setting is present in the panel', () => {
    const panelKeys = new Set(allSettings().map(setting => `${SECTION}.${setting.key}`));
    const declared  = Object.keys(pkg.contributes.configuration.properties);

    for (const key of declared) {
        assert.ok(panelKeys.has(key), `${key} is not in the settings panel`);
    }
});

test('panel keys are unique and defaults are complete', () => {
    const keys = allSettings().map(setting => setting.key);
    assert.strictEqual(new Set(keys).size, keys.length);

    const all = defaults();
    assert.deepStrictEqual(Object.keys(all).sort(), [...keys].sort());
});

test('groups have ids, titles and at least one setting', () => {
    for (const group of SETTINGS_GROUPS) {
        assert.ok(group.id, 'group id');
        assert.ok(group.title, `group ${group.id} title`);
        assert.ok(group.settings.length > 0, `group ${group.id} settings`);
    }
});

test('boolean and number settings have correctly typed defaults', () => {
    for (const setting of allSettings()) {
        if (setting.type === 'boolean') assert.strictEqual(typeof setting.default, 'boolean', setting.key);
        if (setting.type === 'number')  assert.strictEqual(typeof setting.default, 'number',  setting.key);
        if (setting.type === 'string')  assert.strictEqual(typeof setting.default, 'string',  setting.key);
        if (setting.type === 'array')   assert.ok(Array.isArray(setting.default),             setting.key);
    }
});
