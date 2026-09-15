// test/expressionPanelHtml.test.js
// Regression tests for the webview security hardening.

const test   = require('node:test');
const assert = require('node:assert');

const {
    buildPanelHtml,
    escapeHtmlText,
    jsonForInlineScript,
    getNonce,
} = require('../expressionPanelHtml');

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
