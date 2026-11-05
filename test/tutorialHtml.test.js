// test/tutorialHtml.test.js
// Security, coverage and content checks for the built-in tutorial.
//
// The command/settings-group comparisons are deliberate: they make "add a
// feature, update the tutorial" fail loudly in CI instead of relying on memory.

const test   = require('node:test');
const assert = require('node:assert');

const pkg = require('../package.json');
const { SETTINGS_GROUPS } = require('../settingsSchema');
const { escapeHtmlText } = require('../expressionPanelHtml');
const {
    buildTutorialHtml,
    DOCUMENTED_COMMANDS,
    DOCUMENTED_SETTING_GROUPS,
    TUTORIAL_COMMAND_URIS,
} = require('../tutorialHtml');

const NONCE = '0123456789abcdef0123456789abcdef';

function build() {
    return buildTutorialHtml({ nonce: NONCE });
}

test('declares a nonce-based Content-Security-Policy and no scripts', () => {
    const html = build();

    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes(`style-src 'nonce-${NONCE}'`));
    assert.strictEqual((html.match(new RegExp(`nonce="${NONCE}"`, 'g')) || []).length, 1);
    assert.ok(!html.includes('<script'), 'the tutorial must stay script-free');
});

test('uses no remote resources, inline handlers or style attributes', () => {
    const html = build();

    assert.ok(!/https?:\/\//.test(html), 'no remote URLs');
    assert.ok(!/\son(click|change|input|load|error)\s*=/.test(html), 'no inline handlers');
    assert.ok(!/\sstyle\s*=/.test(html), 'no inline style attributes');
    assert.ok(!html.includes('<iframe'), 'no embedded frames');
});

test('documents every contributed command', () => {
    const documented = DOCUMENTED_COMMANDS.map(item => item.id);
    const declared = pkg.contributes.commands.map(item => item.command);

    assert.strictEqual(new Set(documented).size, documented.length, 'commands must be listed once');
    assert.deepStrictEqual(
        [...documented].sort(),
        [...declared].sort(),
        'add new commands to DOCUMENTED_COMMANDS in tutorialHtml.js'
    );

    const html = build();
    for (const command of pkg.contributes.commands) {
        assert.ok(html.includes(command.command), `missing command ${command.command}`);
        assert.ok(html.includes(escapeHtmlText(command.title)), `missing command title ${command.title}`);
    }
});

test('documents every settings group', () => {
    const documented = DOCUMENTED_SETTING_GROUPS.map(item => item.id);
    const declared = SETTINGS_GROUPS.map(group => group.id);

    assert.strictEqual(new Set(documented).size, documented.length, 'groups must be listed once');
    assert.deepStrictEqual(
        [...documented].sort(),
        [...declared].sort(),
        'add new settings groups to DOCUMENTED_SETTING_GROUPS in tutorialHtml.js'
    );

    const html = build();
    for (const group of SETTINGS_GROUPS) {
        assert.ok(html.includes(escapeHtmlText(group.title)), `missing settings group ${group.title}`);
        for (const setting of group.settings) {
            assert.ok(html.includes(`jrxml.${setting.key}`), `missing setting jrxml.${setting.key}`);
        }
    }
});

test('walks through the main surfaces', () => {
    const html = build();

    for (const id of [
        'quick-start', 'editor', 'expression-editor', 'if-else', 'design-view',
        'issues', 'formatting', 'best-practices', 'cleanup', 'include-chain',
        'settings', 'commands', 'shortcuts', 'limits', 'maintain',
    ]) {
        assert.ok(html.includes(`id="${id}"`), `missing section #${id}`);
    }

    assert.ok(html.includes('Expression'), 'expression results must be explained');
    assert.ok(html.includes('inserted verbatim'));
    assert.ok(html.includes('Ctrl+Alt+E'), 'shortcuts must be rendered readably');
    assert.ok(html.includes('Ctrl+Alt+Down'));
    assert.ok(html.includes('Cmd+Alt+E'), 'macOS shortcuts must be shown');
    assert.ok(html.includes(`v${pkg.version}`), 'the version must be shown');
});

test('every command link is allowlisted by the host panel', () => {
    const html = build();
    const links = [...html.matchAll(/href="command:([^"]+)"/g)].map(match => match[1]);

    assert.ok(links.length > 0, 'the tutorial should link to commands');
    for (const link of links) {
        assert.ok(
            TUTORIAL_COMMAND_URIS.includes(link),
            `${link} is linked but not in TUTORIAL_COMMAND_URIS (the webview would ignore it)`
        );
    }
    for (const allowed of TUTORIAL_COMMAND_URIS) {
        assert.ok(links.includes(allowed), `${allowed} is allowlisted but never linked`);
    }
});

test('explains how the guide is kept current', () => {
    const html = build();

    assert.ok(html.includes('test/tutorialHtml.test.js'));
    assert.ok(html.includes('.github/pull_request_template.md'));
    assert.ok(html.includes('DOCUMENTED_COMMANDS'));
    assert.ok(html.includes('DOCUMENTED_SETTING_GROUPS'));
});
