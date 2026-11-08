// tutorialHtml.js
// Pure HTML/CSS builder for the built-in JRXML tutorial.
//
// Deliberately free of the `vscode` module so the document can be unit-tested
// with plain Node. The tutorial is static: it uses theme-aware CSS and
// `command:` links (allowlisted by the host panel), never scripts.
//
// Keeping it current:
//   * DOCUMENTED_COMMANDS must cover every `contributes.commands` entry;
//   * DOCUMENTED_SETTING_GROUPS must cover every settings group.
// `test/tutorialHtml.test.js` enforces both, so adding a command or a settings
// group without documenting it here fails `npm test`. The pull-request
// template repeats the reminder.

const pkg = require('./package.json');
const { SETTINGS_GROUPS } = require('./settingsSchema');
const { escapeHtmlText } = require('./expressionPanelHtml');

/**
 * Every command contributed by the extension, in tutorial order.
 * Descriptions are written for users; titles come from package.json.
 */
const DOCUMENTED_COMMANDS = [
    { id: 'jrxml.openDesignView', group: 'Open', summary: 'Open the visual report canvas beside the source, in view or edit mode.' },
    { id: 'jrxml.openExpressionEditor', group: 'Open', summary: 'Open the expression under the cursor in a dedicated editor.' },
    { id: 'jrxml.openIfElseBuilder', group: 'Open', summary: 'Build the expression under the cursor as if / else-if / else branches.' },
    { id: 'jrxml.openSettingsPanel', group: 'Open', summary: 'Open every JRXML setting grouped by area.' },
    { id: 'jrxml.openTutorial', group: 'Open', summary: 'Open this guide.' },

    { id: 'jrxml.formatDocument', group: 'Format and fix', summary: 'Format the whole report and apply the text-check fixes.' },
    { id: 'jrxml.formatExpressionAtCursor', group: 'Format and fix', summary: 'Format only the expression under the cursor, leaving the rest of the file alone.' },
    { id: 'jrxml.fixAllFormat', group: 'Format and fix', summary: 'Apply all format and text-check fixes to the open report.' },
    { id: 'jrxml.issues.fixAll', group: 'Format and fix', summary: 'Apply the preferred quick fix for every issue in the file.' },
    { id: 'jrxml.issues.applyFix', group: 'Format and fix', summary: 'Apply one issue’s quick fix from the Issues view.' },

    { id: 'jrxml.issues.jumpToHit', group: 'Issues and navigation', summary: 'Reveal the source location of an issue.' },
    { id: 'jrxml.goToDeclaration', group: 'Issues and navigation', summary: 'Jump from a $F/$P/$V reference to its declaration.' },
    { id: 'jrxml.issues.editInExpressionEditor', group: 'Issues and navigation', summary: 'Open an issue’s expression in the Expression Editor.' },
    { id: 'jrxml.issues.editInIfElseBuilder', group: 'Issues and navigation', summary: 'Open an issue’s expression in the If / Else Builder.' },
    { id: 'jrxml.nextIssue', group: 'Issues and navigation', summary: 'Go to the next JRXML issue in the current report.' },
    { id: 'jrxml.previousIssue', group: 'Issues and navigation', summary: 'Go to the previous JRXML issue in the current report.' },
    { id: 'jrxml.issues.copyMessage', group: 'Issues and navigation', summary: 'Copy an issue’s message to the clipboard.' },
    { id: 'jrxml.issues.copyCode', group: 'Issues and navigation', summary: 'Copy an issue’s rule id (for example jrxml.undeclaredReference).' },

    { id: 'jrxml.sortElements', group: 'Clean-up', summary: 'Preview and sort band/frame elements by their position.' },
    { id: 'jrxml.applyClearFixes', group: 'Clean-up', summary: 'Preview and apply unused-declaration, description and jsonql fixes.' },
    { id: 'jrxml.migrateSqlQuery', group: 'Clean-up', summary: 'Preview and migrate a SQL query to a jsonql expression.' },

    { id: 'jrxml.refreshIssues', group: 'Views', summary: 'Recompute the Issues view.' },
    { id: 'jrxml.refreshIncludeChain', group: 'Views', summary: 'Rescan the workspace and rebuild the include chain.' },
];

