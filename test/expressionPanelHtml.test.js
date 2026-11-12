// test/expressionPanelHtml.test.js
// Regression tests for the webview security hardening.

const test   = require('node:test');
const assert = require('node:assert');

const {
    buildPanelHtml,
    escapeHtmlText,
    jsonForInlineScript,
    getNonce,
} = require('../out/expressionPanelHtml');

const NONCE = 'deadbeefdeadbeefdeadbeefdeadbeef';

function build(overrides = {}) {
    return buildPanelHtml({
        tagName: 'textFieldExpression',
        rawExpression: '$F{a}',
        formattedExpression: '$F{a}',
        nonce: NONCE,
        cspSource: 'vscode-webview://test',
        ...overrides,
    });
}

test('declares a nonce-based Content-Security-Policy', () => {
    const html = build();
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.ok(html.includes(`script-src 'nonce-${NONCE}'`), 'script-src must be nonce-based');
    assert.ok(html.includes(`style-src vscode-webview://test 'nonce-${NONCE}'`), 'style-src must include the nonce');
    assert.ok(html.includes("default-src 'none'"), 'default-src must be none');
});

test('applies the nonce to the style and script tags', () => {
    const html = build();
    assert.strictEqual((html.match(new RegExp(`nonce="${NONCE}"`, 'g')) || []).length, 2);
});

test('contains no inline event handlers', () => {
    const html = build();
    assert.ok(!/\son(click|change|input|load|error)\s*=/.test(html), 'inline handlers are CSP-hostile');
});

test('offers the If / Else builder hand-off', () => {
    const html = build();
    assert.ok(html.includes('id="btnIfElse"'), 'missing the If / Else button');
    assert.ok(html.includes('openIfElseBuilder'), 'missing the builder message');
});

test('embeds the persisted Auto-format default', () => {
    const off = build();
    const on  = build({ autoFormat: true });
    assert.match(off, /let autoFmt\s*=\s*false;/);
    assert.match(on,  /let autoFmt\s*=\s*true;/);
});

test('supports the panel state message protocol', () => {
    const html = build();
    for (const command of ['loadExpression', 'updateRaw', 'draft', 'autoFormat']) {
        assert.ok(html.includes(`'${command}'`), `missing the ${command} message`);
    }
    assert.ok(html.includes('id="tag-label"'), 'missing the switchable tag label');
});

test('restores the editor text from webview state', () => {
    const html = build();
    assert.ok(html.includes('vscode.getState()'));
    assert.ok(html.includes('vscode.setState'));
});

test('does not let </script> escape the data block', () => {
    const payload = `$F{x} + "</script><script>acquireVsCodeApi().postMessage({command:'applyExpression'})</script>"`;
    const html = build({ rawExpression: payload, formattedExpression: payload });

    assert.ok(!html.includes('</script><script>'), 'raw breakout sequence must not survive');
    assert.ok(html.includes('\\u003c/script\\u003e'), 'payload should be unicode-escaped');
    assert.strictEqual((html.match(/<script/g) || []).length, 1);
    assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
});

test('escapes the tag name and the expression shown in the edit pane', () => {
    const html = build({ tagName: '<evil>', formattedExpression: '<img src=x onerror=alert(1)>' });
    assert.ok(html.includes('&lt;evil&gt;'));
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
});

test('escapeHtmlText escapes HTML metacharacters', () => {
    assert.strictEqual(escapeHtmlText(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#039;');
    assert.strictEqual(escapeHtmlText(null), '');
});

test('jsonForInlineScript escapes < > & and line separators', () => {
    assert.strictEqual(jsonForInlineScript('a<b>c&d'), '"a\\u003cb\\u003ec\\u0026d"');
    assert.strictEqual(jsonForInlineScript('x\u2028y'), '"x\\u2028y"');
    assert.strictEqual(jsonForInlineScript(undefined), 'null');
});

test('getNonce returns distinct hex strings', () => {
    const a = getNonce();
    const b = getNonce();
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.notStrictEqual(a, b);
});

test('the webview script parses as JavaScript', () => {
    const html = build();
    const match = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, 'expected the nonce script block');
    assert.doesNotThrow(() => new Function(match[1]));
});
