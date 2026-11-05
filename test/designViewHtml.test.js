// test/designViewHtml.test.js
// Security and wiring tests for the generated design-view document.

const test   = require('node:test');
const assert = require('node:assert');

const { buildDesignViewHtml } = require('../designViewHtml');

const NONCE = 'deadbeefdeadbeefdeadbeefdeadbeef';

function model(overrides = {}) {
    return {
        format: 'studio7',
        error: null,
        unsupported: null,
        report: {
            name: 'Test',
            pageWidth: 595,
            pageHeight: 842,
            leftMargin: 20,
            rightMargin: 20,
            topMargin: 20,
            bottomMargin: 20,
            columnWidth: 555,
            columnSpacing: 0,
            columnCount: 1,
            orientation: 'Portrait',
            language: 'java',
            whenNoDataType: 'NoPages',
        },
        bands: [],
        warnings: [],
        truncated: false,
        counts: { bands: 0, elements: 0 },
        ...overrides,
    };
}

function build(overrides = {}) {
    return buildDesignViewHtml({
        model: model(),
        fileName: 'Report.jrxml',
        version: 7,
        nonce: NONCE,
        cspSource: 'vscode-webview://test',
        ...overrides,
    });
}

function inlineScript(html) {
    const match = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, 'the document must contain one inline script');
    return match[1];
}

test('declares a nonce-based Content-Security-Policy', () => {
    const html = build();

    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.ok(html.includes("default-src 'none'"), 'default-src must be none');
    assert.ok(html.includes(`script-src 'nonce-${NONCE}'`), 'script-src must be nonce-based');
    assert.ok(html.includes(`style-src vscode-webview://test 'nonce-${NONCE}'`), 'style-src must include the nonce');
    assert.ok(!/img-src[^;]*https?:/i.test(html), 'the webview must not load remote images');
});

test('applies the nonce to the style and script tags', () => {
    const html = build();
    assert.strictEqual((html.match(new RegExp(`nonce="${NONCE}"`, 'g')) || []).length, 2);
});

