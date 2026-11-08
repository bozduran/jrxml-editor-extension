// designViewHtml.js
// Pure HTML/CSS/client-JS builder for the JRXML design view webview.
//
// Like expressionPanelHtml, this module deliberately does NOT require('vscode')
// so the generated document can be unit-tested with plain Node. The host panel
// passes in the model, the CSP source and a fresh nonce.
//
// Security rules for the client script:
//   * file content is only ever assigned through textContent / properties;
//   * no markup from the JRXML is interpolated into the document;
//   * no inline event handlers and no eval/innerHTML.

const fs   = require('fs');
const path = require('path');
const { jsonForInlineScript } = require('./expressionPanelHtml');
const designViewStyles = require('./designViewStyles');

const CLIENT_FILE = path.join(__dirname, 'designViewClient.js');

/** Read the client script and keep a literal </script> inside it from closing the element. */
function clientScript() {
    return fs.readFileSync(CLIENT_FILE, 'utf8').replace(/<\/script/gi, '<\\/script');
}

/**
 * Build the complete design-view document.
 *
 * @param {object} opts
 * @param {object|null} opts.model       designModel result (null = empty state)
 * @param {string} [opts.fileName]       basename shown in the toolbar
 * @param {number|null} [opts.version]   TextDocument version the model was built from
 * @param {string} opts.nonce            CSP nonce for the style/script tags
 * @param {string} [opts.cspSource]      webview.cspSource
 * @returns {string} full HTML document
 */
