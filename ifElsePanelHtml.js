// ifElsePanelHtml.js
// Pure HTML/CSS/client-JS builder for the If / Else expression builder webview.
//
// Deliberately free of `vscode` (like expressionPanelHtml.js / settingsPanelHtml.js)
// so the document and its CSP hardening can be unit-tested with plain Node.
//
// The builder's pure logic lives in ifElseBuilder.js and is inlined into the
// nonce'd script below, so the webview and the tests share one implementation.

const fs = require('fs');
const path = require('path');

const { jsonForInlineScript, getNonce } = require('./expressionPanelHtml');

const CORE_FILE = path.join(__dirname, 'ifElseBuilder.js');

/**
 * The ifElseBuilder.js module wrapped so it can run inside the webview:
 * `window.__JRXML_IFELSE__` receives its exports.
 *
 * @returns {string} JavaScript source without a `<script>` wrapper
 */
function buildCoreScript() {
    // Defensive: a string literal containing </script> would close the element.
    const source = fs.readFileSync(CORE_FILE, 'utf8').replace(/<\/script/gi, '<\\/script');
    return [
        '(function (module) {',
        source,
        '  window.__JRXML_IFELSE__ = module.exports;',
        '})({ exports: {} });',
    ].join('\n');
}

/**
 * Build the complete webview document.
 *
 * @param {object} opts
 * @param {string|null} [opts.fileName]       attached .jrxml base name
 * @param {{F:Array,P:Array,V:Array}|null} [opts.schema]
 * @param {string|null} [opts.expression]     expression to load on first open
 * @param {string|null} [opts.targetTagName]  expression tag the Apply target points at
 * @param {boolean} [opts.canApply]
 * @param {{nullSafe:boolean,multiline:boolean,style:string}} [opts.options]
 * @param {{fileName:string|null,isJrxml:boolean,differs:boolean}} [opts.activeFile]
 * @param {string} [opts.schemaError]
 * @param {string} opts.nonce
 * @param {string} [opts.cspSource]
 * @returns {string} full HTML document
 */
