// designViewStyles.js
// CSS for the JRXML design-view webview, kept as a plain string asset.

module.exports = `  :root {
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
  .actions button.primary,
  .actions button.active { background: var(--btn-bg); color: var(--btn-fg); border-color: transparent; }
  .mode-group { display: inline-flex; }
  .mode-group button { border-radius: 0; }
  .mode-group button:first-child { border-radius: 3px 0 0 3px; }
  .mode-group button:last-child { border-radius: 0 3px 3px 0; border-left: none; }
  #follow-cursor[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
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

  #workspace { flex: 1; display: flex; min-height: 0; overflow: hidden; }
  #viewport { flex: 1; overflow: auto; position: relative; min-width: 0; }
  #canvas { position: relative; min-height: 100%; padding: 16px 16px 32px; }

  .page {
    position: relative;
    background: #ffffff;
    color: #111111;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.16), 0 6px 22px rgba(0,0,0,0.4);
  }

  /* Elements are clipped to the paper; band labels live outside this layer. */
  .page-content {
    position: absolute;
    inset: 0;
    overflow: hidden;
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
  .band-row.band-selected {
    background: rgba(0,120,215,0.08);
    border-top-color: var(--accent);
  }

  .editing .element { cursor: move; }
  .editing .element.selected { overflow: visible !important; }
  .editing .element.placeholder.selected { background: rgba(110,110,110,0.06); }
  .resize-handle {
    position: absolute;
    width: 7px;
    height: 7px;
    background: #ffffff;
    border: 1px solid var(--accent);
    border-radius: 1px;
    z-index: 30;
  }
  .resize-handle.nw { left: -4px; top: -4px; cursor: nwse-resize; }
  .resize-handle.n  { left: calc(50% - 3px); top: -4px; cursor: ns-resize; }
  .resize-handle.ne { right: -4px; top: -4px; cursor: nesw-resize; }
  .resize-handle.e  { right: -4px; top: calc(50% - 3px); cursor: ew-resize; }
  .resize-handle.se { right: -4px; bottom: -4px; cursor: nwse-resize; }
  .resize-handle.s  { left: calc(50% - 3px); bottom: -4px; cursor: ns-resize; }
  .resize-handle.sw { left: -4px; bottom: -4px; cursor: nesw-resize; }
  .resize-handle.w  { left: -4px; top: calc(50% - 3px); cursor: ew-resize; }
  body.dragging, body.dragging * { user-select: none !important; }
  body.dragging .element { cursor: move; }

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

  #inspector {
    flex: 0 0 290px;
    width: 290px;
    border-left: 1px solid var(--border);
    overflow: auto;
    background: rgba(127,127,127,0.05);
  }
  .inspector-header {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .inspector-kind { font-weight: 600; font-size: 13px; }
  .inspector-position { font-size: 11px; color: var(--muted); font-family: var(--vscode-editor-font-family, monospace); }
  .link-button {
    align-self: flex-start;
    margin-top: 4px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }
  .link-button:hover { text-decoration: underline; }
  .inspector-body { padding: 10px 12px 16px; display: flex; flex-direction: column; gap: 10px; }
  .inspector-section {
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 8px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
  }
  .inspector-section h3 {
    grid-column: 1 / -1;
    margin: 0 0 1px;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .field { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--muted); min-width: 0; }
  .field.full { grid-column: 1 / -1; }
  .field input[type="text"],
  .field input[type="number"],
  .field select,
  .field textarea {
    width: 100%;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #d4d4d4);
    border: 1px solid var(--border);
    border-radius: 2px;
    padding: 3px 5px;
    font-family: inherit;
    font-size: 12px;
  }
  .field textarea {
    resize: vertical;
    min-height: 64px;
    font-family: var(--vscode-editor-font-family, monospace);
    line-height: 1.35;
  }
  .field input.invalid { border-color: #f48771; }
  .check { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--fg); padding-top: 14px; }
  .hint.full, .check.full { grid-column: 1 / -1; }
  .completion-popup {
    grid-column: 1 / -1;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--vscode-editorWidget-background, #252526);
    max-height: 170px;
    overflow: auto;
  }
  .completion-popup-title {
    position: sticky;
    top: 0;
    padding: 3px 6px;
    border-bottom: 1px solid var(--border);
    background: var(--vscode-editorWidget-background, #252526);
    font-size: 10px;
    color: var(--muted);
  }
  .completion-list { list-style: none; margin: 0; padding: 2px; }
  .completion-item {
    padding: 3px 6px;
    border-radius: 2px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .completion-item.active {
    background: var(--vscode-list-activeSelectionBackground, #094771);
    color: var(--vscode-list-activeSelectionForeground, #ffffff);
  }
  .completion-label {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .completion-detail {
    font-size: 10px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .completion-item.active .completion-detail { color: inherit; opacity: 0.8; }
  .inspector-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .inspector-actions button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    border-radius: 3px;
    padding: 4px 9px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
  }
  .inspector-actions button:disabled { opacity: 0.5; cursor: default; }
  .hint { font-size: 10px; color: var(--muted); }
  .field-error { grid-column: 1 / -1; color: #f48771; font-size: 11px; min-height: 0; }
  #attributes-list {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 220px;
    overflow: auto;
  }
  .attr-row {
    display: grid;
    grid-template-columns: 0.9fr 1.4fr auto;
    gap: 4px;
    align-items: center;
  }
  .attr-name {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attr-row input,
  .attributes-add input {
    width: 100%;
    min-width: 0;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #d4d4d4);
    border: 1px solid var(--border);
    border-radius: 2px;
    padding: 2px 4px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10px;
  }
  .attr-row button,
  .attributes-add button {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 2px;
    height: 21px;
    padding: 0 6px;
    font-size: 10px;
    font-family: inherit;
    cursor: pointer;
  }
  .attr-row button:hover,
  .attributes-add button:hover { background: rgba(127,127,127,0.16); }
  .attributes-add {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 0.9fr 1.4fr auto;
    gap: 4px;
  }
  #inspector.editing-pending input,
  #inspector.editing-pending select,
  #inspector.editing-pending textarea,
  #inspector.editing-pending button { opacity: 0.6; pointer-events: none; }

  @media (max-width: 700px) {
    #inspector { flex-basis: 240px; width: 240px; }
  }

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
  #status-hint { overflow: hidden; text-overflow: ellipsis; }`;
