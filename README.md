# JRXML Editor

A VS Code extension for working with JasperReports `.jrxml` files — focused on making expressions readable, editable and safer.

---

## Features

### 1. Syntax highlighting
`.jrxml` files get a dedicated language mode with:
- **JasperReports built-in functions** (`TODAY`, `IF`, `SUM`, `MIN`, `MAX`, …)
- **Java keywords** (`if`, `else`, `new`, `null`, `true`, `false`, …)
- **Java types** (`String`, `Integer`, `BigDecimal`, `Date`, …)
- **Method calls** and static calls
- **Jasper field/param/variable references** (`$F{name}`, `$P{name}`, `$V{name}`, `$R{name}`)
- **String literals, numbers, comments** and colorized brackets

### 2. Expression editor panel
Open any expression in a dedicated side panel:
- **Edit** pane — editable text area
- **Preview** pane — live syntax-highlighted view with bracket colorization
- **Format** button — auto-formats Java expressions into readable multi-line form:
  - ternary chains → indented `? / :` layout
  - method chains → one call per line
  - long `&&` / `||` expressions → broken at operators
  - long argument lists → one argument per line
- **Apply to File** — writes the edited expression back into the `.jrxml` file (CDATA preserved)
- **Copy** / **Reset** — clipboard and revert to the original expression
- **Keeps your edits** — switching expressions or reopening the panel preserves unsaved text;
  drafts are remembered per expression while the panel is open
- **Auto-format on change** checkbox — remembered via `jrxml.expressionEditor.autoFormat`

Open it from the pencil icon in the editor title bar, the status bar, the **JRXML** submenu,
or with `Ctrl+Alt+E` (`Cmd+Alt+E` on macOS). `Ctrl+Alt+B` opens the If / Else builder.

### 3. If / Else expression builder
A visual builder for conditional expressions, opened on demand:

- **Automatic schema** — reads the open `.jrxml`'s fields, parameters and variables
  (plus the JasperReports built-in variables and parameters) and offers them in name
  dropdowns. There is no file upload; the lists refresh when the report is saved or its
  declarations change.
- **if / else if / else branches** — conditions joined with AND/OR, typed comparisons
  (String, Number, Boolean, null checks) or a raw Boolean expression. Each result can be
  **Text**, a **Number**, `null`, or an **Expression** — expressions are inserted
  verbatim, so `$F{first} + " " + $F{last}`, method calls and `new Date()` work.
- **Two output styles** — a nested ternary or the Jaspersoft `IF()` / `AND()` / `OR()`
  functions. String and Boolean equality use the Jaspersoft `EQUALS(...)` /
  `NOT(EQUALS(...))` helpers instead of `.equals(...)`. Null-safe guards are written as
  inline ternaries in function style.
- **Apply or copy** — Apply writes the expression back into the expression tag the
  builder was opened from (CDATA preserved, one undoable edit); Copy puts it on the
  clipboard.
- **Reverse conversion** — paste an existing expression and load it back into the
  branches. Conditions are mapped to typed controls when possible (anything else becomes
  a Custom condition); results are captured verbatim, so arithmetic, concatenation,
  method calls and nested calls survive the round trip.
- **Expression Editor hand-off** — the expression editor's **If / Else…** button opens
  the builder with the current text.

The builder starts with Null-safe and Multi-line on and ternary style; change the
defaults under `jrxml.ifElse.*` in Settings. Use **JRXML: Open If / Else Builder** from
the JRXML submenu or the command palette, with the cursor inside an expression tag to
enable Apply.

### 4. Bracket / parenthesis colorization
Inside the expression preview, brackets are colored by depth (level 1 gold, level 2 orchid, level 3 sky blue).

