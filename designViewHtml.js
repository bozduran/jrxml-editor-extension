// designViewHtml.js
// Pure HTML/CSS/client-JS builder for the read-only JRXML design view webview.
//
// Like expressionPanelHtml, this module deliberately does NOT require('vscode')
// so the generated document can be unit-tested with plain Node. The host panel
// passes in the model, the CSP source and a fresh nonce.
//
// Security rules for the client script:
//   * file content is only ever assigned through textContent / properties;
//   * no markup from the JRXML is interpolated into the document;
//   * no inline event handlers and no eval/innerHTML.

const { jsonForInlineScript } = require('./expressionPanelHtml');

/**
 * Build the complete design-view document.
 *
 * @param {object} opts
 * @param {object|null} opts.model       designModel result (null = empty state)
 * @param {string} [opts.fileName]       basename shown in the toolbar
 * @param {string} opts.nonce            CSP nonce for the style/script tags
 * @param {string} [opts.cspSource]      webview.cspSource
 * @returns {string} full HTML document
 */
function buildDesignViewHtml({ model, fileName, nonce, cspSource }) {
    const source    = cspSource || '';
    const modelJson = jsonForInlineScript(model === undefined ? null : model);
    const fileJson  = jsonForInlineScript(fileName || '');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${source} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${source} data:;">
<title>JRXML Design</title>
<style nonce="${nonce}">
  :root {
    --bg:      var(--vscode-editor-background, #1e1e1e);
    --fg:      var(--vscode-editor-foreground, #d4d4d4);
    --border:  var(--vscode-panel-border, #444);
    --muted:   var(--vscode-descriptionForeground, #888);
    --accent:  var(--vscode-focusBorder, #007acc);
    --btn-bg:  var(--vscode-button-background, #0e639c);
    --btn-fg:  var(--vscode-button-foreground, #fff);
    --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
  }

  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: 13px;
  }
  [hidden] { display: none !important; }

  .toolbar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
  }
  .doc { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .file-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .report-meta { font-size: 11px; color: var(--muted); margin-top: 1px; }
  .actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .actions button {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 3px;
    min-width: 24px;
    height: 24px;
    padding: 0 7px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }
  .actions button:hover { background: rgba(127,127,127,0.16); }
  .actions button.primary { background: var(--btn-bg); color: var(--btn-fg); border-color: transparent; }
  #zoom-label { min-width: 40px; text-align: center; font-size: 11px; color: var(--muted); }

  .banner {
    flex-shrink: 0;
    padding: 5px 12px;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
    white-space: pre-wrap;
  }
  .banner.error { background: rgba(244,135,113,0.14); color: #f48771; }
  .banner.warn  { background: rgba(204,167,0,0.12);  color: #cca700; }
  .banner.info  { background: rgba(117,190,255,0.12); color: #75beff; }

  #viewport { flex: 1; overflow: auto; position: relative; }
  #canvas { position: relative; min-height: 100%; padding: 16px 16px 32px; }

  .page {
    position: relative;
    background: #ffffff;
    color: #111111;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.16), 0 6px 22px rgba(0,0,0,0.4);
  }

  .margin {
    position: absolute;
    background: rgba(0,0,0,0.06);
    pointer-events: none;
  }

  .band-row {
    position: absolute;
    border-top: 1px dashed rgba(0,0,0,0.22);
    pointer-events: none;
  }
  .band-row.background-band { border-top-color: rgba(0,0,0,0.10); }

  .band-label {
    position: absolute;
    display: block;
    padding-right: 8px;
    text-align: right;
    cursor: pointer;
    user-select: none;
    color: var(--muted);
    font-size: 10px;
    line-height: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    z-index: 3;
  }
  .band-label:hover { color: var(--accent); }
  .band-label-name { font-weight: 600; color: var(--fg); }
  .band-label:hover .band-label-name { color: var(--accent); }
  .band-label-height { font-size: 9px; opacity: 0.7; margin-left: 3px; }

  .band-elements { position: absolute; overflow: visible; }

  .element { position: absolute; cursor: pointer; }
  .element:hover { outline: 1px solid var(--accent); outline-offset: 0; }
  .element.selected { outline: 2px solid var(--accent); outline-offset: 1px; z-index: 10; }

  .text-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }
  .text-content {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.15;
    overflow: hidden;
  }
  .text-content.empty-text { color: #999999; font-style: italic; }

  .placeholder {
    padding: 2px 3px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 1px;
    border: 1px dashed rgba(110,110,110,0.7);
    background: rgba(110,110,110,0.06);
  }
  .placeholder-kind {
    font-size: 9px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #777777;
  }
  .placeholder-text {
    font-size: 11px;
    color: #333333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .line-stroke { position: absolute; background: #000000; }
  .break-line {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    border-top: 1px dashed #c0392b;
  }
  .break-label {
    position: absolute;
    right: 2px;
    top: calc(50% - 13px);
    font-size: 9px;
    color: #c0392b;
  }

  .page-break {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed rgba(190,60,60,0.8);
    pointer-events: none;
    z-index: 5;
  }
  .page-break-label {
    position: absolute;
    right: 4px;
    top: -13px;
    font-size: 9px;
    color: #c0392b;
  }

  .column-restricted {
    position: absolute;
    background: rgba(0,0,0,0.045);
    pointer-events: none;
    z-index: 1;
  }
  .column-guide {
    position: absolute;
    border-left: 1px dashed rgba(0,0,0,0.2);
    pointer-events: none;
    z-index: 1;
  }
  .column-label {
    position: absolute;
    font-size: 9px;
    color: #888888;
    pointer-events: none;
    z-index: 1;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 32px;
    text-align: center;
  }
  .empty-title { font-size: 14px; font-weight: 600; }
  .empty-message { font-size: 12px; color: var(--muted); max-width: 520px; }

  .statusbar {
    flex-shrink: 0;
    display: flex;
    gap: 16px;
    padding: 4px 12px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
  }
  #status-left { flex-shrink: 0; }
  #status-hint { overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body>

<header class="toolbar">
  <div class="doc">
    <span class="file-name" id="file-name"></span>
    <span class="report-meta" id="report-meta"></span>
  </div>
  <div class="actions">
    <button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">&minus;</button>
    <span id="zoom-label"></span>
    <button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>
    <button id="zoom-fit" type="button" title="Fit page width">Fit</button>
    <button id="refresh" type="button" title="Refresh from source" aria-label="Refresh from source">&#x27F3;</button>
  </div>
</header>

<div id="banner" class="banner" hidden></div>

<main id="viewport">
  <div id="canvas">
    <div id="page" class="page" hidden></div>
    <div id="empty" class="empty">
      <div class="empty-title" id="empty-title"></div>
      <div class="empty-message" id="empty-message"></div>
    </div>
  </div>
</main>

<footer class="statusbar">
  <span id="status-left"></span>
  <span id="status-hint">Read-only &middot; click an element or band label to reveal it in the source</span>
</footer>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const INITIAL_MODEL = ${modelJson};
const INITIAL_FILE  = ${fileJson};

const GUTTER = 150;          // CSS px reserved for band labels
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

const viewport   = document.getElementById('viewport');
const page       = document.getElementById('page');
const empty      = document.getElementById('empty');
const emptyTitle = document.getElementById('empty-title');
const emptyMsg   = document.getElementById('empty-message');
const banner     = document.getElementById('banner');
const fileNameEl = document.getElementById('file-name');
const metaEl     = document.getElementById('report-meta');
const statusLeft = document.getElementById('status-left');
const zoomLabel  = document.getElementById('zoom-label');

let model         = null;
let fileName      = '';
let scale         = 1;
let zoomMode      = 'fit';
let selected      = null;
let resizeTimer   = null;

// ── Small DOM helpers ───────────────────────────────────────────────────────

function px(value) {
  return String(value) + 'px';
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function position(node, left, top, width, height) {
  node.style.left = px(left);
  node.style.top = px(top);
  node.style.width = px(Math.max(0, width));
  node.style.height = px(Math.max(0, height));
  return node;
}

function setBanner(tone, message) {
  banner.className = 'banner ' + tone;
  banner.textContent = message;
  banner.hidden = false;
}

function hideBanner() {
  banner.hidden = true;
  banner.textContent = '';
}

function setEmptyState(title, message) {
  page.hidden = true;
  empty.hidden = false;
  emptyTitle.textContent = title;
  emptyMsg.textContent = message;
  metaEl.textContent = '';
  statusLeft.textContent = '';
  zoomLabel.textContent = '';
}

function hideEmptyState() {
  empty.hidden = true;
  page.hidden = false;
}

// ── Model / state ───────────────────────────────────────────────────────────

function setModel(nextModel, nextFile) {
  model    = nextModel || null;
  fileName = nextFile || '';
  fileNameEl.textContent = fileName;
  fileNameEl.title = fileName;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function fitScale(report) {
  const available = viewport.clientWidth - GUTTER - 64;
  if (!(available > 0)) return 1;
  return clamp(available / report.pageWidth, ZOOM_MIN, 2);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function render() {
  const scrollLeft = viewport.scrollLeft;
  const scrollTop  = viewport.scrollTop;
  selected = null;

  if (!model) {
    hideBanner();
    setEmptyState(
      'No report selected',
      'Open a .jrxml file and run "JRXML: Open Design View" from the editor title or the JRXML menu.'
    );
    return;
  }

  if (model.error) {
    setBanner('error', 'Cannot read this report: ' + model.error);
    setEmptyState('Cannot read this report', model.error + ' Fix the XML and the view will refresh.');
    return;
  }

  if (model.unsupported === 'classic') {
    setBanner('info', 'This Design view supports the Studio 7 / JasperReports 7 JRXML format only.');
    setEmptyState(
      'Classic JRXML format',
      'This report uses the classic format (<staticText>, <textField>, <reportElement ...>). ' +
      'The read-only Design view currently renders Studio 7 files (<element kind="...">).'
    );
    return;
  }

  if (!model.bands || model.bands.length === 0) {
    hideBanner();
    setEmptyState('No bands yet', 'This report has no bands to display. Add a band in the source and the view will refresh.');
    if (model.report) {
      metaEl.textContent = 'Page ' + model.report.pageWidth + ' \u00d7 ' + model.report.pageHeight + ' px';
    }
    return;
  }

  hideEmptyState();
  setBannerForWarnings(model);

  const report = model.report;
  if (zoomMode === 'fit') scale = fitScale(report);

  renderPage(model, report);
  updateMeta(model);
  updateZoomLabel();

  viewport.scrollLeft = scrollLeft;
  viewport.scrollTop  = scrollTop;
}

function setBannerForWarnings(current) {
  const warnings = Array.isArray(current.warnings) ? current.warnings.slice() : [];
  if (warnings.length === 0) {
    hideBanner();
    return;
  }
  setBanner('warn', warnings.join(' '));
}

function updateMeta(current) {
  const report = current.report;
  const columnText = report.columnCount === 1
    ? 'column ' + report.columnWidth + ' px'
    : report.columnCount + ' columns of ' + report.columnWidth + ' px';
  metaEl.textContent =
    'Page ' + report.pageWidth + ' \u00d7 ' + report.pageHeight + ' px \u00b7 ' +
    columnText + ' \u00b7 ' + current.counts.bands + ' bands \u00b7 ' +
    current.counts.elements + ' elements';
  statusLeft.textContent = 'Read-only \u00b7 ' + report.language;
}

function updateZoomLabel() {
  zoomLabel.textContent = Math.round(scale * 100) + '%';
}

function renderPage(current, report) {
  page.replaceChildren();

  const rows = [];
  let top = report.topMargin;

  for (const band of current.bands) {
    const displayHeight = band.height > 0 ? band.height : 14;
    rows.push({ band, top, displayHeight });
    top += displayHeight;
  }

  const surfaceHeight = Math.max(report.pageHeight, top + report.bottomMargin);
  const pageWidthPx   = report.pageWidth * scale;
  const surfacePx     = surfaceHeight * scale;
  const contentWidth  = Math.max(0, report.pageWidth - report.leftMargin - report.rightMargin);

  page.style.width = px(pageWidthPx);
  page.style.height = px(surfacePx);
  page.style.marginLeft = px(GUTTER);

  renderMargins(report, surfaceHeight);
  renderPageBreaks(report, surfaceHeight);
  renderColumns(report, surfaceHeight);

  for (const row of rows) {
    renderBandRow(row, report, contentWidth);
  }
}

function renderMargins(report, surfaceHeight) {
  const width  = report.pageWidth * scale;
  const height = surfaceHeight * scale;

  addOverlay('margin', 0, 0, width, report.topMargin * scale);
  addOverlay('margin', 0, 0, report.leftMargin * scale, height);
  addOverlay(
    'margin',
    (report.pageWidth - report.rightMargin) * scale,
    0,
    report.rightMargin * scale,
    height
  );

  if (surfaceHeight <= report.pageHeight) {
    addOverlay(
      'margin',
      0,
      (report.pageHeight - report.bottomMargin) * scale,
      width,
      report.bottomMargin * scale
    );
  }
}

function renderPageBreaks(report, surfaceHeight) {
  let pageNumber = 2;
  for (let y = report.pageHeight; y < surfaceHeight - 0.5; y += report.pageHeight) {
    const line = make('div', 'page-break');
    line.style.top = px(y * scale);
    line.appendChild(make('span', 'page-break-label', 'Page ' + pageNumber));
    page.appendChild(line);
    pageNumber += 1;
  }
}

function renderColumns(report, surfaceHeight) {
  if (report.columnCount <= 1) return;

  const totalWidth = report.columnCount * report.columnWidth +
    (report.columnCount - 1) * report.columnSpacing;
  const start = report.leftMargin + report.columnWidth + report.columnSpacing;
  const end   = Math.min(
    report.leftMargin + totalWidth,
    report.pageWidth - report.rightMargin
  );

  if (end > start) {
    addOverlay(
      'column-restricted',
      start * scale,
      report.topMargin * scale,
      (end - start) * scale,
      Math.max(0, surfaceHeight - report.topMargin - report.bottomMargin) * scale
    );
  }

  for (let column = 1; column < report.columnCount; column += 1) {
    const x = report.leftMargin + column * (report.columnWidth + report.columnSpacing);
    const guide = make('div', 'column-guide');
    guide.style.left = px(x * scale);
    guide.style.top = px(report.topMargin * scale);
    guide.style.height = px(Math.max(0, surfaceHeight - report.topMargin - report.bottomMargin) * scale);
    page.appendChild(guide);

    const label = make('div', 'column-label', 'Column ' + (column + 1));
    label.style.left = px((x + 4) * scale);
    label.style.top = px((report.topMargin + 2) * scale);
    page.appendChild(label);
  }
}

function addOverlay(className, left, top, width, height) {
  const node = make('div', className);
  position(node, left, top, width, height);
  page.appendChild(node);
  return node;
}

function renderBandRow(row, report, contentWidth) {
  const band = row.band;
  const scaling = scale;

  const rowEl = make('div', 'band-row');
  rowEl.style.top = px(row.top * scaling);
  rowEl.style.left = px(report.leftMargin * scaling);
  rowEl.style.width = px(contentWidth * scaling);
  rowEl.style.height = px(row.displayHeight * scaling);
  if (band.key === 'background') rowEl.className += ' background-band';
  page.appendChild(rowEl);

  const label = make('div', 'band-label');
  label.style.top = px(row.top * scaling);
  label.style.left = px(-(GUTTER - 10));
  label.style.width = px(GUTTER - 20);
  label.style.height = px(Math.max(row.displayHeight * scaling, 16));
  label.setAttribute('data-offset', String(band.offset));
  label.setAttribute('data-end', String(band.end));
  label.title = band.label + ' \u2014 click to reveal in source';
  label.appendChild(make('span', 'band-label-name', band.label));
  label.appendChild(make('span', 'band-label-height', String(band.height)));
  page.appendChild(label);

  const layer = make('div', 'band-elements');
  layer.style.left = px(report.leftMargin * scaling);
  layer.style.top = px(row.top * scaling);
  layer.style.width = px(report.columnWidth * scaling);
  layer.style.height = px(row.displayHeight * scaling);
  renderElements(band.elements, layer);
  page.appendChild(layer);
}

// ── Elements ────────────────────────────────────────────────────────────────

function renderElements(elements, parent) {
  for (const element of elements) parent.appendChild(renderElement(element));
}

function renderElement(element) {
  const style = element.style || {};
  const node  = make('div', 'element');
  const kind  = String(element.kind || 'element').toLowerCase();

  node.style.left = px(element.x * scale);
  node.style.top = px(element.y * scale);
  node.style.width = px(Math.max(0, element.width * scale));
  node.style.height = px(Math.max(0, element.height * scale));
  node.setAttribute('data-offset', String(element.offset));
  node.setAttribute('data-end', String(element.end));
  if (element.tooltip) node.title = element.tooltip;

  if (style.mode === 'Opaque' && style.backcolor && style.backcolor !== 'transparent') {
    node.style.backgroundColor = style.backcolor;
  }
  if (style.rotation) {
    node.style.transform = 'rotate(' + style.rotation + 'deg)';
    node.style.transformOrigin = 'center center';
  }

  if (kind === 'statictext' || kind === 'textfield') {
    renderText(node, element, style);
  } else if (kind === 'line') {
    renderLine(node, element);
  } else if (kind === 'rectangle') {
    renderShape(node, element, style, false);
  } else if (kind === 'ellipse') {
    renderShape(node, element, style, true);
  } else if (kind === 'frame') {
    renderFrame(node, element, style);
  } else if (kind === 'break') {
    renderBreak(node);
  } else {
    renderPlaceholder(node, element);
  }

  return node;
}

function renderText(node, element, style) {
  node.classList.add('text-element');
  node.style.overflow = 'hidden';
  applyBox(node, element.box, null);

  const wrap = make('div', 'text-wrap');
  wrap.style.justifyContent = justifyFor(style.vAlign);

  const content = make('div', 'text-content');
  const isTextField = String(element.kind).toLowerCase() === 'textfield';
  content.textContent = element.displayText || (isTextField ? '(no expression)' : '(empty)');
  if (!element.displayText) content.classList.add('empty-text');
  content.style.textAlign = style.hAlign || 'left';
  content.style.fontFamily = style.fontFamily || 'sans-serif';
  content.style.fontSize = px(Math.max(6, (style.fontSize || 10) * scale));
  content.style.fontWeight = style.bold ? '600' : '400';
  content.style.fontStyle = style.italic ? 'italic' : 'normal';
  content.style.color = style.forecolor || '#000000';

  const decorations = [];
  if (style.underline) decorations.push('underline');
  if (style.strikeThrough) decorations.push('line-through');
  if (decorations.length > 0) content.style.textDecoration = decorations.join(' ');

  wrap.appendChild(content);
  node.appendChild(wrap);
}

function renderPlaceholder(node, element) {
  node.classList.add('placeholder');
  node.style.borderStyle = 'dashed';
  node.style.borderWidth = '1px';
  node.style.borderColor = 'rgba(110,110,110,0.7)';
  if (!node.style.backgroundColor) node.style.backgroundColor = 'rgba(110,110,110,0.06)';

  node.appendChild(make('div', 'placeholder-kind', element.kind));
  if (element.displayText) {
    const text = make('div', 'placeholder-text', element.displayText);
    text.title = element.displayText;
    node.appendChild(text);
  }
}

function renderFrame(node, element, style) {
  applyBox(node, element.box, null);
  const children = make('div', 'frame-children');
  children.style.position = 'absolute';
  children.style.inset = '0';
  children.style.overflow = 'visible';
  renderElements(element.children || [], children);
  node.appendChild(children);
}

function renderLine(node, element) {
  const line = element.line || { direction: 'horizontal', width: 1, color: '#000000' };
  const stroke = make('div', 'line-stroke');
  const thickness = Math.max(1, (line.width || 1) * scale);
  stroke.style.backgroundColor = line.color || '#000000';

  if (line.direction === 'vertical') {
    stroke.style.left = '50%';
    stroke.style.top = '0';
    stroke.style.width = px(thickness);
    stroke.style.height = '100%';
    stroke.style.transform = 'translateX(-50%)';
  } else {
    stroke.style.left = '0';
    stroke.style.top = '50%';
    stroke.style.width = '100%';
    stroke.style.height = px(thickness);
    stroke.style.transform = 'translateY(-50%)';
  }
  node.appendChild(stroke);
}

function renderShape(node, element, style, ellipse) {
  if (ellipse) node.style.borderRadius = '50%';
  if (style.mode === 'Opaque' && style.backcolor && style.backcolor !== 'transparent') {
    node.style.backgroundColor = style.backcolor;
  }
  const drewBorder = applyBox(node, element.box, style.forecolor || '#000000');
  if (!drewBorder) {
    node.style.borderStyle = 'solid';
    node.style.borderWidth = '1px';
    node.style.borderColor = style.forecolor || '#000000';
  }
}

function renderBreak(node) {
  node.style.overflow = 'visible';
  node.appendChild(make('div', 'break-line'));
  node.appendChild(make('div', 'break-label', 'Page Break'));
}

function applyBox(node, box, fallbackColor) {
  if (!box) return false;

  const borderStyle = box.lineStyle === 'dashed' || box.lineStyle === 'dotted' || box.lineStyle === 'double'
    ? box.lineStyle
    : 'solid';
  const color = box.color || fallbackColor || '#000000';
  let drew = false;

  if (box.top)    { node.style.borderTop    = '1px ' + borderStyle + ' ' + color; drew = true; }
  if (box.right)  { node.style.borderRight  = '1px ' + borderStyle + ' ' + color; drew = true; }
  if (box.bottom) { node.style.borderBottom = '1px ' + borderStyle + ' ' + color; drew = true; }
  if (box.left)   { node.style.borderLeft   = '1px ' + borderStyle + ' ' + color; drew = true; }

  return drew;
}

function justifyFor(vAlign) {
  if (vAlign === 'middle') return 'center';
  if (vAlign === 'bottom') return 'flex-end';
  return 'flex-start';
}

// ── Zoom ────────────────────────────────────────────────────────────────────

function setZoom(next, mode) {
  zoomMode = mode;
  scale = clamp(next, ZOOM_MIN, ZOOM_MAX);
  if (model && !model.error && !model.unsupported) render();
  else updateZoomLabel();
}

document.getElementById('zoom-out').addEventListener('click', function () {
  setZoom(scale - ZOOM_STEP, 'manual');
});

document.getElementById('zoom-in').addEventListener('click', function () {
  setZoom(scale + ZOOM_STEP, 'manual');
});

document.getElementById('zoom-fit').addEventListener('click', function () {
  zoomMode = 'fit';
  if (model && !model.error && !model.unsupported) render();
});

document.getElementById('refresh').addEventListener('click', function () {
  vscode.postMessage({ command: 'refresh' });
});

window.addEventListener('resize', function () {
  if (zoomMode !== 'fit' || !model || model.error || model.unsupported) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
});

// ── Reveal in source ────────────────────────────────────────────────────────

page.addEventListener('click', function (event) {
  const target = event.target && event.target.closest
    ? event.target.closest('[data-offset]')
    : null;
  if (!target) return;

  const offset = Number(target.getAttribute('data-offset'));
  const end    = Number(target.getAttribute('data-end'));

  if (selected && selected !== target) selected.classList.remove('selected');
  selected = target;
  target.classList.add('selected');

  vscode.postMessage({
    command: 'reveal',
    offset: Number.isFinite(offset) ? offset : 0,
    end: Number.isFinite(end) ? end : offset,
  });
});

// ── Host messages ───────────────────────────────────────────────────────────

window.addEventListener('message', function (event) {
  const message = event.data || {};
  if (message.command === 'update') {
    setModel(message.model, message.fileName);
    render();
  } else if (message.command === 'error') {
    setBanner('error', String(message.message || 'The design view hit an error.'));
  }
});

// ── Init ────────────────────────────────────────────────────────────────────

setModel(INITIAL_MODEL, INITIAL_FILE);
render();
vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
}

module.exports = { buildDesignViewHtml };