test('contains no inline event handlers, innerHTML or eval', () => {
    const html = build();

    assert.ok(!/\son(click|change|input|load|error)\s*=/.test(html), 'inline handlers are CSP-hostile');
    assert.ok(!html.includes('innerHTML'), 'file content must never be assigned as markup');
    assert.ok(!/\beval\s*\(/.test(html), 'eval must not be used');
});

test('does not let </script> escape the embedded model', () => {
    const payload = '</script><script>acquireVsCodeApi().postMessage({command:"reveal",offset:0})</script>';
    const html = build({
        model: model({
            bands: [{
                key: 'detail', label: 'Detail', group: '', height: 20, offset: 0, end: 1,
                elements: [{
                    kind: 'staticText', offset: 1, end: 2, x: 0, y: 0, width: 10, height: 10,
                    displayText: payload, tooltip: payload,
                    style: {
                        fontFamily: 'sans-serif', fontSize: 10, bold: false, italic: false,
                        underline: false, strikeThrough: false, forecolor: '#000000',
                        backcolor: 'transparent', hAlign: 'left', vAlign: 'top',
                        rotation: 0, markup: 'none', mode: 'Transparent',
                    },
                    box: { top: false, right: false, bottom: false, left: false, color: '#000000', lineStyle: 'solid' },
                    line: null, children: [],
                }],
            }],
            counts: { bands: 1, elements: 1 },
        }),
    });

    assert.ok(!html.includes('</script><script>'), 'the breakout sequence must not survive');
    assert.ok(html.includes('\\u003c/script\\u003e'), 'the payload should be unicode-escaped');
    assert.strictEqual((html.match(/<script/g) || []).length, 1);
    assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
});

test('escapes the file name in the embedded metadata', () => {
    const html = build({ fileName: '<img src=x onerror=alert(1)>.jrxml' });

    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
    assert.ok(html.includes('\\u003cimg src=x onerror=alert(1)\\u003e.jrxml'));
});

test('the generated client script is syntactically valid', () => {
    const script = inlineScript(build());
    assert.doesNotThrow(() => new Function(script));
});

test('ships the required renderer and messaging hooks', () => {
    const html = build();
    const script = inlineScript(html);

    for (const id of [
        'page', 'empty', 'banner', 'zoom-in', 'zoom-out', 'zoom-fit', 'refresh',
        'mode-view', 'mode-edit', 'follow-cursor', 'workspace',
        'inspector', 'inspect-kind', 'inspect-position', 'inspect-reveal',
        'prop-x', 'prop-y', 'prop-width', 'prop-height', 'prop-text',
        'prop-text-apply', 'prop-font-name', 'prop-font-size', 'prop-bold',
        'prop-italic', 'prop-underline', 'prop-strike', 'prop-halign',
        'prop-valign', 'prop-rotation', 'prop-markup', 'prop-mode',
        'prop-forecolor', 'prop-backcolor', 'inspector-error',
        'prop-style', 'prop-position-type', 'prop-stretch-type',
        'prop-print-repeated', 'prop-remove-line', 'prop-print-first-whole',
        'prop-print-detail-overflow', 'prop-print-group',
        'prop-evaluation-time', 'prop-evaluation-group',
        'prop-bookmark-level', 'prop-key', 'prop-text-adjust', 'prop-pattern',
        'prop-blank-null', 'prop-scale-image', 'prop-h-image-align',
        'prop-v-image-align', 'prop-on-error', 'prop-link-type',
        'prop-using-cache', 'prop-lazy', 'prop-line-direction',
        'prop-line-width', 'prop-line-style', 'prop-line-color',
        'prop-radius', 'prop-break-type', 'prop-subreport-cache',
        'prop-run-to-bottom', 'prop-box-border', 'prop-box-width',
        'prop-box-style', 'prop-box-color', 'prop-box-padding',
        'attributes-list', 'new-attr-name', 'new-attr-value', 'add-attribute',
        'completion-popup', 'completion-hint', 'completion-list',
    ]) {
        assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
    }

    assert.ok(html.includes('acquireVsCodeApi()'));
    assert.ok(html.includes('const INITIAL_VERSION = 7;'));
    assert.ok(script.includes("command: 'ready'"));
    assert.ok(script.includes("command: 'reveal'"));
    assert.ok(script.includes("command: 'refresh'"));
    assert.ok(script.includes("message.command === 'select'"));
    assert.ok(script.includes("command: 'applyEdit'"));
    assert.ok(script.includes("message.command === 'editRejected'"));
    assert.ok(script.includes('resize-handle'));
    assert.ok(script.includes('borderRadius'), 'the rectangle radius must be rendered');
    assert.ok(script.includes("'elementgroup'"), 'element groups must render as containers');
    assert.ok(script.includes("createElementNS"), 'lines must render with SVG');
    assert.ok(script.includes('renderAttributeRows'), 'the all-attributes editor must be wired');
    assert.ok(script.includes('queueAttributeRemove'));
    assert.ok(script.includes("command: 'complete'"), 'the inspector must request completions');
    assert.ok(script.includes("message.command === 'completions'"), 'completion responses must be handled');
    assert.ok(script.includes('acceptCompletion'));
    assert.ok(script.includes('placeholder'), 'snippet placeholders must be preserved');
    assert.ok(script.includes('textContent'), 'content must be rendered with textContent');
    assert.ok(script.includes('addEventListener'), 'interactions must use addEventListener');
    assert.ok(script.includes('replaceChildren'), 're-rendering must replace the canvas children');
    assert.ok(script.includes("'page-content'"), 'page content must live in the clipping layer');
    assert.match(
        html,
        /\.page-content\s*\{[^}]*overflow:\s*hidden/,
        'content wider than the paper must be clipped'
    );
});

test('embeds the document version and handles a missing version', () => {
    assert.ok(build().includes('const INITIAL_VERSION = 7;'));

    const noVersion = buildDesignViewHtml({
        model: model(),
        fileName: 'Report.jrxml',
        version: null,
        nonce: NONCE,
        cspSource: 'vscode-webview://test',
    });
    assert.ok(noVersion.includes('const INITIAL_VERSION = null;'));
});

test('embeds the model and file name as parseable JSON', () => {
    const html = build({
        model: model({ report: { ...model().report, name: 'Injected </script> report' } }),
        fileName: 'Injected.jrxml',
    });

    const modelMatch = /const INITIAL_MODEL = (.*?);\nconst INITIAL_FILE/s.exec(html);
    const fileMatch  = /const INITIAL_FILE\s+= (.*?);\n/s.exec(html);
    assert.ok(modelMatch && fileMatch);

    const parsed = JSON.parse(modelMatch[1]);
    assert.strictEqual(parsed.report.name, 'Injected </script> report');
    assert.strictEqual(JSON.parse(fileMatch[1]), 'Injected.jrxml');
});

test('renders an empty-state payload for a null model', () => {
    const html = build({ model: null });
    assert.ok(html.includes('const INITIAL_MODEL = null'));
    assert.ok(html.includes('No report selected'));
    assert.ok(html.includes('Open a .jrxml file'));
});

test('documents the classic-format limitation in the client', () => {
    const html = build();
    assert.ok(html.includes('Classic JRXML format'));
    assert.ok(html.includes('Studio 7 / JasperReports 7 JRXML format only'));
});
