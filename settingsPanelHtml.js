// settingsPanelHtml.js
// Pure HTML/CSS/client-JS builder for the JRXML settings panel.
//
// Kept free of the `vscode` module so the document (and its CSP hardening) can
// be unit-tested with plain Node. The host passes the schema, the current values
// and a fresh nonce for every render.

const { escapeHtmlText, jsonForInlineScript, getNonce } = require('./expressionPanelHtml');

/**
 * @param {object} opts
 * @param {{id:string,title:string,description?:string,settings:object[]}[]} opts.groups
 * @param {Record<string, unknown>} opts.values current values, keyed by setting key
 * @param {string} opts.nonce
 * @param {string} [opts.section] settings section name, e.g. "jrxml"
 * @returns {string} full HTML document
 */
function buildSettingsHtml({ groups, values, nonce, section = 'jrxml' }) {
    const safeSection = escapeHtmlText(section);
    const groupsJson  = jsonForInlineScript(groups || []);
    const valuesJson  = jsonForInlineScript(values || {});

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>JRXML Settings</title>
<style nonce="${nonce}">
  :root {
    --bg:       var(--vscode-editor-background, #1e1e1e);
    --fg:       var(--vscode-editor-foreground, #d4d4d4);
    --border:   var(--vscode-panel-border, #444);
    --input-bg: var(--vscode-input-background, #2d2d2d);
    --input-fg: var(--vscode-input-foreground, #d4d4d4);
    --btn-bg:   var(--vscode-button-background, #0e639c);
    --btn-fg:   var(--vscode-button-foreground, #fff);
    --btn-hover:var(--vscode-button-hoverBackground, #1177bb);
    --muted:    #888;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: 13px;
    padding: 0 0 24px;
  }
  header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  header h1 { font-size: 15px; font-weight: 600; }
  header code { color: var(--muted); font-size: 12px; }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg);
    padding: 10px 16px;
    display: flex;
    gap: 8px;
    align-items: center;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .toolbar input[type="search"] {
    flex: 1;
    min-width: 180px;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 4px 8px;
    font: inherit;
  }
  button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: 4px 12px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background: var(--btn-hover); }
  button.secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
  }
  button.secondary:hover { background: rgba(255,255,255,0.07); }
  button.small { padding: 2px 8px; font-size: 12px; }
  .groups { padding: 8px 16px; }
  .group { margin: 16px 0 24px; }
  .group h2 {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .group-desc { color: var(--muted); margin: 2px 0 10px; font-size: 12px; }
  .setting {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    padding: 8px 0;
    border-top: 1px solid rgba(255,255,255,0.06);
  }
  .setting-main { flex: 1; min-width: 0; }
  .setting-label { font-weight: 600; cursor: pointer; }
  .setting-key {
    margin-left: 8px;
    font-size: 11px;
    color: var(--muted);
  }
  .setting-desc { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .setting-control { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
  .setting-control input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
  .setting-control input[type="number"],
  .setting-control input[type="text"] {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 3px 6px;
    font: inherit;
    width: 180px;
  }
  .setting-control input[type="number"] { width: 70px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; max-width: 260px; }
  .chip {
    background: rgba(255,255,255,0.08);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1px 8px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .muted { color: var(--muted); }
  .empty { padding: 24px 16px; color: var(--muted); }
  [hidden] { display: none !important; }
</style>
</head>
<body>

<header>
  <h1>JRXML Settings</h1>
  <code>${safeSection}.*</code>
</header>

<div class="toolbar">
  <input id="search" type="search" placeholder="Filter settings…" aria-label="Filter settings">
  <button id="btnNative" class="secondary">Open VS Code settings</button>
  <button id="btnReset" class="secondary">Reset all to defaults</button>
</div>

<div id="groups" class="groups"></div>
<div id="empty" class="empty" hidden>No settings match.</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

const GROUPS = ${groupsJson};
let values   = ${valuesJson};

const groupsEl = document.getElementById('groups');
const emptyEl  = document.getElementById('empty');
const searchEl = document.getElementById('search');

function send(key, value) {
  vscode.postMessage({ command: 'update', key: key, value: value });
}

function text(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = content;
  return el;
}

function buildControl(setting, value) {
  const wrap = text('div', 'setting-control', '');
  const id   = 'set-' + setting.key;

  if (setting.type === 'boolean') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = !!value;
    cb.addEventListener('change', () => send(setting.key, cb.checked));
    wrap.appendChild(cb);
    return { wrap, id };
  }

  if (setting.type === 'number') {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.id = id;
    inp.value = value;
    inp.addEventListener('change', () => send(setting.key, Number(inp.value)));
    wrap.appendChild(inp);
    return { wrap, id };
  }

  if (setting.type === 'string') {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.id = id;
    inp.value = value === null || value === undefined ? '' : String(value);
    inp.addEventListener('change', () => send(setting.key, inp.value));
    wrap.appendChild(inp);
    return { wrap, id };
  }

  const list = text('div', 'chips', '');
  const items = Array.isArray(value) ? value : [];
  if (items.length === 0) {
    list.appendChild(text('span', 'muted', '(none)'));
  } else {
    for (const item of items) list.appendChild(text('span', 'chip', String(item)));
  }
  const clear = text('button', 'secondary small', 'Clear');
  clear.addEventListener('click', () => send(setting.key, []));
  wrap.appendChild(list);
  wrap.appendChild(clear);
  return { wrap, id };
}

function render() {
  const query = searchEl.value.trim().toLowerCase();
  groupsEl.textContent = '';

  let shown = 0;
  for (const group of GROUPS) {
    const visible = group.settings.filter(setting => {
      if (!query) return true;
      const haystack = (setting.key + ' ' + (setting.label || '') + ' ' + (setting.description || '')).toLowerCase();
      return haystack.indexOf(query) !== -1;
    });
    if (visible.length === 0) continue;

    const section = text('section', 'group', '');
    section.appendChild(text('h2', '', group.title));
    if (group.description) section.appendChild(text('p', 'group-desc', group.description));

    for (const setting of visible) {
      const row  = text('div', 'setting', '');
      const main = text('div', 'setting-main', '');

      const control = buildControl(setting, values[setting.key]);

      const label = text('label', 'setting-label', setting.label || setting.key);
      label.htmlFor = control.id;
      main.appendChild(label);
      main.appendChild(text('code', 'setting-key', 'jrxml.' + setting.key));
      if (setting.description) main.appendChild(text('div', 'setting-desc', setting.description));

      row.appendChild(main);
      row.appendChild(control.wrap);
      section.appendChild(row);
      shown++;
    }

    groupsEl.appendChild(section);
  }

  emptyEl.hidden = shown !== 0;
}

searchEl.addEventListener('input', render);
document.getElementById('btnNative').addEventListener('click', () => vscode.postMessage({ command: 'openNative' }));
document.getElementById('btnReset').addEventListener('click', () => vscode.postMessage({ command: 'reset' }));

window.addEventListener('message', event => {
  const message = event.data;
  if (message && message.command === 'state') {
    values = message.values || {};
    render();
  }
});

render();
</script>
</body>
</html>`;
}

module.exports = { buildSettingsHtml, getNonce };