/**
 * Every settings group, with a tutorial summary. The group titles and keys are
 * read from settingsSchema so the reference cannot fall behind the panel.
 */
const DOCUMENTED_SETTING_GROUPS = [
    { id: 'editor', summary: 'Indent size, auto-open, auto-format, typed completion and the target Java version.' },
    { id: 'ifElse', summary: 'Null-safe guards, multi-line output and ternary vs IF() style.' },
    { id: 'diagnostics', summary: 'Unused warnings, dataset scope, duplicate names, report language, resource-bundle keys, expression validation, structural lint rules and the Boolean-comparison style rule.' },
    { id: 'format', summary: 'Report name, positionType, textAdjust, expression formatting and text check.' },
    { id: 'clear', summary: 'The SQL migration target language and whether to confirm clear fixes.' },
    { id: 'sort', summary: 'Whether the geometry sort asks for confirmation (the diff preview always opens).' },
];

/**
 * Commands the tutorial links to. The host passes this list to
 * `enableCommandUris`, so a link outside it is inert; the test checks that
 * every `command:` link is covered.
 */
const TUTORIAL_COMMAND_URIS = [
    'jrxml.openDesignView',
    'jrxml.openExpressionEditor',
    'jrxml.openIfElseBuilder',
    'jrxml.openSettingsPanel',
    'jrxml.issues.fixAll',
    'jrxml.nextIssue',
    'jrxml.formatDocument',
    'jrxml.refreshIncludeChain',
    'jrxml.refreshIssues',
    'workbench.action.openSettings',
];

function escape(value) {
    return escapeHtmlText(value == null ? '' : value);
}