function buildIfElsePanelHtml({
    fileName = null,
    schema = null,
    expression = null,
    targetTagName = null,
    canApply = false,
    options = {},
    activeFile = {},
    schemaError = null,
    nonce,
    cspSource,
} = {}) {
    const source = cspSource || '';
    const initialJson = jsonForInlineScript({
        fileName: fileName || null,
        schema: schema || null,
        expression: expression || null,
        targetTagName: targetTagName || null,
        canApply: !!canApply,
        schemaError: schemaError || null,
        options: {
            nullSafe: options.nullSafe !== false,
            multiline: options.multiline !== false,
            style: options.style === 'functions' ? 'functions' : 'ternary',
        },
        activeFile: {
            fileName: activeFile.fileName || null,
            isJrxml: !!activeFile.isJrxml,
            differs: !!activeFile.differs,
        },
    });
    const coreScript = buildCoreScript();
    const safeTitle = 'JRXML If / Else Builder';

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${source} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${source} data:;">
<title>${safeTitle}</title>
<style nonce="${nonce}">
  :root {
    --bg:          var(--vscode-editor-background, #1e1e1e);
    --card:        var(--vscode-sideBar-background, var(--vscode-editorWidget-background, #252526));
    --ink:         var(--vscode-foreground, #cccccc);
    --mut:         var(--vscode-descriptionForeground, #8a8a8a);
    --line:        var(--vscode-panel-border, #444444);
    --acc:         var(--vscode-button-background, #0e639c);
    --acc-ink:     var(--vscode-button-foreground, #ffffff);
    --acc-hover:   var(--vscode-button-hoverBackground, #1177bb);
    --sec-bg:      var(--vscode-button-secondaryBackground, transparent);
    --sec-fg:      var(--vscode-button-secondaryForeground, var(--vscode-foreground, #cccccc));
    --sec-hover:   var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.08));
    --code:        var(--vscode-textCodeBlock-background, var(--vscode-editor-background, #1e1e1e));
    --code-ink:    var(--vscode-editor-foreground, #d4d4d4);
    --warn:        var(--vscode-editorWarning-foreground, #cca700);
    --error:       var(--vscode-errorForeground, #f48771);
    --field:       var(--vscode-input-background, #3c3c3c);
    --field-ink:   var(--vscode-input-foreground, #cccccc);
    --field-line:  var(--vscode-input-border, var(--vscode-panel-border, #444444));
    --focus:       var(--vscode-focusBorder, #007fd4);
    --mono:        var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    --font-size:   var(--vscode-editor-font-size, 13px);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 12px;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--font-size);
    line-height: 1.5;
  }

  main { max-width: 1180px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .sub { color: var(--mut); margin: 0 0 12px; max-width: 64ch; font-size: 12px; }

  .bar {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .schema { color: var(--mut); font-size: 12px; flex: 1 1 260px; min-width: 0; }
  .targetbar { color: var(--mut); font-size: 12px; margin: 0 0 8px; }

  .banner {
    margin: 0 0 10px;
    padding: 5px 10px;
    border: 1px solid var(--line);
    border-radius: 4px;
    font-size: 12px;
  }
  .banner.info  { border-color: var(--focus); color: var(--ink); }
  .banner.warn  { border-color: var(--warn); color: var(--warn); }
  .banner.error { border-color: var(--error); color: var(--error); }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }

  .branch {
    background: var(--card);
    border: 1px solid var(--line);
    border-left: 4px solid var(--acc);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .branch.else { border-left-style: dashed; }

  .kw {
    font: 600 13px var(--mono);
    color: var(--vscode-textLink-foreground, #4ec9b0);
  }
  .head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .head .sp { flex: 1; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }

  input, select, button, textarea {
    font: inherit;
    color: var(--field-ink);
    background: var(--field);
    border: 1px solid var(--field-line);
    border-radius: 4px;
    padding: 4px 6px;
    min-height: 28px;
  }
  input { min-width: 0; }
  input.name { width: 140px; }
  input.val { flex: 1; min-width: 110px; }
  input.res { flex: 1; min-width: 150px; }
  textarea {
    width: 100%;
    font: 12px/1.5 var(--mono);
    margin: 6px 0 8px;
    padding: 6px;
    resize: vertical;
  }

  select, button { color: var(--ink); }
  button {
    cursor: pointer;
    background: var(--sec-bg);
    color: var(--sec-fg);
    border-color: var(--line);
  }
  button:hover { background: var(--sec-hover); border-color: var(--acc); }
  button.pri {
    background: var(--acc);
    color: var(--acc-ink);
    border-color: var(--acc);
    font-weight: 600;
  }
  button.pri:hover { background: var(--acc-hover); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.ghost { border-style: dashed; color: var(--mut); }
  button.x { padding: 2px 8px; color: var(--mut); }
  .add-branch { margin-bottom: 10px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }

  :focus-visible { outline: 1px solid var(--focus); outline-offset: 1px; }

  .then { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
  .then .kw { margin-right: 4px; }

  .panel {
    position: sticky;
    top: 12px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 12px;
  }
  .opts { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
  .opts label { display: flex; gap: 5px; align-items: center; cursor: pointer; font-size: 12px; }
  .opts label select { min-height: 24px; }

  pre {
    margin: 0 0 10px;
    background: var(--code);
    color: var(--code-ink);
    padding: 10px;
    border-radius: 4px;
    overflow-x: auto;
    font: 12px/1.55 var(--mono);
    min-height: 70px;
    white-space: pre;
  }

  .warn { color: var(--warn); font-size: 12px; margin: 0 0 8px; }
  .hint { color: var(--mut); font-size: 12px; margin: 0 0 8px; }
  .note { color: var(--mut); font-size: 12px; margin: 10px 0 0; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
  label[for="rev"] { font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1>If / Else Builder</h1>
  <p class="sub">Build branches on the left, or paste an existing expression on the right to load it back. Output is a Java expression for JasperReports 7, as a ternary or as IF() / AND() / OR().</p>

  <div class="bar">
    <span class="schema" id="schema-status">No .jrxml attached — names are typed by hand.</span>
    <button id="btnReload" title="Read fields, parameters and variables from the attached .jrxml again">Reload</button>
    <button id="btnUseActive" hidden title="Use the active .jrxml and the expression under its cursor">Use active file</button>
  </div>
  <div class="targetbar" id="target-bar" hidden></div>
  <div class="banner" id="banner" hidden></div>

  <div class="grid">
    <div id="editor"></div>
    <aside class="panel">
      <div class="opts">
        <label><input type="checkbox" id="ns"> Null-safe</label>
        <label><input type="checkbox" id="pretty"> Multi-line</label>
        <label>Style
          <select id="style">
            <option value="t">Ternary ( ? : )</option>
            <option value="f">IF() / AND() / OR()</option>
          </select>
        </label>
      </div>
      <pre id="out" aria-live="polite"></pre>
      <p class="warn" id="warn" hidden></p>
      <p class="warn" id="unknown" hidden></p>
      <div class="actions">
        <button class="pri" id="apply">Apply to File</button>
        <button id="copy">Copy expression</button>
      </div>
      <p class="hint" id="target-hint" hidden>No apply target. Place the cursor inside an expression tag, then use “Use active file”.</p>
      <p class="note" id="fnote" hidden>IF(), AND() and OR() evaluate every argument. Null-safe guards are written as inline (x != null ? … : false) so nothing throws.</p>
      <hr>
      <label for="rev"><b>Paste an expression to load it</b></label>
      <textarea id="rev" rows="5" spellcheck="false" placeholder='IF($F{status}.equals("PAID"), "Paid", "Unknown")'></textarea>
      <p class="warn" id="rerr" hidden></p>
      <button id="load">Load into builder</button>
      <p class="note">Java ternaries need compatible result types in every branch. Wrap numbers in String.valueOf(...) under an Expression result if you mix them with text.</p>
    </aside>
  </div>
</main>
<script nonce="${nonce}">
${coreScript}
const vscode = acquireVsCodeApi();
const INITIAL = ${initialJson};
const JR = window.__JRXML_IFELSE__;
const OPS = JR.OPS;
const NULLOPS = JR.NULLOPS;
const NOVAL = JR.NOVAL;
const KINDS = JR.KINDS;
const REF_KINDS = JR.REF_KINDS;

const $ = id => document.getElementById(id);

function h(tag, attrs, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (name === 'class') element.className = value;
    else if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
    else if (name === 'value') element.value = value;
    else element.setAttribute(name, value);
  }
  for (const child of children) element.append(child);
  return element;
}

function sel(options, value, onchange, label) {
  const element = h('select', { 'aria-label': label || '', onchange: event => onchange(event.target.value) },
    ...options.map(option => {
      const pair = Array.isArray(option) ? option : [option, option];
      return h('option', { value: pair[0] }, pair[1]);
    }));
  element.value = value;
  return element;
}

function inp(value, placeholder, oninput, className, label) {
  return h('input', {
    class: className || '',
    placeholder: placeholder,
    value: value,
    'aria-label': label || placeholder,
    oninput: event => oninput(event.target.value),
  });
}

function currentOptions() {
  return {
    nullSafe: $('ns').checked,
    multiline: $('pretty').checked,
    style: $('style').value === 'f' ? 'functions' : 'ternary',
  };
}

function saveState() {
  try {
    vscode.setState({ state: S, options: currentOptions() });
  } catch (_err) {
    /* state persistence is best effort */
  }
}

// ── State ────────────────────────────────────────────────────────────────────

let SCHEMA = INITIAL.schema || null;
let SCHEMA_JSON = JSON.stringify(SCHEMA);
let TARGET = { canApply: !!INITIAL.canApply, tagName: INITIAL.targetTagName || null };
let ACTIVE = INITIAL.activeFile || { fileName: null, isJrxml: false, differs: false };
let S = JR.emptyState();
let bannerTimer = null;

// ── Banners and status ───────────────────────────────────────────────────────

function showBanner(level, message) {
  const banner = $('banner');
  if (!message) { banner.hidden = true; return; }
  banner.className = 'banner ' + (level || 'info');
  banner.textContent = message;
  banner.hidden = false;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { banner.hidden = true; }, 7000);
}

function updateSchemaUi(payload) {
  const element = $('schema-status');
  const fileName = payload && payload.fileName ? payload.fileName : null;
  const schema = payload ? payload.schema : null;
  if (!schema) {
    element.textContent = payload && payload.error
      ? 'Could not read ' + (fileName || 'the report') + ': ' + payload.error
      : 'No .jrxml attached — names are typed by hand.';
    return;
  }
  const count = (value, singular, plural) =>
    value + ' ' + (value === 1 ? singular : plural);
  element.textContent = (fileName || 'report') + ': ' +
    count(schema.F.length, 'field', 'fields') + ', ' +
    count(schema.P.length, 'parameter', 'parameters') + ', ' +
    count(schema.V.length, 'variable', 'variables');
}

function updateUseActive() {
  $('btnUseActive').hidden = !(
    ACTIVE && ACTIVE.isJrxml && (ACTIVE.differs || !TARGET.canApply)
  );
}

function updateTargetUi() {
  const apply = $('apply');
  apply.disabled = !TARGET.canApply;
  $('target-hint').hidden = !!TARGET.canApply;
  const bar = $('target-bar');
  if (TARGET.canApply && TARGET.tagName) {
    bar.textContent = 'Apply target: <' + TARGET.tagName + '>';
    bar.hidden = false;
  } else if (ACTIVE && ACTIVE.fileName) {
    bar.textContent = 'No apply target in ' + ACTIVE.fileName + ' — place the cursor inside an expression tag.';
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

function setApplyBusy(busy) {
  const button = $('apply');
  button.disabled = busy || !TARGET.canApply;
  button.textContent = busy ? 'Applying…' : 'Apply to File';
}

function updateUnknown() {
  const element = $('unknown');
  if (!SCHEMA) { element.hidden = true; return; }
  const missing = [];
  const seen = new Set();
  for (const branch of S.branches) {
    for (const condition of branch.conds) {
      if (condition.type === 'Custom') continue;
      const name = String(condition.name || '').trim();
      if (!name) continue;
      const list = SCHEMA[condition.ref] || [];
      if (list.some(item => item.name === name)) continue;
      const ref = '$' + condition.ref + '{' + name + '}';
      if (!seen.has(ref)) { seen.add(ref); missing.push(ref); }
    }
  }
  if (missing.length === 0) { element.hidden = true; return; }
  element.textContent = 'Not declared in this report: ' + missing.slice(0, 6).join(', ') +
    (missing.length > 6 ? ', …' : '');
  element.hidden = false;
}

// ── Live output / state ──────────────────────────────────────────────────────

function update() {
  saveState();
  try {
    $('out').textContent = JR.buildExpression(S, currentOptions());
  } catch (err) {
    $('out').textContent = 'Error: ' + (err && err.message ? err.message : err);
  }
  $('fnote').hidden = $('style').value !== 'f';
  const kinds = new Set(S.branches.map(branch => branch.res.kind).concat([S.els.kind]));
  $('warn').hidden = !(kinds.has('text') && kinds.has('number'));
  $('warn').textContent = 'Results mix text and numbers. Check the types before you use this.';
  updateUnknown();
  updateTargetUi();
}

// ── Editor rows ──────────────────────────────────────────────────────────────

function resultRow(result) {
  const value = inp(
    result.val,
    result.kind === 'number' ? '0' : result.kind === 'expr' ? '$F{city}' : 'Result text',
    next => { result.val = next; update(); },
    'res',
    'Result value'
  );
  const wrap = h('div', { class: 'row' },
    sel(KINDS, result.kind, kind => {
      result.kind = kind;
      value.hidden = kind === 'null';
      value.placeholder = kind === 'number' ? '0' : kind === 'expr' ? '$F{city}' : 'Result text';
      update();
    }, 'Result type'),
    value
  );
  value.hidden = result.kind === 'null';
  return wrap;
}

function nameControl(condition) {
  const list = SCHEMA && SCHEMA[condition.ref];
  if (!list || list.length === 0) {
    return inp(condition.name, 'name', next => { condition.name = next; update(); }, 'name', 'Name');
  }

  const options = [['', 'Choose…']].concat(
    list.map(item => [item.name, item.name + ' (' + item.cls + ')'])
  );
  if (condition.name && !list.some(item => item.name === condition.name)) {
    options.splice(1, 0, [condition.name, condition.name]);
  }

  return sel(options, condition.name, name => {
    condition.name = name;
    const item = list.find(candidate => candidate.name === name);
    if (item) {
      const type = JR.typeOfClass(item.cls);
      if (type !== condition.type) {
        condition.type = type;
        condition.op = OPS[type][0][0];
        condition.val = '';
      }
    }
    render();
  }, 'Name');
}

function condRow(branch, condition) {
  const remove = h('button', {
    class: 'x',
    title: 'Remove condition',
    'aria-label': 'Remove condition',
    onclick: () => {
      if (branch.conds.length > 1) {
        branch.conds.splice(branch.conds.indexOf(condition), 1);
        render();
      }
    },
  }, '×');

  const typeSelect = sel(['String', 'Number', 'Boolean', 'Custom'], condition.type, type => {
    if (type === 'Custom') {
      condition.val = JR.conditionText(condition, {
        nullSafe: $('ns').checked,
        style: 'ternary',
        multiline: false,
      });
      condition.type = type;
    } else {
      condition.type = type;
      condition.op = OPS[type][0][0];
      condition.val = '';
    }
    render();
  }, 'Value type');

  if (condition.type === 'Custom') {
    return h('div', { class: 'row' },
      typeSelect,
      inp(condition.val, 'Boolean expression, e.g. $V{PAGE_NUMBER} > 1',
        next => { condition.val = next; update(); }, 'val', 'Custom condition'),
      remove
    );
  }

  const value = inp(
    condition.val,
    condition.type === 'Number' ? '5 or $P{limit}' : 'Value or $P{name}',
    next => { condition.val = next; update(); },
    'val',
    'Compare to'
  );
  value.hidden = NOVAL.includes(condition.op);

  return h('div', { class: 'row' },
    sel(REF_KINDS, condition.ref, ref => {
      condition.ref = ref;
      if (SCHEMA) condition.name = '';
      render();
    }, 'Reference kind'),
    nameControl(condition),
    typeSelect,
    sel(OPS[condition.type].concat(NULLOPS), condition.op, op => {
      condition.op = op;
      value.hidden = NOVAL.includes(op);
      update();
    }, 'Operator'),
    value,
    remove
  );
}

function branchCard(branch, index) {
  const head = h('div', { class: 'head' },
    h('span', { class: 'kw' }, index === 0 ? 'if' : 'else if')
  );
  if (branch.conds.length > 1) {
    head.append(sel(
      [['&&', 'all of these (AND)'], ['||', 'any of these (OR)']],
      branch.join,
      join => { branch.join = join; update(); },
      'Join conditions'
    ));
  }
  head.append(h('span', { class: 'sp' }));

  const move = (delta, label) => h('button', {
    class: 'x',
    'aria-label': label,
    title: label,
    onclick: () => {
      S.branches.splice(index + delta, 0, S.branches.splice(index, 1)[0]);
      render();
    },
  }, delta < 0 ? '↑' : '↓');

  if (index > 0) head.append(move(-1, 'Move up'));
  if (index < S.branches.length - 1) head.append(move(1, 'Move down'));
  head.append(h('button', {
    class: 'x',
    title: 'Remove branch',
    'aria-label': 'Remove branch',
    onclick: () => { S.branches.splice(index, 1); render(); },
  }, 'Remove'));

  return h('div', { class: 'branch' },
    head,
    ...branch.conds.map(condition => condRow(branch, condition)),
    h('button', {
      class: 'ghost',
      onclick: () => { branch.conds.push(JR.createCondition()); render(); },
    }, '+ Add condition'),
    h('div', { class: 'then' },
      h('span', { class: 'kw' }, 'then'),
      resultRow(branch.res)
    )
  );
}

function render() {
  const editor = $('editor');
  editor.textContent = '';
  S.branches.forEach((branch, index) => editor.appendChild(branchCard(branch, index)));
  editor.appendChild(h('button', {
    class: 'ghost add-branch',
    onclick: () => { S.branches.push(JR.createBranch()); render(); },
  }, '+ Add else if'));
  editor.appendChild(h('div', { class: 'branch else' },
    h('div', { class: 'head' }, h('span', { class: 'kw' }, 'else')),
    resultRow(S.els)
  ));
  update();
}

// ── Reverse conversion ───────────────────────────────────────────────────────

function loadExpressionText(text, sourceLabel) {
  const error = $('rerr');
  error.hidden = true;
  try {
    const parsed = JR.fromExpression(text);
    S = parsed.state;
    $('ns').checked = !!parsed.nullSafe;
    $('style').value = parsed.style === 'functions' ? 'f' : 't';
    $('rev').value = text;
    render();
    const count = S.branches.length;
    showBanner('info', 'Loaded ' + count + ' branch' + (count === 1 ? '' : 'es') +
      (sourceLabel ? ' from ' + sourceLabel : '') + '.');
    return true;
  } catch (err) {
    $('rev').value = text;
    error.textContent = 'Could not read the expression: ' +
      (err && err.message ? err.message : err);
    error.hidden = false;
    return false;
  }
}

// ── Wire controls ────────────────────────────────────────────────────────────

['ns', 'pretty', 'style'].forEach(id => $(id).addEventListener('change', update));

$('copy').addEventListener('click', () => {
  vscode.postMessage({ command: 'copyExpression', text: $('out').textContent });
  const button = $('copy');
  const label = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = label; }, 1600);
});

$('apply').addEventListener('click', () => {
  if ($('apply').disabled) return;
  setApplyBusy(true);
  vscode.postMessage({ command: 'applyExpression', text: $('out').textContent });
});

$('load').addEventListener('click', () => {
  const error = $('rerr');
  if (!$('rev').value.trim()) {
    error.textContent = 'Could not read the expression: Paste an expression first.';
    error.hidden = false;
    return;
  }
  loadExpressionText($('rev').value, null);
});

$('btnReload').addEventListener('click', () => {
  vscode.postMessage({ command: 'requestSchema' });
});

$('btnUseActive').addEventListener('click', () => {
  vscode.postMessage({ command: 'useActiveFile' });
});

// ── Messages from the extension ──────────────────────────────────────────────

window.addEventListener('message', event => {
  const message = event.data || {};
  switch (message.command) {
    case 'schema': {
      const next = message.schema || null;
      const nextJson = JSON.stringify(next);
      const changed = nextJson !== SCHEMA_JSON;
      SCHEMA = next;
      SCHEMA_JSON = nextJson;
      updateSchemaUi(message);
      if (changed) render();
      updateUseActive();
      break;
    }
    case 'loadExpression':
      loadExpressionText(String(message.text || ''),
        message.tagName ? 'the current expression' : null);
      break;
    case 'target':
      TARGET = { canApply: !!message.canApply, tagName: message.tagName || null };
      setApplyBusy(false);
      updateTargetUi();
      updateUseActive();
      break;
    case 'activeFile':
      ACTIVE = {
        fileName: message.fileName || null,
        isJrxml: !!message.isJrxml,
        differs: !!message.differs,
      };
      updateUseActive();
      updateTargetUi();
      break;
    case 'notice':
      showBanner(message.level || 'info', message.message || '');
      break;
    case 'applyResult':
      setApplyBusy(false);
      showBanner(message.ok ? 'info' : 'error', message.message || '');
      break;
    default:
      break;
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────

let restoredFromState = false;
try {
  const saved = vscode.getState();
  if (saved && saved.state && Array.isArray(saved.state.branches)) {
    S = saved.state;
    restoredFromState = true;
    const savedOptions = saved.options || {};
    $('ns').checked = savedOptions.nullSafe !== false;
    $('pretty').checked = savedOptions.multiline !== false;
    $('style').value = savedOptions.style === 'functions' ? 'f' : 't';
  }
} catch (_err) {
  restoredFromState = false;
}

if (!restoredFromState) {
  $('ns').checked = INITIAL.options.nullSafe !== false;
  $('pretty').checked = INITIAL.options.multiline !== false;
  $('style').value = INITIAL.options.style === 'functions' ? 'f' : 't';
}

if (restoredFromState) {
  render();
} else if (INITIAL.expression && String(INITIAL.expression).trim()) {
  if (!loadExpressionText(String(INITIAL.expression),
      INITIAL.targetTagName ? 'the current expression' : null)) render();
} else {
  render();
}

updateSchemaUi({ fileName: INITIAL.fileName, schema: INITIAL.schema, error: INITIAL.schemaError });
updateUseActive();
updateTargetUi();
</script>
</body>
</html>`;
}

module.exports = { buildIfElsePanelHtml, buildCoreScript, getNonce };