function buildDesignViewHtml({ model, fileName, version, nonce, cspSource }) {
    const source    = cspSource || '';
    const modelJson = jsonForInlineScript(model === undefined ? null : model);
    const fileJson  = jsonForInlineScript(fileName || '');
    const versionJson = jsonForInlineScript(Number.isInteger(version) ? version : null);

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${source} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${source} data:;">
<title>JRXML Design</title>
<style nonce="${nonce}">
${designViewStyles}
</style>
</head>
<body>

<header class="toolbar">
  <div class="doc">
    <span class="file-name" id="file-name"></span>
    <span class="report-meta" id="report-meta"></span>
  </div>
  <div class="actions">
    <div class="mode-group" role="group" aria-label="Design view mode">
      <button id="mode-view" type="button" title="Read-only view" aria-pressed="true">View</button>
      <button id="mode-edit" type="button" title="Drag and edit elements" aria-pressed="false">Edit</button>
    </div>
    <button id="follow-cursor" type="button" title="Follow the source cursor" aria-pressed="true">Follow</button>
    <button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">&minus;</button>
    <span id="zoom-label"></span>
    <button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>
    <button id="zoom-fit" type="button" title="Fit page width">Fit</button>
    <button id="refresh" type="button" title="Refresh from source" aria-label="Refresh from source">&#x27F3;</button>
  </div>
</header>

<div id="banner" class="banner" hidden></div>

<main id="workspace">
  <div id="viewport">
    <div id="canvas">
      <div id="page" class="page" hidden></div>
      <div id="empty" class="empty">
        <div class="empty-title" id="empty-title"></div>
        <div class="empty-message" id="empty-message"></div>
      </div>
    </div>
  </div>

  <aside id="inspector" hidden>
    <div class="inspector-header">
      <div class="inspector-kind" id="inspect-kind"></div>
      <div class="inspector-position" id="inspect-position"></div>
      <button class="link-button" id="inspect-reveal" type="button">Reveal in source</button>
    </div>
    <div class="inspector-body">
      <section class="inspector-section">
        <h3>Geometry</h3>
        <label class="field">X <input id="prop-x" type="number" step="1"></label>
        <label class="field">Y <input id="prop-y" type="number" step="1"></label>
        <label class="field">Width <input id="prop-width" type="number" min="1" step="1"></label>
        <label class="field">Height <input id="prop-height" type="number" min="1" step="1"></label>
      </section>

      <section class="inspector-section" id="content-section">
        <h3 id="content-title">Text</h3>
        <label class="field full"><textarea id="prop-text" spellcheck="false"></textarea></label>
        <div class="completion-popup" id="completion-popup" hidden>
          <div class="completion-popup-title" id="completion-hint"></div>
          <ul class="completion-list" id="completion-list" role="listbox" aria-label="Expression suggestions"></ul>
        </div>
        <div class="field full inspector-actions">
          <span class="hint" id="content-hint"></span>
          <button id="prop-text-apply" type="button">Apply text</button>
        </div>
      </section>

      <section class="inspector-section" id="text-style-section">
        <h3>Text style</h3>
        <label class="field full">Font <input id="prop-font-name" type="text" placeholder="sans-serif"></label>
        <label class="field">Size <input id="prop-font-size" type="number" min="0.1" step="0.5"></label>
        <label class="check"><input id="prop-bold" type="checkbox"> Bold</label>
        <label class="check"><input id="prop-italic" type="checkbox"> Italic</label>
        <label class="check"><input id="prop-underline" type="checkbox"> Underline</label>
        <label class="check"><input id="prop-strike" type="checkbox"> Strike</label>
        <label class="field">H align
          <select id="prop-halign">
            <option value="Left">Left</option>
            <option value="Center">Center</option>
            <option value="Right">Right</option>
            <option value="Justify">Justify</option>
          </select>
        </label>
        <label class="field">V align
          <select id="prop-valign">
            <option value="Top">Top</option>
            <option value="Middle">Middle</option>
            <option value="Bottom">Bottom</option>
          </select>
        </label>
        <label class="field">Rotation
          <select id="prop-rotation">
            <option value="None">None</option>
            <option value="Left">Left</option>
            <option value="Right">Right</option>
            <option value="UpsideDown">Upside down</option>
          </select>
        </label>
        <label class="field">Markup
          <select id="prop-markup">
            <option value="none">None</option>
            <option value="styled">Styled</option>
            <option value="html">HTML</option>
            <option value="rtf">RTF</option>
          </select>
        </label>
        <label class="field">Text adjust
          <select id="prop-text-adjust">
            <option value="">Default</option>
            <option value="CutText">Cut text</option>
            <option value="StretchHeight">Stretch height</option>
            <option value="ScaleFont">Scale font</option>
          </select>
        </label>
        <label class="field">Pattern <input id="prop-pattern" type="text" placeholder="no pattern"></label>
        <label class="check"><input id="prop-blank-null" type="checkbox"> Blank when null</label>
      </section>

      <section class="inspector-section" id="appearance-section">
        <h3>Appearance</h3>
        <label class="field">Foreground <input id="prop-forecolor" type="text" placeholder="#000000"></label>
        <label class="field">Background <input id="prop-backcolor" type="text" placeholder="transparent"></label>
        <label class="field full">Mode
          <select id="prop-mode">
            <option value="Transparent">Transparent</option>
            <option value="Opaque">Opaque</option>
          </select>
        </label>
      </section>

      <section class="inspector-section" id="style-section">
        <h3>Style</h3>
        <label class="field full">Named style
          <select id="prop-style">
            <option value="">(inherit / default)</option>
          </select>
        </label>
        <span class="hint full" id="style-hint"></span>
      </section>

      <section class="inspector-section" id="behavior-section">
        <h3>Print &amp; behaviour</h3>
        <label class="field">Position
          <select id="prop-position-type">
            <option value="">Default</option>
            <option value="Float">Float</option>
            <option value="FixRelativeToTop">Fix to top</option>
            <option value="FixRelativeToBottom">Fix to bottom</option>
          </select>
        </label>
        <label class="field">Stretch
          <select id="prop-stretch-type">
            <option value="">Default</option>
            <option value="NoStretch">No stretch</option>
            <option value="ElementGroupHeight">Element group height</option>
            <option value="ElementGroupBottom">Element group bottom</option>
            <option value="ContainerHeight">Container height</option>
            <option value="ContainerBottom">Container bottom</option>
            <option value="RelativeToTallestObject">Relative to tallest object</option>
            <option value="RelativeToBandHeight">Relative to band height</option>
          </select>
        </label>
        <label class="check"><input id="prop-print-repeated" type="checkbox"> Print repeated</label>
        <label class="check"><input id="prop-remove-line" type="checkbox"> Remove when blank</label>
        <label class="check"><input id="prop-print-first-whole" type="checkbox"> First whole band</label>
        <label class="check"><input id="prop-print-detail-overflow" type="checkbox"> On detail overflow</label>
        <label class="field">Print when group changes
          <input id="prop-print-group" type="text" placeholder="group name">
        </label>
        <label class="field">Evaluation time
          <select id="prop-evaluation-time">
            <option value="">Default</option>
            <option value="Now">Now</option>
            <option value="Report">Report</option>
            <option value="Page">Page</option>
            <option value="Column">Column</option>
            <option value="Group">Group</option>
            <option value="Band">Band</option>
            <option value="Auto">Auto</option>
            <option value="Master">Master</option>
          </select>
        </label>
        <label class="field">Evaluation group
          <input id="prop-evaluation-group" type="text" placeholder="group name">
        </label>
        <label class="field">Bookmark level
          <input id="prop-bookmark-level" type="number" min="0" step="1">
        </label>
        <label class="field">Key <input id="prop-key" type="text" placeholder="element key"></label>
      </section>

      <section class="inspector-section" id="image-section">
        <h3>Image</h3>
        <label class="field">Scale
          <select id="prop-scale-image">
            <option value="">Default</option>
            <option value="Clip">Clip</option>
            <option value="FillFrame">Fill frame</option>
            <option value="RetainShape">Retain shape</option>
            <option value="RealSize">Real size</option>
            <option value="RealHeight">Real height</option>
            <option value="RealWidth">Real width</option>
          </select>
        </label>
        <label class="field">H align
          <select id="prop-h-image-align">
            <option value="">Default</option>
            <option value="Left">Left</option>
            <option value="Center">Center</option>
            <option value="Right">Right</option>
          </select>
        </label>
        <label class="field">V align
          <select id="prop-v-image-align">
            <option value="">Default</option>
            <option value="Top">Top</option>
            <option value="Middle">Middle</option>
            <option value="Bottom">Bottom</option>
          </select>
        </label>
        <label class="field">On error
          <select id="prop-on-error">
            <option value="">Default</option>
            <option value="Error">Error</option>
            <option value="Blank">Blank</option>
            <option value="Icon">Icon</option>
          </select>
        </label>
        <label class="field full">Link type
          <select id="prop-link-type">
            <option value="">Default</option>
            <option value="None">None</option>
            <option value="Reference">Reference</option>
            <option value="LocalAnchor">Local anchor</option>
            <option value="LocalPage">Local page</option>
            <option value="RemoteAnchor">Remote anchor</option>
            <option value="RemotePage">Remote page</option>
          </select>
        </label>
        <label class="check"><input id="prop-using-cache" type="checkbox"> Use cache</label>
        <label class="check"><input id="prop-lazy" type="checkbox"> Lazy load</label>
      </section>

      <section class="inspector-section" id="line-section">
        <h3>Line</h3>
        <label class="field">Direction
          <select id="prop-line-direction">
            <option value="">Default</option>
            <option value="TopDown">Top down</option>
            <option value="BottomUp">Bottom up</option>
          </select>
        </label>
        <label class="field">Width <input id="prop-line-width" type="number" min="0.1" step="0.5"></label>
        <label class="field">Style
          <select id="prop-line-style">
            <option value="">Default</option>
            <option value="Solid">Solid</option>
            <option value="Dashed">Dashed</option>
            <option value="Dotted">Dotted</option>
            <option value="Double">Double</option>
          </select>
        </label>
        <label class="field">Color <input id="prop-line-color" type="text" placeholder="#000000"></label>
      </section>

      <section class="inspector-section" id="rectangle-section">
        <h3>Rectangle</h3>
        <label class="field full">Corner radius
          <input id="prop-radius" type="number" min="0" step="1">
        </label>
      </section>

      <section class="inspector-section" id="break-section">
        <h3>Page break</h3>
        <label class="field full">Type
          <select id="prop-break-type">
            <option value="">Default</option>
            <option value="Page">Page</option>
            <option value="Column">Column</option>
          </select>
        </label>
      </section>

      <section class="inspector-section" id="subreport-section">
        <h3>Subreport</h3>
        <label class="check"><input id="prop-subreport-cache" type="checkbox"> Use cache</label>
        <label class="check"><input id="prop-run-to-bottom" type="checkbox"> Run to bottom</label>
      </section>

      <section class="inspector-section" id="box-section">
        <h3>Border &amp; padding</h3>
        <label class="check full"><input id="prop-box-border" type="checkbox"> Draw border</label>
        <label class="field">Width <input id="prop-box-width" type="number" min="0.1" step="0.5"></label>
        <label class="field">Style
          <select id="prop-box-style">
            <option value="Solid">Solid</option>
            <option value="Dashed">Dashed</option>
            <option value="Dotted">Dotted</option>
            <option value="Double">Double</option>
          </select>
        </label>
        <label class="field">Color <input id="prop-box-color" type="text" placeholder="#000000"></label>
        <label class="field">Padding <input id="prop-box-padding" type="number" min="0" step="1"></label>
        <span class="hint full">A single border replaces per-side pens.</span>
      </section>

      <section class="inspector-section" id="attributes-section">
        <h3>All attributes</h3>
        <div id="attributes-list"></div>
        <div class="attributes-add">
          <input id="new-attr-name" type="text" placeholder="name" spellcheck="false">
          <input id="new-attr-value" type="text" placeholder="value" spellcheck="false">
          <button id="add-attribute" type="button">Add</button>
        </div>
      </section>

      <div class="field-error" id="inspector-error"></div>
    </div>
  </aside>
</main>

<footer class="statusbar">
  <span id="status-left"></span>
  <span id="status-hint">Read-only &middot; click an element or band label to reveal it in the source</span>
</footer>

<script nonce="${nonce}">
const INITIAL_MODEL = ${modelJson};
const INITIAL_FILE  = ${fileJson};
const INITIAL_VERSION = ${versionJson};

${clientScript()}
</script>
</body>
</html>`;
}

module.exports = { buildDesignViewHtml };