function commandReference() {
    const declared = new Map(
        (pkg.contributes.commands || []).map(command => [command.command, command])
    );
    const groups = [];

    for (const item of DOCUMENTED_COMMANDS) {
        const meta = declared.get(item.id);
        let group = groups.find(candidate => candidate.title === item.group);
        if (!group) {
            group = { title: item.group, rows: [] };
            groups.push(group);
        }
        group.rows.push({
            id: item.id,
            title: meta ? meta.title : item.id,
            summary: item.summary,
        });
    }

    return groups.map(group => `
      <h3>${escape(group.title)}</h3>
      <table>
        <thead><tr><th>Command</th><th>What it does</th></tr></thead>
        <tbody>
          ${group.rows.map(row => `<tr>
            <td><strong>${escape(row.title)}</strong><br><code>${escape(row.id)}</code></td>
            <td>${escape(row.summary)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`).join('');
}

function settingsReference() {
    const byId = new Map(SETTINGS_GROUPS.map(group => [group.id, group]));

    return DOCUMENTED_SETTING_GROUPS.map(item => {
        const group = byId.get(item.id);
        if (!group) return '';

        const keys = group.settings
            .map(setting => `<code>jrxml.${escape(setting.key)}</code>`)
            .join(' ');

        return `<tr>
          <td><strong>${escape(group.title)}</strong></td>
          <td>${escape(item.summary)}</td>
          <td class="keys">${keys}</td>
        </tr>`;
    }).join('');
}

function formatKeybinding(binding) {
    const names = {
        ctrl: 'Ctrl', cmd: 'Cmd', alt: 'Alt', shift: 'Shift', meta: 'Meta',
        up: 'Up', down: 'Down', left: 'Left', right: 'Right',
        escape: 'Esc', enter: 'Enter', space: 'Space', pageup: 'PageUp', pagedown: 'PageDown',
    };
    return String(binding)
        .split('+')
        .map(part => {
            const key = part.trim();
            const lower = key.toLowerCase();
            if (names[lower]) return names[lower];
            if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
            return key.length === 1 ? key.toUpperCase() : key;
        })
        .join('+');
}

function keybindingReference() {
    const declared = new Map(
        (pkg.contributes.commands || []).map(command => [command.command, command])
    );
    const bindings = pkg.contributes.keybindings || [];

    return bindings.map(binding => {
        const meta = declared.get(binding.command);
        const mac = binding.mac
            ? `<br><span class="muted">macOS: <kbd>${escape(formatKeybinding(binding.mac))}</kbd></span>`
            : '';
        return `<tr>
          <td><kbd>${escape(formatKeybinding(binding.key))}</kbd>${mac}</td>
          <td>${escape(meta ? meta.title : binding.command)}</td>
        </tr>`;
    }).join('');
}

/**
 * Build the complete tutorial document.
 *
 * @param {{nonce:string}} opts
 * @returns {string} full HTML document
 */
function buildTutorialHtml({ nonce }) {
    const version = escape(pkg.version);

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<title>JRXML Tutorial</title>
<style nonce="${nonce}">
  :root {
    --bg:          var(--vscode-editor-background, #1e1e1e);
    --fg:          var(--vscode-editor-foreground, #d4d4d4);
    --muted:       var(--vscode-descriptionForeground, #999);
    --border:      var(--vscode-panel-border, #444);
    --panel:       var(--vscode-sideBar-background, #252526);
    --code-bg:     var(--vscode-textCodeBlock-background, #2d2d2d);
    --accent:      var(--vscode-textLink-foreground, #4daafc);
    --accent-hover:var(--vscode-textLink-activeForeground, #75beff);
    --btn-bg:      var(--vscode-button-background, #0e639c);
    --btn-fg:      var(--vscode-button-foreground, #fff);
    --btn-hover:   var(--vscode-button-hoverBackground, #1177bb);
    --warn:        var(--vscode-editorWarning-foreground, #cca700);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0 auto;
    max-width: 980px;
    padding: 0 24px 56px;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: 13px;
    line-height: 1.6;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: var(--accent-hover); text-decoration: underline; }
  code, kbd {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }
  code {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
  }
  kbd {
    background: var(--panel);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 1px 6px;
    white-space: nowrap;
  }
  .hero {
    padding: 40px 0 24px;
    border-bottom: 1px solid var(--border);
  }
  .eyebrow {
    margin: 0 0 6px;
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .hero h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.2; }
  .lede { margin: 0; max-width: 760px; font-size: 15px; color: var(--muted); }
  .hero .meta { margin-top: 12px; color: var(--muted); font-size: 12px; }
  nav.toc {
    margin: 24px 0 8px;
    padding: 16px 20px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
  }
  nav.toc h2 {
    margin: 0 0 8px;
    border: none;
    padding: 0;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  nav.toc ol {
    margin: 0;
    padding-left: 20px;
    columns: 2;
    column-gap: 32px;
  }
  nav.toc li { margin: 2px 0; break-inside: avoid; }
  section { scroll-margin-top: 16px; }
  h2 {
    margin: 40px 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
    font-size: 20px;
  }
  h3 { margin: 22px 0 6px; font-size: 14px; }
  p { margin: 8px 0; }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  li { margin: 4px 0; }
  .card {
    margin: 14px 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
  }
  .card h3 { margin-top: 0; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
    margin: 14px 0;
  }
  .grid .card { margin: 0; }
  .note {
    margin: 14px 0;
    padding: 10px 14px;
    border-left: 3px solid var(--warn);
    background: var(--panel);
  }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; }
  .button {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 3px;
    background: var(--btn-bg);
    color: var(--btn-fg);
    font-size: 12px;
  }
  .button:hover { background: var(--btn-hover); color: var(--btn-fg); text-decoration: none; }
  .button.secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
  }
  .button.secondary:hover { background: rgba(127,127,127,0.15); }
  table {
    width: 100%;
    margin: 10px 0 18px;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  th, td {
    padding: 7px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }
  th {
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  tr:last-child td { border-bottom: none; }
  td code { white-space: normal; }
  td.keys { max-width: 300px; line-height: 2; }
  td.keys code { display: inline-block; margin: 0 3px 3px 0; }
  .muted { color: var(--muted); }
  .pill {
    display: inline-block;
    margin-right: 4px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--muted);
    font-size: 11px;
  }
  .code-block {
    margin: 12px 0;
    padding: 12px 14px;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--code-bg);
  }
  .code-block code {
    background: transparent;
    border: none;
    padding: 0;
    white-space: pre;
    display: block;
    line-height: 1.55;
  }
  footer {
    margin-top: 48px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
  }
  @media (max-width: 720px) {
    body { padding: 0 16px 40px; }
    nav.toc ol { columns: 1; }
    .hero h1 { font-size: 24px; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
  }
</style>
</head>
<body>

<header class="hero">
  <p class="eyebrow">JRXML Editor &middot; v${version}</p>
  <h1>JRXML tutorial</h1>
  <p class="lede">A short, practical tour of editing, building, formatting, diagnosing and visually editing JasperReports <code>.jrxml</code> files. Everything here runs locally — no report data is loaded and no expression is evaluated.</p>
  <p class="meta">Open this guide any time with <strong>JRXML: Open Tutorial</strong> or the button in the Settings panel.</p>
  <div class="actions">
    <a class="button" href="command:jrxml.openExpressionEditor">Open Expression Editor</a>
    <a class="button secondary" href="command:jrxml.openIfElseBuilder">Open If / Else Builder</a>
    <a class="button secondary" href="command:jrxml.openDesignView">Open Design View</a>
    <a class="button secondary" href="command:jrxml.openSettingsPanel">Open Settings</a>
  </div>
</header>

<nav class="toc" aria-label="Tutorial contents">
  <h2>Contents</h2>
  <ol>
    <li><a href="#quick-start">Quick start</a></li>
    <li><a href="#editor">Editing a report</a></li>
    <li><a href="#expression-editor">Expression editor</a></li>
    <li><a href="#if-else">If / Else builder</a></li>
    <li><a href="#design-view">Design view</a></li>
    <li><a href="#issues">Issues and quick fixes</a></li>
    <li><a href="#formatting">Formatting and text check</a></li>
    <li><a href="#cleanup">Clear, sort and SQL migration</a></li>
    <li><a href="#include-chain">Include chain</a></li>
    <li><a href="#settings">Settings</a></li>
    <li><a href="#commands">Command reference</a></li>
    <li><a href="#shortcuts">Keyboard shortcuts</a></li>
    <li><a href="#limits">Security and limits</a></li>
    <li><a href="#maintain">Keeping this guide current</a></li>
  </ol>
</nav>

<main>

<section id="quick-start">
  <h2>Quick start</h2>
  <ol>
    <li>Open a <code>.jrxml</code> file. The language features activate automatically.</li>
    <li>Use the <strong>JRXML</strong> entry in the editor title bar, the editor/explorer context menu, or the Command Palette to open a tool.</li>
    <li>The <strong>JRXML</strong> Activity Bar container holds the <strong>Issues</strong> and <strong>Include Chain</strong> views.</li>
    <li>Put the cursor inside an expression tag such as <code>&lt;textFieldExpression&gt;</code> before opening the Expression Editor or the If / Else Builder.</li>
  </ol>

  <div class="grid">
    <div class="card">
      <h3>Build an expression</h3>
      <p>Start with fields, parameters and variables the report already declares, then apply the result back.</p>
      <p><a href="command:jrxml.openIfElseBuilder">Open the If / Else Builder</a></p>
    </div>
    <div class="card">
      <h3>See the layout</h3>
      <p>Open the design canvas beside the source, follow the cursor, or switch to Edit and drag elements.</p>
      <p><a href="command:jrxml.openDesignView">Open the Design View</a></p>
    </div>
    <div class="card">
      <h3>Fix what is wrong</h3>
      <p>Undeclared references, unbalanced parentheses, unclosed strings, unused declarations and lint rules appear as diagnostics.</p>
      <p><a href="command:jrxml.refreshIssues">Refresh the Issues view</a></p>
    </div>
  </div>
</section>

<section id="editor">
  <h2>Editing a report</h2>
  <p>The <code>.jrxml</code> language support is a normal VS Code editor experience:</p>
  <ul>
    <li><strong>Syntax highlighting and bracket colorization</strong> for JRXML and Java expressions.</li>
    <li><strong>Outline</strong> and breadcrumbs for the report, declarations, bands and groups.</li>
    <li><strong>Completion</strong> for <code>$F{}</code>, <code>$P{}</code> and <code>$V{}</code>, Jasper built-ins, Java types/statics, local public static methods and typed members. Typing <code>$F{customer}.</code> offers the members of the declared type; the target Java version is a setting.</li>
    <li><strong>Go to Declaration</strong>, <strong>Find All References</strong> and hover information for every declared field, parameter and variable.</li>
    <li><strong>Diagnostics</strong> update on open, on save, when switching tabs, and after a short typing pause.</li>
  </ul>
  <p class="muted">Tip: completion is also driven by the report’s declarations, so keep the <code>&lt;field&gt;</code>, <code>&lt;parameter&gt;</code> and <code>&lt;variable&gt;</code> tags in the file. The panel re-reads them when the document changes.</p>
</section>

<section id="expression-editor">
  <h2>Expression editor</h2>
  <p>Place the cursor inside an expression tag and run <strong>JRXML: Open Expression Editor</strong> (or <kbd>Ctrl+Alt+E</kbd> / <kbd>Cmd+Alt+E</kbd>). The editor opens beside the source with the raw expression.</p>
  <ul>
    <li><strong>Format</strong> the expression with the Auto-format option or the Format button.</li>
    <li><strong>Apply</strong> writes the expression back into the tag, preserving CDATA when it was used.</li>
    <li><strong>If / Else…</strong> hands the current expression to the visual builder.</li>
    <li>Drafts are kept per expression while the panel is open, so switching A → B → A does not lose A’s edits.</li>
  </ul>
  <p><a href="command:jrxml.openExpressionEditor">Open the Expression Editor</a></p>
</section>

<section id="if-else">
  <h2>If / Else builder</h2>
  <p>Build a conditional expression from typed conditions, then apply it back to the tag the panel was opened from. Open it with <strong>JRXML: Open If / Else Builder</strong> or <kbd>Ctrl+Alt+B</kbd> / <kbd>Cmd+Alt+B</kbd>.</p>

  <h3>Branches and conditions</h3>
  <ul>
    <li>Each branch is an <strong>if</strong> or <strong>else if</strong>; conditions can be joined with AND or OR.</li>
    <li>Value types are String, Number, Boolean or a raw Boolean expression. Null checks, string methods, comparisons and boolean guards are written with the null-safety you choose; String and Boolean equality use the Jaspersoft <code>EQUALS(...)</code> / <code>NOT(EQUALS(...))</code> helpers instead of <code>.equals(...)</code>.</li>
    <li>Two output styles are available: a nested ternary or the Jaspersoft <code>IF()</code> / <code>AND()</code> / <code>OR()</code> functions.</li>
  </ul>

  <h3>Result types</h3>
  <p>Every branch and the final <strong>else</strong> has a <strong>Result type</strong>:</p>
  <ul>
    <li><strong>Text</strong> — quoted automatically; use it for display strings.</li>
    <li><strong>Number</strong> — inserted as a Java number literal.</li>
    <li><strong>null</strong> — inserts <code>null</code>.</li>
    <li><strong>Expression</strong> — inserted verbatim. Use it for fields, arithmetic, concatenation, method calls and constructors.</li>
  </ul>
  <div class="card">
    <h3>Expression results</h3>
    <p>The result field grows into a multiline editor when you pick <strong>Expression</strong>. The text is not quoted, so these are all valid:</p>
    <div class="code-block"><code>$F{first} + " " + $F{last}
$F{amount} * 2
new java.util.Date()
String.format("%s, %s", $F{first}, $F{last})
Class&lt;? extends Number&gt;</code></div>
    <p>Loading an existing expression works the same way: the builder reads the conditional skeleton, keeps conditions as editable controls where it can, and stores each result as opaque source. Arithmetic, concatenation, nested calls, generics and commas inside calls survive the round trip. A condition the builder cannot represent becomes a <strong>Custom</strong> condition instead of being dropped.</p>
  </div>

  <h3>Apply or copy</h3>
  <p><strong>Apply to File</strong> writes one undoable edit into the expression tag the builder was opened from; <strong>Copy</strong> puts the generated expression on the clipboard. The panel refreshes the schema when the report is saved or its declarations change.</p>
  <p><a href="command:jrxml.openIfElseBuilder">Open the If / Else Builder</a></p>
</section>

<section id="design-view">
  <h2>Design view</h2>
  <p><strong>JRXML: Open Design View</strong> opens a Jaspersoft Studio-style canvas beside the source. It renders the page, margins, columns, every band and each element at its <code>x</code>/<code>y</code>/<code>width</code>/<code>height</code>.</p>

  <h3>View mode</h3>
  <ul>
    <li>Click an element or band label to reveal it in the source.</li>
    <li>Moving the source cursor highlights the matching element or band while <strong>Follow</strong> is on.</li>
    <li>Text fields show their expression, static text its content; lines, rectangles, ellipses and frames are drawn; other elements appear as labelled placeholders.</li>
    <li>Zoom and fit keep the page readable.</li>
  </ul>

  <h3>Edit mode</h3>
  <p>Switch the toolbar to <strong>Edit</strong> to drag elements, resize them from eight handles and edit the selected element in the inspector: geometry, text/expression content, fonts, colours, alignment, rotation, markup, named styles, print/behaviour properties, image/line/break/subreport options, borders and padding, and an <strong>All attributes</strong> editor for anything not covered by a control.</p>
  <ul>
    <li>Every change is one undoable <code>WorkspaceEdit</code>.</li>
    <li>Edits are rejected if the source changed since the model was rendered.</li>
    <li>Inherited styles are left untouched and shared <code>&lt;style&gt;</code> definitions are never modified.</li>
    <li>The inspector’s expression textarea has the same completion engine as the editor.</li>
  </ul>
  <p class="muted">Only the Studio 7 / JasperReports 7 format (<code>&lt;element kind="…"&gt;</code>) is rendered; classic files show an explanatory banner. Expressions are not evaluated and no data is loaded.</p>
  <p><a href="command:jrxml.openDesignView">Open the Design View</a></p>
</section>

<section id="issues">
  <h2>Issues and quick fixes</h2>
  <p>The <strong>Issues (JRXML)</strong> view mirrors the diagnostics for the open report, grouped by severity. The same diagnostics appear as squiggles in the editor.</p>
  <ul>
    <li>Undeclared <code>$F{}</code>/<code>$P{}</code>/<code>$V{}</code>/<code>$P!{}</code>/<code>$R{}</code> references, dataset-scope and duplicate-name errors, a report-language warning when only Java is modeled, missing resource keys, unbalanced parentheses, unclosed strings, unused declarations, the structural lint rules and text-check findings.</li>
    <li>Boolean comparisons such as <code>$F{active} == true</code> and bare Boolean references used as conditions (for example <code>$F{active}</code>) offer a one-click <code>EQUALS(...)</code> fix (<code>jrxml.lint.booleanEquals</code>).</li>
    <li>Open an issue’s context menu to jump to it, apply its quick fix, copy the message/rule id, or open the expression in the Expression Editor or If / Else Builder.</li>
    <li><strong>Fix All Issues in File</strong> applies the preferred fixes where they do not overlap.</li>
    <li><strong>Go to Next Issue</strong> and <strong>Go to Previous Issue</strong> move between problems without leaving the keyboard.</li>
  </ul>
  <p><a href="command:jrxml.issues.fixAll">Fix all issues in the open file</a> &middot; <a href="command:jrxml.nextIssue">Go to the next issue</a></p>
</section>

<section id="formatting">
  <h2>Formatting and text check</h2>
  <p>The formatter normalizes the hook’s format and text-check steps. It never runs the destructive clear/sort steps.</p>
  <ul>
    <li><strong>Format Document</strong> formats the whole report.</li>
    <li><strong>Format Expression at Cursor</strong> formats only the expression under the cursor, CDATA preserved.</li>
    <li><strong>Fix All (Format and Text)</strong> applies both steps in one edit.</li>
    <li><strong>Format on save</strong> is opt-in through <code>jrxml.formatOnSave</code>.</li>
  </ul>
  <div class="note">The text-check rules fix characters that fail to render, spacing around periods and double spaces, and related display issues. Each finding is also exposed as a diagnostic so the change is visible before it is applied.</div>
  <p><a href="command:jrxml.formatDocument">Format the open document</a></p>
</section>

<section id="cleanup">
  <h2>Clear, sort and SQL migration</h2>
  <p>These commands rewrite the report, so each one opens a <strong>diff preview</strong> and asks before applying.</p>
  <ul>
    <li><strong>Apply Clear Fixes</strong> removes unused declarations, synchronizes <code>&lt;description&gt;</code> with jsonql and fixes jsonql properties.</li>
    <li><strong>Sort Band/Frame Elements by Position</strong> reorders each container by <code>y</code> then <code>x</code>, keeping comments attached to their element.</li>
    <li><strong>Migrate SQL Query to jsonql</strong> rewrites a <code>&lt;query language="sql"&gt;</code> into the configured target language.</li>
  </ul>
  <p>The confirmation can be disabled with <code>jrxml.clear.confirm</code> or <code>jrxml.sort.confirm</code>; the diff preview always opens.</p>
</section>

<section id="include-chain">
  <h2>Include chain</h2>
  <p>The <strong>Include Chain</strong> view answers “where is this report called from?”. A file calls another when it contains a double-quoted token equal to the other file’s base name, so subreports are found however their expression is written.</p>
  <ul>
    <li>The workspace is scanned for <code>**/*.jrxml</code> (excluding build and dependency folders) and cached by modification time.</li>
    <li>The chain is rebuilt on active-editor changes, edits, saves and file create/delete/rename, or manually with <strong>Refresh Include Chain</strong>.</li>
  </ul>
  <p><a href="command:jrxml.refreshIncludeChain">Refresh the include chain</a></p>
</section>

<section id="settings">
  <h2>Settings</h2>
  <p><strong>JRXML: Open Settings</strong> opens a panel with every setting grouped by area, bound live to workspace settings. Use <strong>Open VS Code settings</strong> for the native view or <strong>Reset all to defaults</strong> to start over.</p>
  <table>
    <thead><tr><th>Group</th><th>What it controls</th><th>Keys</th></tr></thead>
    <tbody>${settingsReference()}</tbody>
  </table>
  <p><a class="button" href="command:jrxml.openSettingsPanel">Open the Settings panel</a> <a href="command:workbench.action.openSettings">Open VS Code settings</a></p>
  <p class="muted">The Settings panel also has an <strong>Open tutorial</strong> button that brings you back here.</p>
</section>

<section id="commands">
  <h2>Command reference</h2>
  <p>Every command is available from the Command Palette. The editor-title buttons and the <strong>JRXML</strong> context submenu expose the most common ones.</p>
  ${commandReference()}
</section>

<section id="shortcuts">
  <h2>Keyboard shortcuts</h2>
  <p>These bindings apply while a <code>.jrxml</code> editor has focus.</p>
  <table>
    <thead><tr><th>Shortcut</th><th>Command</th></tr></thead>
    <tbody>${keybindingReference()}</tbody>
  </table>
</section>

<section id="limits">
  <h2>Security and limits</h2>
  <ul>
    <li>Everything runs locally. The extension has no runtime dependencies, makes no network requests, and never downloads or resolves a DTD.</li>
    <li>Expressions are analyzed as text. They are <strong>not evaluated</strong>, and no report data or JDBC connection is used.</li>
    <li>Webviews use a nonce-based Content-Security-Policy; file content is only assigned through text and DOM properties.</li>
    <li>The design view renders the Studio 7 / JasperReports 7 element format. Classic-format reports show a banner instead of a guess.</li>
    <li>Design-view editing covers element geometry, content and the inspector properties. Multi-select, grid snapping, adding/deleting elements and band editing are not part of this version.</li>
  </ul>
</section>

<section id="maintain">
  <h2>Keeping this guide current</h2>
  <p>This tutorial ships with the extension and is part of the test suite. When you add a command, add it to <code>DOCUMENTED_COMMANDS</code> in <code>tutorialHtml.js</code>; when you add a settings group, add it to <code>DOCUMENTED_SETTING_GROUPS</code>. A new user-facing feature also deserves a short section above.</p>
  <div class="note">
    <p><strong>The guard:</strong> <code>test/tutorialHtml.test.js</code> compares both lists with <code>package.json</code> and <code>settingsSchema.js</code>. <code>npm test</code> fails when something is missing, and the pull-request checklist in <code>.github/pull_request_template.md</code> repeats the reminder.</p>
  </div>
</section>

</main>

<footer>
  JRXML Editor v${version} &middot; Run <strong>JRXML: Open Tutorial</strong> at any time. This page is covered by <code>test/tutorialHtml.test.js</code>.
</footer>

</body>
</html>`;
}

module.exports = {
    buildTutorialHtml,
    DOCUMENTED_COMMANDS,
    DOCUMENTED_SETTING_GROUPS,
    TUTORIAL_COMMAND_URIS,
};
