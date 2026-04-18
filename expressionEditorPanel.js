// expressionEditorPanel.js
// Manages the WebviewPanel that shows / edits a JRXML expression.

const vscode = require('vscode');
const { formatExpression } = require('./expressionFormatter');
const { hasCdata, wrapExpression } = require('./expressionUtils');

class ExpressionEditorPanel {
    static currentPanel = undefined;
    static viewType     = 'jrxmlExpressionEditor';

    constructor(panel, extensionUri, expressionResult, sourceEditor) {
        this._panel         = panel;
        this._extensionUri  = extensionUri;
        this._expressionResult = expressionResult;
        this._sourceEditor  = sourceEditor;
        this._disposables   = [];

        this._update();
        formatExpression
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    static createOrShow(extensionUri, expressionResult, sourceEditor) {
        const column = vscode.ViewColumn.Beside;

        if (ExpressionEditorPanel.currentPanel) {
            ExpressionEditorPanel.currentPanel._expressionResult = expressionResult;
            ExpressionEditorPanel.currentPanel._sourceEditor     = sourceEditor;
            ExpressionEditorPanel.currentPanel._panel.reveal(column);
            ExpressionEditorPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ExpressionEditorPanel.viewType,
            'JRXML Expression Editor',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        ExpressionEditorPanel.currentPanel = new ExpressionEditorPanel(
            panel, extensionUri, expressionResult, sourceEditor
        );
    }

    _handleMessage(message) {
        try {
            switch (message.command) {
                case 'applyExpression':
                    this._applyToSource(message.expression);
                    break;
                case 'formatExpression':
                    this._sendFormatted(message.expression);
                    break;
                case 'copyExpression':
                    vscode.env.clipboard.writeText(message.expression);
                    vscode.window.showInformationMessage('Expression copied to clipboard.');
                    break;
            }
        } catch (err) {
            console.error('[JRXML Expression Editor] Error handling message:', err);
            this._panel.webview.postMessage({
                command: 'editorError',
                message: `Error: ${err.message || String(err)}`
            });
        }
    }

    _applyToSource(newExpression) {
        const editor = this._sourceEditor;
        if (!editor) { vscode.window.showWarningMessage('Source editor is no longer open.'); return; }

        const tagName = this._expressionResult.tagName;

        // Always re-scan the CURRENT document text — never use the stale
        // range/fullMatch from when the panel first opened. This prevents
        // double-application on repeated Apply clicks.
        const doc  = editor.document;
        const text = doc.getText();

        const tagPattern = new RegExp(
            `(<${tagName}(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/${tagName}>)`,
            'g'
        );

        // Pick the occurrence closest to the original cursor position
        const originalOffset = doc.offsetAt(this._expressionResult.range.start);
        let bestMatch    = null;
        let bestDistance = Infinity;
        let m;

        while ((m = tagPattern.exec(text)) !== null) {
            const dist = Math.abs(m.index - originalOffset);
            if (dist < bestDistance) {
                bestDistance = dist;
                bestMatch    = { index: m.index, openTag: m[1], innerOld: m[2], closeTag: m[3] };
            }
        }

        if (!bestMatch) {
            vscode.window.showErrorMessage(
                `Could not find <${tagName}> in the document. It may have been moved or renamed.`
            );
            return;
        }

        const { openTag, innerOld, closeTag } = bestMatch;
        const matchStart = bestMatch.index;
        const matchEnd   = matchStart + openTag.length + innerOld.length + closeTag.length;

        // Preserve CDATA wrapping if the original used it
        const useCdata = hasCdata(innerOld);
        const newInner = wrapExpression(newExpression, useCdata);
        const newTag   = openTag + newInner + closeTag;

        const liveRange = new vscode.Range(
            doc.positionAt(matchStart),
            doc.positionAt(matchEnd)
        );

        editor.edit(editBuilder => {
            editBuilder.replace(liveRange, newTag);
        }).then(success => {
            if (success) {
                // Update stored result so the next Apply still finds the right spot
                this._expressionResult = {
                    ...this._expressionResult,
                    expression: newExpression,
                    fullMatch:  newTag,
                    range: new vscode.Range(
                        doc.positionAt(matchStart),
                        doc.positionAt(matchStart + newTag.length)
                    )
                };
                vscode.window.showInformationMessage(`Expression applied to <${tagName}>.`);
                // Close the panel — the expression is now in the file
                this.dispose();
            } else {
                vscode.window.showErrorMessage('Failed to apply expression.');
            }
        });
    }

        _sendFormatted(expression) {
        try {
            const cfg = vscode.workspace.getConfiguration('jrxml');
            const indentSize = cfg.get('indentSize', 4);
            const formatted = formatExpression(expression, indentSize);
            this._panel.webview.postMessage({ command: 'expressionFormatted', expression: formatted });
        } catch (err) {
            console.error('[JRXML Expression Editor] Formatter error:', err);
            // Send original expression back unchanged — panel stays alive
            this._panel.webview.postMessage({
                command: 'expressionFormatted',
                expression: expression,
                warning: `Formatter error: ${err.message || String(err)}`
            });
        }
    }

    _update() {
        let formatted = this._expressionResult.expression;
        try {
            const cfg = vscode.workspace.getConfiguration('jrxml');
            const indentSize = cfg.get('indentSize', 4);
            formatted = formatExpression(this._expressionResult.expression, indentSize);
        } catch (err) {
            console.error('[JRXML Expression Editor] Error during initial format — showing raw expression:', err);
            // Fall through: formatted stays as raw expression
        }

        this._panel.title = `Expression: <${this._expressionResult.tagName}>`;
        this._panel.webview.html = this._getHtml(
            this._expressionResult.tagName,
            this._expressionResult.expression,
            formatted
        );
    }

    _getHtml(tagName, rawExpression, formattedExpression) {
        // Escape for safe embedding in HTML
        const escape = s => s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JRXML Expression Editor</title>
<style>
  :root {
    --bg:        var(--vscode-editor-background, #1e1e1e);
    --fg:        var(--vscode-editor-foreground, #d4d4d4);
    --border:    var(--vscode-panel-border, #444);
    --input-bg:  var(--vscode-input-background, #2d2d2d);
    --input-fg:  var(--vscode-input-foreground, #d4d4d4);
    --btn-bg:    var(--vscode-button-background, #0e639c);
    --btn-fg:    var(--vscode-button-foreground, #fff);
    --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
    --tag-color: #4ec9b0;
    --font-mono: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace);
    --font-size: var(--vscode-editor-font-size, 13px);

    /* Syntax colors */
    --c-keyword:    #569cd6;
    --c-type:       #4ec9b0;
    --c-func:       #dcdcaa;
    --c-jasper:     #4fc1ff; /* Bright Cyan-Blue */
    --c-jasper-fn:  #c586c0;
    --c-string:     #00b2d1; /* Cyan */
    --c-number:     #7800b4; /* Purple */
    --c-comment:    #6a9955;
    --c-field:      #98c379; /* Soft Mint Green */
    --c-param:      #e06c75; /* Soft Rose/Coral Red */
    --c-var:        #61afef; /* Soft Sky Blue */

    /* Bracket colors */
    --b1: #ffd700;
    --b2: #da70d6;
    --b3: #87ceeb;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: 13px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .tag-label {
    font-size: 11px;
    color: var(--tag-color);
    font-family: var(--font-mono);
    background: rgba(78,201,176,0.12);
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid rgba(78,201,176,0.3);
  }

  .header-title { font-weight: 600; font-size: 13px; flex: 1; }

  .toolbar {
    padding: 6px 12px;
    display: flex;
    gap: 6px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: 4px 12px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
  }
  button:hover { background: var(--btn-hover); }
  button.secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
  }
  button.secondary:hover { background: rgba(255,255,255,0.07); }

  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
    gap: 0;
  }

  .pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    border-right: 1px solid var(--border);
  }
  .pane:last-child { border-right: none; }

  .pane-header {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #888;
    background: rgba(255,255,255,0.03);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  textarea {
    flex: 1;
    background: var(--input-bg);
    color: var(--input-fg);
    border: none;
    outline: none;
    font-family: var(--font-mono);
    font-size: var(--font-size);
    padding: 10px;
    resize: none;
    tab-size: 4;
    line-height: 1.6;
  }

  .preview {
    flex: 1;
    overflow: auto;
    padding: 10px;
    font-family: var(--font-mono);
    font-size: var(--font-size);
    line-height: 1.6;
    white-space: pre;
    background: var(--input-bg);
  }

  .statusbar {
    padding: 3px 12px;
    font-size: 11px;
    color: #888;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    gap: 16px;
  }


  .error-banner {
    display: none;
    padding: 5px 12px;
    font-size: 12px;
    background: rgba(255, 80, 80, 0.15);
    border-top: 1px solid rgba(255, 80, 80, 0.4);
    color: #f48771;
    flex-shrink: 0;
  }
  .warn-banner {
    display: none;
    padding: 4px 12px;
    font-size: 11px;
    background: rgba(255, 200, 50, 0.1);
    border-top: 1px solid rgba(255, 200, 50, 0.3);
    color: #cca700;
    flex-shrink: 0;
  }
  /* ── Syntax highlight spans ───────────────────────────────────────────── */
  .kw   { color: var(--c-keyword); }
  .type { color: var(--c-type); }
  .fn   { color: var(--c-func); }
  .jfn  { color: var(--c-jasper-fn); font-weight: bold; }
  .str  { color: var(--c-string); }
  .num  { color: var(--c-number); }
  .cmt  { color: var(--c-comment); font-style: italic; }
  .field { color: var(--c-field); }
  .param { color: var(--c-param); }
  .var  { color: var(--c-var); }
  .jvar { color: #9cdcfe; font-style: italic; }
  .op   { color: #d4d4d4; }

  /* Bracket levels */
  .b1 { color: var(--b1); }
  .b2 { color: var(--b2); }
  .b3 { color: var(--b3); }
</style>
</head>
<body>

<header>
  <div class="header-title">Expression Editor</div>
  <span class="tag-label">&lt;${escape(tagName)}&gt;</span>
</header>

<div class="toolbar">
  <button onclick="doFormat()">⚡ Format</button>
  <button onclick="doApply()" style="background:var(--vscode-statusBarItem-activeBackground,#16825d);color:#fff">✔ Apply to File</button>
  <button class="secondary" onclick="doCopy()">⎘ Copy</button>
  <button class="secondary" onclick="doReset()">↺ Reset</button>
  <label style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:#888">
    <input type="checkbox" id="autoFormat" onchange="toggleAutoFormat(this)"> Auto-format on change
  </label>
</div>

<div class="main">
  <div class="pane">
    <div class="pane-header">Edit</div>
    <textarea id="editor" spellcheck="false" oninput="onEditorInput()">${escape(formattedExpression)}</textarea>
  </div>
  <div class="pane">
    <div class="pane-header">Preview (highlighted)</div>
    <div class="preview" id="preview"></div>
  </div>
</div>

<div class="statusbar">
  <span id="stat-chars">Chars: ${formattedExpression.length}</span>
  <span id="stat-lines">Lines: ${formattedExpression.split('\n').length}</span>
  <span id="stat-depth">Max depth: 0</span>
</div>

<div class="warn-banner" id="warn-banner"></div>
<div class="error-banner" id="error-banner"></div>

<script>
const vscode = acquireVsCodeApi();
const RAW    = ${JSON.stringify(rawExpression)};
let autoFmt  = false;

const editor  = document.getElementById('editor');
const preview = document.getElementById('preview');

// ── Messaging ────────────────────────────────────────────────────────────────
const warnBanner  = document.getElementById('warn-banner');
const errorBanner = document.getElementById('error-banner');

function showError(msg) {
  errorBanner.textContent = '⚠ ' + msg;
  errorBanner.style.display = 'block';
  setTimeout(() => { errorBanner.style.display = 'none'; }, 6000);
}
function showWarn(msg) {
  warnBanner.textContent = 'ℹ ' + msg;
  warnBanner.style.display = 'block';
  setTimeout(() => { warnBanner.style.display = 'none'; }, 4000);
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.command === 'expressionFormatted') {
    editor.value = msg.expression;
    refreshPreview();
    updateStats();
    if (msg.warning) showWarn(msg.warning);
  } else if (msg.command === 'editorError') {
    showError(msg.message);
  }
});

// ── Commands ─────────────────────────────────────────────────────────────────
function doFormat() {
  vscode.postMessage({ command: 'formatExpression', expression: editor.value });
}
function doApply() {
  vscode.postMessage({ command: 'applyExpression', expression: editor.value });
}
function doCopy() {
  vscode.postMessage({ command: 'copyExpression', expression: editor.value });
}
function doReset() {
  editor.value = RAW;
  refreshPreview();
  updateStats();
}
function toggleAutoFormat(cb) {
  autoFmt = cb.checked;
  if (autoFmt) doFormat();
}
function onEditorInput() {
  refreshPreview();
  updateStats();
  if (autoFmt) doFormat();
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const txt = editor.value;
  document.getElementById('stat-chars').textContent = 'Chars: ' + txt.length;
  document.getElementById('stat-lines').textContent = 'Lines: ' + txt.split('\\n').length;
  document.getElementById('stat-depth').textContent = 'Max depth: ' + maxDepth(txt);
}
function maxDepth(s) {
  let d = 0, max = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') d++;
    else if (ch === ')' || ch === ']' || ch === '}') d--;
    if (d > max) max = d;
  }
  return max;
}

// ── Syntax highlighter ────────────────────────────────────────────────────────
const KEYWORDS = new Set([
  'if','else','for','while','do','switch','case','break','continue',
  'return','try','catch','finally','throw','throws','new','instanceof',
  'null','true','false','this','super','static','final','abstract',
  'public','private','protected','void','class','interface','enum',
  'extends','implements','import','package'
]);

const TYPES = new Set([
  'String','Integer','Long','Double','Float','Boolean','Byte','Short',
  'Character','Number','Object','BigDecimal','BigInteger','Date',
  'LocalDate','LocalDateTime','List','Map','Set','Collection',
  'ArrayList','HashMap','Iterator','Optional','StringBuilder',
  'StringBuffer','Math','System','int','long','double','float',
  'boolean','byte','short','char'
]);

const JASPER_FUNCS = new Set([
  'TODAY','NOW','DATE','IF','AND','OR','NOT','CONTAINS','STARTSWITH',
  'ENDSWITH','LEN','LEFT','RIGHT','MID','UPPER','LOWER','TRIM',
  'REPLACE','CONCATENATE','TEXT','VALUE','INT','ROUND','ROUNDDOWN',
  'ROUNDUP','FLOOR','CEILING','ABS','MOD','POWER','SQRT','SUM',
  'MIN','MAX','AVG','COUNT','COUNTIF','SUMIF','FIRST','STDEV','VAR'
]);

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function highlight(code) {
  let out = '';
  let i   = 0;
  const len = code.length;

  function peek(n) { return code.slice(i, i+n); }

  while (i < len) {
    // newline
    if (code[i] === '\\n') { out += '\\n'; i++; continue; }

    // Line comment
    if (peek(2) === '//') {
      let j = i;
      while (j < len && code[j] !== '\\n') j++;
      out += '<span class="cmt">' + escapeHtml(code.slice(i, j)) + '</span>';
      i = j; continue;
    }

    // Block comment
    if (peek(2) === '/*') {
      let j = i + 2;
      while (j < len - 1 && !(code[j] === '*' && code[j+1] === '/')) j++;
      j += 2;
      out += '<span class="cmt">' + escapeHtml(code.slice(i, j)) + '</span>';
      i = j; continue;
    }

    // String literal
    if (code[i] === '"' || code[i] === "'") {
      const q = code[i];
      let j = i + 1;
      while (j < len) {
        if (code[j] === '\\\\') { j += 2; continue; }
        if (code[j] === q) { j++; break; }
        j++;
      }
      out += '<span class="str">' + escapeHtml(code.slice(i, j)) + '</span>';
      i = j; continue;
    }

    // Jasper $F{} $P{} $V{} $R{}
    const jm = code.slice(i).match(/^(\\$[FPVR])\\{([\\w.]+)\\}/);
    if (jm) {
      const cls = jm[1] === '\\$F' ? 'field' : jm[1] === '\\$P' ? 'param' : jm[1] === '\\$R' ? 'jfn' : 'var';
      out += '<span class="jvar">' + escapeHtml(jm[1]) + '</span>'
           + '<span class="op">{</span>'
           + '<span class="' + cls + '">' + escapeHtml(jm[2]) + '</span>'
           + '<span class="op">}</span>';
      i += jm[0].length; continue;
    }

    // $X{...}
    const jx = code.slice(i).match(/^(\\$X)\\{([^}]*)\\}/);
    if (jx) {
      out += '<span class="jfn">' + escapeHtml(jx[1]) + '</span>'
           + '<span class="op">{</span>'
           + '<span class="field">' + escapeHtml(jx[2]) + '</span>'
           + '<span class="op">}</span>';
      i += jx[0].length; continue;
    }

    // Identifier
    const wm = code.slice(i).match(/^[a-zA-Z_$][\\w$]*/);
    if (wm) {
      const word = wm[0];
      // Peek for following '('
      const afterIdx = i + word.length;
      const followedByParen = afterIdx < len && code.slice(afterIdx).trimStart()[0] === '(';

      let cls;
      if (KEYWORDS.has(word))           cls = 'kw';
      else if (TYPES.has(word))         cls = 'type';
      else if (JASPER_FUNCS.has(word) && followedByParen) cls = 'jfn';
      else if (followedByParen)          cls = 'fn';
      else if (/^[A-Z]/.test(word))     cls = 'type';
      else                              cls = null;

      if (cls) {
        out += '<span class="' + cls + '">' + escapeHtml(word) + '</span>';
      } else {
        out += escapeHtml(word);
      }
      i += word.length; continue;
    }

    // Number
    const nm = code.slice(i).match(/^\\d+\\.?\\d*([eE][+-]?\\d+)?[fFdDlL]?/);
    if (nm) {
      out += '<span class="num">' + escapeHtml(nm[0]) + '</span>';
      i += nm[0].length; continue;
    }

    // Brackets with level coloring
    const bOpen  = { '(': 1, '[': 1, '{': 1 };
    const bClose = { ')': 1, ']': 1, '}': 1 };
    if (code[i] in bOpen || code[i] in bClose) {
      // We track depth with a stack embedded via a simple counter
      out += '<span class="bracket-ch" data-ch="' + escapeHtml(code[i]) + '">' + escapeHtml(code[i]) + '</span>';
      i++; continue;
    }

    // Operators and punctuation
    const op2 = peek(2);
    if (['&&','||','==','!=','<=','>=','->','::'].includes(op2)) {
      out += '<span class="op">' + escapeHtml(op2) + '</span>';
      i += 2; continue;
    }

    out += escapeHtml(code[i]);
    i++;
  }
  return out;
}

function colorBrackets(html) {
  // Post-process: walk bracket-ch spans and assign depth colors
  const colors = ['b1','b2','b3'];
  let depth = 0;
  return html.replace(/<span class="bracket-ch" data-ch="([^"]+)">([^<]*)<\\/span>/g, (m, ch) => {
    const opens  = ['(','[','{'];
    const closes = [')',']','}'];
    if (opens.includes(ch)) {
      const cls = colors[depth % colors.length];
      depth++;
      return '<span class="' + cls + '">' + escapeHtml(ch) + '</span>';
    } else {
      depth = Math.max(0, depth - 1);
      const cls = colors[depth % colors.length];
      return '<span class="' + cls + '">' + escapeHtml(ch) + '</span>';
    }
  });
}

function refreshPreview() {
  try {
    const raw = editor.value;
    let html = highlight(raw);
    html = colorBrackets(html);
    preview.innerHTML = html;
  } catch (err) {
    // Highlighter crashed — show plain text so panel never goes blank
    preview.textContent = editor.value;
    showWarn('Preview highlighter error: ' + err.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
refreshPreview();
updateStats();
</script>
</body>
</html>`;
    }

    dispose() {
        ExpressionEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}

module.exports = ExpressionEditorPanel;
