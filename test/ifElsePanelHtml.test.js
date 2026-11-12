// test/ifElsePanelHtml.test.js
// CSP hardening, embedded-state and inlined-core checks for the If/Else webview.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('node:vm');

const { buildIfElsePanelHtml, buildCoreScript } = require('../out/ifElsePanelHtml');
const core = require('../out/ifElseBuilder');

const NONCE = 'cafebabecafebabecafebabecafebabe';
const SCRIPT_RE = new RegExp(`<script nonce="${NONCE}">([\\s\\S]*?)</script>`);

const SCHEMA = {
    F: [{ name: 'status', cls: 'String' }, { name: 'total', cls: 'BigDecimal' }],
    P: [{ name: 'limit', cls: 'Integer' }],
    V: [{ name: 'PAGE_NUMBER', cls: 'Integer' }],
};

function build(overrides = {}) {
    return buildIfElsePanelHtml({
        fileName: 'Report.jrxml',
        schema: SCHEMA,
        expression: 'IF($F{status}.equals("PAID"), "Paid", "Unknown")',
        targetTagName: 'textFieldExpression',
        canApply: true,
        options: { nullSafe: true, multiline: true, style: 'ternary' },
        activeFile: { fileName: 'Report.jrxml', isJrxml: true, differs: false },
        nonce: NONCE,
        cspSource: 'vscode-webview://test',
        ...overrides,
    });
}

function scriptOf(html) {
    const match = SCRIPT_RE.exec(html);
    assert.ok(match, 'expected the nonce script block');
    return match[1];
}

test('declares a nonce-based Content-Security-Policy', () => {
    const html = build();
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes(`script-src 'nonce-${NONCE}'`));
    assert.ok(html.includes(`style-src vscode-webview://test 'nonce-${NONCE}'`));
});

test('applies the nonce to the style and script tags only', () => {
    const html = build();
    assert.strictEqual((html.match(new RegExp(`nonce="${NONCE}"`, 'g')) || []).length, 2);
});

test('contains no inline event handlers, style attributes or upload control', () => {
    const html = build();
    assert.ok(!/\son(click|change|input|load|error|submit)\s*=/.test(html));
    assert.ok(!/\sstyle\s*=/.test(html));
    assert.ok(!html.includes('type="file"'), 'the panel must not ask for a JRXML upload');
    assert.ok(!html.includes('DOMParser'), 'schema parsing happens in the extension host');
});

test('contains no remote resources', () => {
    const html = build();
    assert.ok(!/https?:\/\//.test(html), 'no http(s) URLs in the webview');
});

test('offers Apply, Copy, Reload and Use active file controls', () => {
    const html = build();
    for (const id of ['apply', 'copy', 'load', 'btnReload', 'btnUseActive', 'rev']) {
        assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
    }
    assert.ok(html.includes('Apply to File'));
    assert.ok(html.includes('Use active file'));
});

test('result values use a multiline expression editor', () => {
    const html = build();
    const script = scriptOf(html);

    assert.ok(html.includes('textarea.res'), 'result values need the res textarea style');
    assert.ok(script.includes('function resultPlaceholder'), 'the result placeholder helper is missing');
    assert.ok(script.includes('const KINDS = JR.KINDS;'), 'the result kind selector must come from the core');
    assert.ok(script.includes("value.classList.toggle('expr'"), 'Expression results need their own editor style');
    assert.ok(html.includes('inserted verbatim'), 'the panel must explain expression results');
});

test('embeds the schema, options and initial expression', () => {
    const html = build();
    assert.ok(html.includes('"fileName":"Report.jrxml"'));
    assert.ok(html.includes('"status"'));
    assert.ok(html.includes('"PAGE_NUMBER"'));
    assert.ok(html.includes('"schema"'));
    assert.ok(html.includes('"IF($F{status}.equals(\\"PAID\\"), \\"Paid\\", \\"Unknown\\")"'));
});

test('does not let </script> escape the embedded data', () => {
    const payload = '</script><script>acquireVsCodeApi().postMessage({command:"applyExpression"})</script>';
    const html = build({
        expression: payload,
        fileName: payload,
        schema: { F: [{ name: payload, cls: 'String' }], P: [], V: [] },
    });

    assert.ok(!html.includes('</script><script>'), 'raw breakout must not survive');
    assert.ok(html.includes('\\u003c/script\\u003e'));
    assert.strictEqual((html.match(/<script/g) || []).length, 1);
    assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
});

test('the webview script parses as JavaScript', () => {
    const script = scriptOf(build());
    assert.doesNotThrow(() => new Function(script));
});

test('the core module is self-contained', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'out', 'ifElseBuilder.js'), 'utf8');
    assert.ok(!/\brequire\s*\(/.test(source), 'ifElseBuilder.js must stay inlinable (no require)');
    assert.ok(!source.includes('</script'), 'ifElseBuilder.js must not contain a script terminator');
    assert.ok(!/document\.|window\./u.test(source), 'ifElseBuilder.js must not use the DOM');
});

test('the inlined core behaves exactly like the required core', () => {
    const sandbox = { window: {} };
    vm.runInNewContext(buildCoreScript(), sandbox);
    const inlined = sandbox.window.__JRXML_IFELSE__;

    assert.ok(inlined, 'the inline wrapper must expose window.__JRXML_IFELSE__');
    for (const name of ['buildExpression', 'fromExpression', 'makeSchema', 'emptyState', 'typeOfClass']) {
        assert.strictEqual(typeof inlined[name], 'function', `missing ${name}`);
    }

    const state = {
        branches: [
            {
                join: '&&',
                conds: [{ ref: 'F', name: 'n', type: 'Number', op: '>', val: '5' }],
                res: { kind: 'text', val: 'big' },
            },
        ],
        els: { kind: 'text', val: 'small' },
    };

    for (const options of [
        { nullSafe: true, multiline: true, style: 'ternary' },
        { nullSafe: false, multiline: false, style: 'functions' },
    ]) {
        assert.strictEqual(
            inlined.buildExpression(state, options),
            core.buildExpression(state, options)
        );
    }

    const expression = '($F{n} != null && $F{n} > 3 ? "a" : "b")';
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(inlined.fromExpression(expression))),
        JSON.parse(JSON.stringify(core.fromExpression(expression)))
    );
});

test('the inlined core is included once', () => {
    const script = scriptOf(build());
    assert.strictEqual((script.match(/__JRXML_IFELSE__/g) || []).length >= 2, true);
    assert.strictEqual((script.match(/function buildExpression/g) || []).length, 1);
});
