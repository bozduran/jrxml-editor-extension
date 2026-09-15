// test/settingsPanelHtml.test.js
// Security and content checks for the settings panel document.

const test   = require('node:test');
const assert = require('node:assert');

const { buildSettingsHtml } = require('../settingsPanelHtml');
const { SETTINGS_GROUPS, defaults, allSettings } = require('../settingsSchema');

const NONCE = 'feedfacefeedfacefeedfacefeedface';

function build(overrides = {}) {
    return buildSettingsHtml({
        groups: SETTINGS_GROUPS,
        values: defaults(),
        nonce: NONCE,
        section: 'jrxml',
        ...overrides,
    });
}

test('declares a nonce-based Content-Security-Policy', () => {
    const html = build();
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes(`script-src 'nonce-${NONCE}'`));
    assert.ok(html.includes(`style-src 'nonce-${NONCE}'`));
});

test('applies the nonce to the style and script tags', () => {
    const html = build();
    assert.strictEqual((html.match(new RegExp(`nonce="${NONCE}"`, 'g')) || []).length, 2);
});

test('contains no inline event handlers or style attributes', () => {
    const html = build();
    assert.ok(!/\son(click|change|input|load|error)\s*=/.test(html));
    assert.ok(!/\sstyle\s*=/.test(html));
});

test('does not let </script> escape the data block', () => {
    const html = build({
        values: { 'migrate.targetLanguage': '</script><script>alert(1)</script>' },
    });

    assert.ok(!html.includes('</script><script>'));
    assert.ok(html.includes('\\u003c/script\\u003e'));
    assert.strictEqual((html.match(/<script/g) || []).length, 1);
    assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
});

test('embeds every setting key and the section name', () => {
    const html = build();
    for (const setting of allSettings()) {
        assert.ok(html.includes(`"${setting.key}"`), `missing key ${setting.key}`);
    }
    assert.ok(html.includes('jrxml.*'));
});

test('renders groups from the supplied schema', () => {
    const html = build({
        groups: [{ id: 'g', title: 'Only group', settings: [
            { key: 'x.y', type: 'boolean', default: true, label: 'X', description: 'd' },
        ] }],
    });
    assert.ok(html.includes('Only group'));
    assert.ok(html.includes('"x.y"'));
});