### 5. Diagnostics
- Unused fields, parameters and variables
- Undeclared `$F`/`$P`/`$V`/`$P!` references
- **Dataset scope** — completion, hover and diagnostics resolve against the report or the enclosing `<dataset>`/`<subDataset>` (and a list/table's dataset run). A master declaration used inside a dataset is an error, and dataset members are not offered at report scope
- **Duplicate names** — a field, parameter, variable, group, dataset or style name declared more than once in the same scope (`jrxml.lint.duplicateNames`)
- **Report language** — a `language="groovy"` or `"javascript"` report warns that only Java is modeled and loses Java typed member completion
- **Resource bundles** — `$R{` completes keys from the report's `resourceBundle` (base and locale `.properties`), hover shows the default and localized values, go-to-definition opens the key in the properties file, and a missing key or unresolvable bundle is reported
- Unbalanced parentheses and unclosed string literals
- **Structural lint rules** ported from the project's commit-time `myhooks` hook:
  - `jrxml.lint.constantPrintWhen` — a `<printWhenExpression>` that is literally `true` or `false`
  - `jrxml.lint.removeLineWhenBlank` — a `textField`/`subreport` missing `removeLineWhenBlank="true"` (or with another value)
  - `jrxml.lint.markupTagWithoutMarkup` — markup tags inside a textField expression while `markup` is not `styled`, `html` or `rtf`
  - `jrxml.lint.uncheckedNullDereference` — a `$F`/`$P`/`$V` reference used as a method-call receiver without a dominating null check (short-circuit aware: `!= null &&`, `== null ||`, ternaries, `EQUALS(x, null)`, `Objects.nonNull`/`isNull`/`equals`)
- **Boolean comparison style** — `==` / `!=` on a declared Boolean value, `Boolean.TRUE`/`FALSE.equals(...)`, or a bare Boolean reference used as a condition, with a one-click `EQUALS(...)` fix (`jrxml.lint.booleanEquals`)

  The `constantPrintWhen`, `removeLineWhenBlank` and `markupTagWithoutMarkup` rules above
  have quick fixes and can be switched off individually; the Boolean rule also has a quick
  fix and its own setting. The hook's structural
  `validate`/`compile` gate is intentionally **not** ported (it needs the JasperReports engine).
- **Text check warnings** — double spaces, a missing space after `.`, unrenderable characters and newline normalization, flagged inside `<text>` CDATA and inside string/text-block literals, each with a quick fix (`jrxml.textcheck.diagnostics`)
- Outline, hover, go-to-definition and **Find All References** for `$F{}` / `$P{}` / `$V{}` / `$P!{}`, resolved in the declaration's own scope
- **Act on issues** — right-click an issue (or use its lightbulb) to open the offending
  expression in the Expression Editor or the If / Else Builder

The **Issues (JRXML)** and **Include Chain (JRXML)** views live under the extension's own **JRXML** icon in the Activity Bar. When no report is open, the Issues view shows quick-start actions.

### 6. Document formatting and text check
The hook's `format` + `textcheck` steps run through **Format Document** and the
`source.fixAll.jrxml` action **"Fix all JRXML format and text issues"**:

- **report name** — `jasperReport/@name` set to the file base name
- **positionType** — add/set `positionType="Float"` on `textField` and `subreport`
- **textAdjust** — add/set `textAdjust="StretchHeight"` on `textField`
- **expression spacing** — `==` `!=` `<` `>` `>=` `<=` `&&` `||`, ternaries, commas and
  uppercase-reference casts. Generic type arguments, string/char/text-block literals and
  `$F{}`/`$P{}`/`$V{}`/`$P!{}` references are left byte-for-byte untouched
- **text check** — replaces unrenderable characters, adds a space after `.` before a capital,
  collapses double spaces, and normalizes newlines to the element's `markup` token

Formatting only runs when you ask for it (Format Document, the fix-all action, or opt-in
`jrxml.formatOnSave`) and never reorders elements or deletes declarations.

### 7. Clear fixes and geometry sort
Two destructive steps are opt-in commands. Each always opens a diff preview and, unless confirmation is disabled, asks before applying:

- **Clear fixes** (`JRXML: Apply Clear Fixes`) — delete unused declarations (never the
  built-in parameters), sync field descriptions with their jsonql property, and fix the
  legacy/jsonql property. Unused detection collects references from expressions only, so a
  `$F{x}` inside a comment or description does not count as usage.
- **SQL → jsonql** (`JRXML: Migrate SQL Query to jsonql`) — asks for the jsonql expression
  and rewrites the `<query>` language and body; an empty answer applies nothing.
- **Sort** (`JRXML: Sort Band/Frame Elements by Position`) — reorders each band/frame's
  direct `<element>` children by y then x, moving each element's comment/property trivia
  with it; missing coordinates and overlaps are reported as warnings.

### 8. Smart autocomplete
Context-aware completion for fields, parameters and variables, JasperReports built-ins, common Java statics, and **user-defined `public static` helper methods** discovered under `src/main/java`. The Java scan is cached and re-runs when `.java` files or workspace folders change.

**Typed member completion.** Typing `.` after a field, parameter or variable completes the *Java members of its declared `class`*:

| Expression | Offered |
|---|---|
| `$F{CustomerName}.` | `String` members — `substring(int, int)`, `toUpperCase()`, … |
| `$P{Total}.` | `BigDecimal` members — `add(BigDecimal)`, `setScale(int, RoundingMode)`, … |
| `$V{Count}.` | `Integer` members — `intValue()`, `compareTo(Integer)`, … |
| `$P{REPORT_DATA_SOURCE}.` | `JRDataSource` members — `next()`, `getFieldValue(String)` |
| `$F{Name}.trim().` | members of `trim()`'s return type, up to a few calls deep |

Members are ranked with the most used first, overloads are listed with their parameter types, each item inserts a snippet with named placeholders (`substring(${1:n}, ${2:n2})`) and the documentation names the declaring type. Inherited members are offered too, marked as inherited and sorted after the type's own. Deprecated members are flagged. `String.length` on a `$F{...}` whose value can be null still triggers the *unchecked null dereference* warning — member completion does not change that rule.

The member table ships with the extension (`data/jdk-members.json`, generated from `javap` by `npm run gen:jdk-index`) and covers JDK types plus a few JasperReports engine types (`data/extra-types.json`). Project classes from `src/main/java` are not indexed yet, so a parameter typed as your own class completes nothing instead of guessing.

**Target Java version.** `jrxml.typeCompletion.jdkBaseline` (default `8`) hides members that do not exist on your target JDK, so a Java 8 report is never offered `String.isBlank` or `List.getFirst`. Set it to `11`, `17` or `21` when your reports compile against a newer JDK.

**When a receiver cannot be typed**, completion says so instead of showing an unrelated list:

- no `class` attribute on the declaration → an item explaining that the type is inferred by JasperReports, with the XML to declare it;
- a class outside the index → an item naming the class that is not covered;
- a short name that matches several types (`Date`) → an item listing the candidates, so you can write the full class name.

`jrxml.typeCompletion.enabled` (default `true`) turns the whole thing off and restores the previous behaviour.

**Expression snippets.** Type a snippet prefix in an expression to insert a common pattern:
`jif` (`IF(...)`), `jternary`, `jnullsafe`, `jand`, `jor`, `jnot`,
`jequals`/`jrequals` (`EQUALS(...)`), `jtext`,
`jstring`, `jdecimal` and `jdate`.

Date/time helpers: `jdatetoday` (format `TODAY()`), `jdateadd` (`TODAY()` + N days),
`jdateadddate`, `jdatetodaybefore` / `jdatetodayafter`, `jparsedate` (string → `Date`),
`jdatecompare` (two string dates), `jnow`, `jdatediff`, `jdatetodaytz` (report time zone)
and `jdatetodaylocale` (report locale).

### 9. Settings panel and tutorial
**JRXML: Open Settings** opens a dedicated panel with every `jrxml.*` setting grouped by area (Editor, Diagnostics, Formatting, Clear and migration, Sort). Toggles are bound live to workspace settings — the panel, VS Code's own Settings UI and the running features always agree — with a filter box and "Reset all to defaults". The panel schema is cross-checked against `package.json` by a test, so it cannot drift.

The panel also has an **Open tutorial** button. **JRXML: Open Tutorial** opens a built-in HTML guide that walks through the editor, Expression Editor, If / Else builder (including expression results), design view, Issues, formatting, clean-up and the include chain, with a reference for every command, shortcut and settings group. Its command and settings-group coverage is enforced by `test/tutorialHtml.test.js`, so adding a user-facing feature fails `npm test` until the guide is updated.

### 10. Include chain view
The **Include Chain (JRXML)** view sits in the **JRXML** Activity Bar view and answers *"where is the report I have open called from?"*. For the active `.jrxml` it renders the chain **top-down**: the top template(s) that ultimately include it, nested down to the open file, which is highlighted as *(current file)*. Nodes are workspace-relative paths and open the file on click; a report nothing calls shows `(not referenced)`.

A file *calls* another when it contains a double-quoted token equal to that file's base name (the commit-hook rule), so subreports are picked up however their expression is written. The workspace is scanned once (`**/*.jrxml`, excluding `node_modules`/`out`/`target`/`bin`), cached by file mtime, and refreshed when the active editor changes, on edits and saves, on file create/delete/rename and on workspace-folder changes — or manually via **JRXML: Refresh Include Chain**.

### 11. Report design view (view and edit)
**JRXML: Open Design View** opens a visual canvas beside the source, modeled on Jaspersoft Studio's **Design** tab. It renders the report page, margins and columns, every band (background, title, page/column headers and footers, group headers and footers, detail bands, summary, no data), and each element at its `x`/`y`/`width`/`height`:

- text fields show their expression and static text shows its content, using the element's font, colours, alignment, rotation and box borders;
- lines, rectangles and ellipses are drawn, and frames render their nested children;
- images, subreports, page breaks, charts, tables, lists and crosstabs appear as labelled placeholders;
- page breaks and extra columns are marked, and the toolbar zooms or fits the page width;
- in **View** mode, clicking an element or band label reveals it in the source editor; moving the source cursor highlights the matching element or band (toggle **Follow**).

The panel follows the last open `.jrxml` and updates as you type. It starts in **View** mode; switch to **Edit** to drag elements, resize them from the eight handles, and edit the selected element in the inspector:

- geometry; static text/expression content (CDATA preserved); font family/size/style, alignment, rotation, markup, colours and mode;
- print and behaviour properties — `positionType`, `stretchType`, repeated-value and blank-line handling, print-on-overflow/group, `evaluationTime`/`evaluationGroup`, key and bookmark level;
- a named `<style>` reference, plus `textAdjust`, `pattern` and `blankWhenNull` for text;
- image scale/alignment/on-error/cache/lazy and link type; line direction/width/style/colour; rectangle radius; page-break type; subreport cache and run-to-bottom;
- border and padding (one border is written; per-side pens are normalised to it);
- an **All attributes** editor that can add, edit or remove any element attribute not covered by a control (`kind` and namespace declarations are protected);
- **editor-grade autocomplete in the expression textarea**: the same fields, parameters, variables, Jasper built-ins, Java types/statics, local static methods and typed members (including snippets/placeholders) as the `.jrxml` editor. Use `Ctrl+Space` to open the list, arrows to move, Enter/Tab to insert and Escape to close.

Each change is a single undoable `WorkspaceEdit`; edits are rejected if the source changed since the view was rendered. Inspector edits write explicit element attributes and never modify shared `<style>` definitions.

Only the Studio 7 / JasperReports 7 format (`<element kind="…">`) is rendered; classic-format files show an explanatory banner. Expressions are not evaluated and no data is loaded. Template and conditional styles are not resolved, paragraph definitions and per-side padding are not exposed in the inspector, markup is flattened for display, and image/subreport content is not loaded. Multi-select, grid snapping, alignment tools, add/delete element and band editing are not part of this version; content editing is disabled for nested markup, mixed CDATA/plain content or content longer than 8,000 characters.

---

## Usage

1. Open any `.jrxml` file
2. Place your cursor **inside** an expression tag (e.g. `<textFieldExpression>`)
3. Either:
   - Right-click → **JRXML: Open Expression Editor**
   - Click the pencil icon in the editor title bar
   - Click **`$(edit) JRXML Expr`** in the status bar, press `Ctrl+Alt+E`, or run **JRXML: Open Expression Editor** from the command palette
4. To build the same expression visually, right-click → **JRXML: Open If / Else Builder**
   (or use the **If / Else…** button inside the expression editor, or `Ctrl+Alt+B`). The
   builder reads the open report's fields, parameters and variables automatically;
   **Apply to File** writes the result back into the expression tag under the cursor.
5. The **JRXML** icon in the Activity Bar holds the Issues and Include Chain views
   for the report you have open.
6. New here? The **Get started with JRXML** walkthrough (Welcome page) walks through the
   editor, formatting, issue fixes and the If / Else builder.

To view or edit the whole report layout instead, run **JRXML: Open Design View** (the `$(preview)` button in the editor title or the **JRXML** menu). The design view opens beside the source and follows the active report; switch to **Edit** in its toolbar to move/resize elements or edit properties.

---

## Commands

| Command | Description |
|---------|-------------|
| `JRXML: Open Design View` | Open the visual report design beside the source (view and edit) |
| `JRXML: Open Expression Editor` | Open the expression under the cursor in the side panel |
| `JRXML: Open If / Else Builder` | Build the expression under the cursor as if / else-if / else branches |
| `JRXML: Format Expression at Cursor` | Format only the expression under the cursor (CDATA preserved) |
| `JRXML: Edit Issue in Expression Editor` | Open the expression behind an issue in the Expression Editor |
| `JRXML: Edit Issue in If / Else Builder` | Open the expression behind an issue in the If / Else Builder |
| `JRXML: Go to Declaration` | Jump from `$F{}`/`$P{}`/`$V{}` to its declaration |
| `JRXML: Sort Band/Frame Elements by Position` | Reorder band/frame elements by geometry (previewed) |
| `JRXML: Apply Clear Fixes` | Delete unused declarations, sync descriptions, fix jsonql (previewed) |
| `JRXML: Migrate SQL Query to jsonql` | Prompt for jsonql and rewrite the `<query>` element |
| `JRXML: Open Settings` | Open the dedicated JRXML settings panel |
| `JRXML: Open Tutorial` | Open the built-in guide to the editor, panels and settings |
| `JRXML: Refresh Include Chain` | Re-scan the workspace for the include-chain view |

The table lists the primary commands; issue context-menu commands and other
context-only actions are omitted.

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `jrxml.indentSize` | `4` | Spaces per indent level when formatting expressions |
| `jrxml.autoOpenEditor` | `false` | Auto-open the editor when the cursor enters an expression |
| `jrxml.expressionEditor.autoFormat` | `false` | Remember the Expression Editor's Auto-format on change setting |
| `jrxml.ifElse.nullSafe` | `true` | Start the If / Else builder with null-safe guards |
| `jrxml.ifElse.multiline` | `true` | Start the If / Else builder with multi-line output |
| `jrxml.ifElse.style` | `ternary` | Default If / Else output style (`ternary` or `functions`) |
| `jrxml.showUnusedWarnings` | `true` | Warn about declared fields/parameters/variables that are never used |
| `jrxml.validateExpressions` | `true` | Error on unbalanced parentheses, unclosed strings and undeclared `$F`/`$P`/`$V` references |
| `jrxml.lint.constantPrintWhen` | `true` | Warn when `<printWhenExpression>` is a constant `true`/`false` |
| `jrxml.lint.removeLineWhenBlank` | `true` | Warn when a `textField`/`subreport` is missing `removeLineWhenBlank="true"` |
| `jrxml.lint.markupTagWithoutMarkup` | `true` | Warn when markup tags are used without `markup="styled"`/`html`/`rtf` |
| `jrxml.lint.nullDereference` | `true` | Warn on an unguarded `$F`/`$P`/`$V` method-call receiver |
| `jrxml.lint.booleanEquals` | `true` | Warn on `==`/`!=` or `Boolean.TRUE/FALSE.equals` for Boolean values |
| `jrxml.lint.duplicateNames` | `true` | Error when a field/parameter/variable/group/dataset/style name is declared more than once in the same scope |
| `jrxml.format.reportName` | `true` | Set `jasperReport/@name` to the file base name |
| `jrxml.format.positionType` | `true` | Add/set `positionType="Float"` on `textField`/`subreport` |
| `jrxml.format.textAdjust` | `true` | Add/set `textAdjust="StretchHeight"` on `textField` |
| `jrxml.format.expression` | `true` | Normalize expression operator/ternary/comma/cast spacing |
| `jrxml.textcheck.enabled` | `true` | Rendered-text rules in text and string literals |
| `jrxml.textcheck.diagnostics` | `true` | Show warnings + quick fixes for text-check problems |
| `jrxml.formatOnSave` | `false` | Run format + textcheck on save (never clear/sort) |
| `jrxml.sort.confirm` | `true` | Ask before applying the geometry sort (the diff preview always opens) |
| `jrxml.clear.confirm` | `true` | Ask before applying clear fixes or a SQL migration (the diff preview always opens) |
| `jrxml.migrate.targetLanguage` | `jsonql` | Language written to `<query language="...">` when migrating a SQL query |

---

## Installation

### From a `.vsix` file
1. Open VS Code
2. `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
3. Select the packaged `jrxml-editor-extension-<version>.vsix` (build it with `npm run package`)

### Manual (development)
```
npm install
```
Press `F5` in VS Code to launch the Extension Development Host.

### Tests and linting
```
npm test                 # node:test unit suite (parser, formatter, rules, webview HTML)
npm run test:integration # Extension Host smoke suite (@vscode/test-cli; downloads VS Code)
npm run lint             # eslint
```
The unit suite runs on plain Node with no VS Code needed. The integration suite
activates the extension for real and covers command registration, diagnostics,
the sort/clear commands (confirmation disabled), document formatting and the settings
panel. On a headless Linux box run it under `xvfb-run -a npm run test:integration`.

When you add a command or a settings group, also update `tutorialHtml.js`;
`test/tutorialHtml.test.js` fails until the tutorial documents it. The pull
request template repeats the reminder.

---

## Releasing

The **Build VSIX** workflow can bump the version for you:

1. In GitHub, open **Actions → Build VSIX → Run workflow**.
2. Pick the default branch (`master`) and a bump: `patch`, `minor`, `major`, or `none`.
3. Run it.

A bump run on the default branch:
- updates `package.json`, `package-lock.json` and the `CHANGELOG.md` heading through `npm version`,
- commits `chore(release): <version>` and tags `v<version>`,
- packages the VSIX, uploads the artifact and creates the GitHub release with the VSIX attached.

`none` rebuilds the current version without a commit, tag, or release. Normal pushes
to `master`/`main` and `v*` tags keep packaging only; a tag build also attaches the
VSIX to the release and fails if the tag does not match `package.json`.

The bump is pushed with the workflow's `GITHUB_TOKEN`, so it does not trigger a
second run, and the repository must allow GitHub Actions to push to the default
branch. If that push fails, no tag is created and the VSIX is still available as a
workflow artifact.

Locally, `npm version patch` performs the same version + changelog update, commit,
and tag; push with `git push --follow-tags`.

---

## Supported expression tags

The editor activates for cursor positions inside any of these tags:

`textFieldExpression`, `imageExpression`, `variableExpression`, `groupExpression`,
`printWhenExpression`, `initialValueExpression`, `filterExpression`, `expression`,
`jr:expression`, `defaultValueExpression`, `hyperlinkReferenceExpression`,
`subreportExpression`, `bucketExpression`, `keyExpression`, `valueExpression`,
`categoryExpression`, `seriesExpression`, `labelExpression`, `crosstabExpression`,
`bookmarkLevelExpression`, `chartTitleExpression`, `chartSubtitleExpression`,
`timePeriodExpression`, and more. The canonical list lives in
[expressionTags.js](expressionTags.js); `test/expressionUtils.test.js` fails if it
drifts from the TextMate grammar.

---

## Security notes

The expression editor, If / Else builder and design view webviews are rendered with a nonce-based Content-Security-Policy and no inline event handlers or style attributes. Expression text, report layout data, file names and declaration names are escaped (or embedded as JSON-escaped data) before they reach a panel, so `.jrxml` content cannot inject script. The panels load no remote resources and read report data in the extension host, not in the webview. Hovers are rendered as untrusted markdown.
