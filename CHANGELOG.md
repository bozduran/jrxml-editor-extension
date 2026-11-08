# Change Log

All notable changes to the "jrxml-editor" extension will be documented in this file.

<!-- When adding a user-facing feature, update tutorialHtml.js. New commands and
     settings groups must be added to its DOCUMENTED_* lists; test/tutorialHtml.test.js
     enforces them. -->

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- **Workspace validation:** `JRXML: Validate Workspace` runs every check over
  all `.jrxml` files in the workspace and reports them in Problems. The same
  pipeline is available for CI as `node tools/validate-workspace.js`
  (`--json`, non-zero exit on errors).

## [0.5.0] - 2026-11-08

### Added
- **Layout validation:** columns that do not fit the page width, band heights
  that exceed the space between the margins, and elements that extend below
  their band (or frame) are reported as compile-time errors
  (`jrxml.lint.layout`).

## [0.4.0] - 2026-11-08

### Added
- **Subreports:** literal subreport expressions are resolved against the report
  directory and workspace, a missing target or a parameter the target report does
  not declare is reported, and go-to-definition opens the target `.jrxml`
  (`.jasper` paths map back to their source). Dynamic expressions are left alone.

## [0.3.0] - 2026-11-08

### Added
- **Dataset-scope awareness:** completion, hover, go-to-definition and references
  resolve against the report or the enclosing `<dataset>`/`<subDataset>`, including
  the contents of list/table dataset runs. A master field, parameter or variable used
  inside a subdataset is reported as out of scope; dataset members are no longer
  offered at report scope.
- **Duplicate-name diagnostics:** a field, parameter, variable, group, dataset or
  style declared more than once in the same scope is an error
  (`jrxml.lint.duplicateNames`).
- **Report language detection:** a report with `language="groovy"` or
  `"javascript"` gets a warning that only Java expressions are modeled, and Java
  typed member completion is disabled for it.
- **Resource bundles:** `$R{` completion from the report's `resourceBundle`
  (base file plus locale variants), hover with the default and localized values,
  go-to-definition into the `.properties` file, and warnings for a missing key
  or a bundle that cannot be found.

### Fixed
- References are collected from expression elements only: `$F{}` inside an XML
  comment or static `<text>` no longer raises a false "not declared" error or
  inflates the hover/reference count.
- `$P!{}` query fragments now support hover, go-to-definition, find-references and
  validation.
- Completion, hover, definition, references and diagnostics no longer merge report
  and dataset declarations into one scope.
- The expression-tag registry now matches the TextMate grammar, adding
  `crosstabExpression`, `bookmarkLevelExpression`, `chartTitleExpression`,
  `chartSubtitleExpression` and `timePeriodExpression` to the Expression Editor,
  completion, formatting and diagnostics.

## [0.2.0] - 2026-11-08

### Added
- **Design view:** a Jaspersoft Studio-style visual canvas for Studio 7 JRXML,
  opened beside the source with **JRXML: Open Design View** (editor title button
  and JRXML submenu). It shows the page, margins, columns, bands, element
  geometry, local default/named styles, text, shapes and frames, labels
  images/subreports/charts/tables, marks page breaks and supports click-to-reveal
  in the source. The panel follows the active report and updates as you type.
  Classic-format and malformed files show an explanatory banner; expressions are
  not evaluated and no data is loaded.
- **Design view selection sync:** moving the source cursor highlights and scrolls
  the matching element or band in the panel; **Follow** toggles the behaviour.
- **Design view editing:** an opt-in **Edit** mode adds drag-to-move, eight resize
  handles and an inspector for geometry, text/expression content (CDATA preserved),
  font family/size/style, alignment, rotation, markup, colours and mode. Every
  change is one undoable `WorkspaceEdit`, guarded by the document version so a
  stale drag cannot overwrite newer source edits. Inherited styles are left
  untouched and shared `<style>` definitions are never modified.
- **Design view autocomplete:** the inspector's expression textarea now uses the
  same suggestion engine as the `.jrxml` editor — fields, parameters, variables,
  Jasper built-ins, Java types/statics, local static methods and typed members,
  with snippet placeholders. `Ctrl+Space` opens the list; arrows navigate;
  Enter/Tab inserts; Escape closes. Fields completed inside `$F{...}` add the
  closing brace when it is missing.
- **Design view inspector:** the property panel now also covers print/behaviour
  (`positionType`, `stretchType`, repeated values, blank lines, print-on-overflow,
  evaluation time/group, key, bookmark), named styles, text adjust/pattern/
  blankWhenNull, image scale/alignment/error/cache/link settings, line
  direction/width/style/colour, rectangle radius, break type, subreport options,
  border/padding, and an **All attributes** editor for arbitrary element
  attributes. Drawn lines now honour diagonal `TopDown`/`BottomUp` direction and
  border widths, and `elementGroup` containers render their children.
- **If / Else builder — expression results:** branch and else results can now be
  arbitrary expressions, not just text or numbers. The result field is a multiline
  editor for Expression results, expressions are inserted verbatim, and loading an
  existing expression keeps arithmetic, concatenation, method calls and `new`
  expressions instead of failing. Conditions the builder cannot represent still
  load as Custom conditions.
- **Tutorial:** a built-in HTML guide opened with **JRXML: Open Tutorial**, the
  JRXML menu or the **Open tutorial** button in the Settings panel. It covers the
  editor, Expression Editor, If / Else builder (including expression results),
  design view, Issues, formatting, clean-up, include chain, every
  command, shortcut and settings group, and has command links that open the
  matching feature.
- **Tutorial coverage guard:** `test/tutorialHtml.test.js` compares the
  documented commands and settings groups with `package.json` and
  `settingsSchema.js`, so adding a user-facing command or settings group fails
  `npm test` until `tutorialHtml.js` is updated. A pull-request template repeats
  the reminder.

### Changed
- **If / Else builder and snippets:** String and Boolean equality now emit the
  JasperReports `EQUALS(...)` / `NOT(EQUALS(...))` helpers instead of
  `.equals(...)`. The `jequals` snippet gained the `jrequals` alias and inserts
  `EQUALS(value, expected)`.
- **Settings:** `jrxml.clear.preview` / `jrxml.sort.preview` are now
  `jrxml.clear.confirm` / `jrxml.sort.confirm`. The names match the behaviour:
  the diff preview always opens, and the setting controls whether the destructive
  apply asks for confirmation.
- **Navigation:** **Go to Next / Previous Issue** now use `Ctrl+Alt+N` / `Ctrl+Alt+P`
  (`Cmd+Alt+N` / `Cmd+Alt+P` on macOS) instead of `Ctrl+Alt+Down` / `Ctrl+Alt+Up`,
  which overrode VS Code's add-cursor-below/above shortcuts while a `.jrxml` editor
  had focus.

### Removed
- **Best Practices view:** its only rule (Boolean comparisons) now runs as the
  normal `jrxml.booleanEquals` diagnostic with a one-click `EQUALS(...)` fix in
  the Issues view. The separate view, diagnostics collection,
  `jrxml.suppressedBestPractices` setting, and the `jrxml.bp.*` /
  `jrxml.refreshBestPractices` commands were removed. The view's inline
  “Elements are not sorted by position” item went with it; the sort command
  itself remains in the **JRXML** menu and the Command Palette.

### Fixed
- **Design view autocomplete:** the inspector no longer stops requesting
  suggestions while typing inside `$F{…}` / `$P{…}` / `$V{…}` or after a dot. The
  client script is now a real JavaScript asset, so its regex escapes are not
  consumed by the host template literal.
- **If / Else builder:** loading an expression whose results used arithmetic or
  concatenation (`$F{a} + " " + $F{b}`) failed with "Cannot read near…"; results
  are now captured as opaque source.

## [0.1.2] - 2026-11-03

### Fixed
- **Expression editor:** reopening the panel or switching to another expression no longer
  discards unsaved text, cursor position or the Auto-format checkbox. Drafts are kept per
  expression while the panel is open, the Auto-format choice is remembered through
  `jrxml.expressionEditor.autoFormat`, and auto-open no longer steals focus.
- **If / Else hand-off:** the **If / Else…** button in the Expression Editor could fail
  with `IfElsePanel.createOrShow is not a function`; it now opens the builder correctly.

### Added
- **Entry points:** editor-title icons for the Expression Editor and If / Else Builder,
  `Ctrl+Alt+E` / `Ctrl+Alt+B` keybindings, quick-start actions in the empty Issues view,
  and a **Get started with JRXML** walkthrough.
- **Diagnostics:** any diagnostic inside an expression now offers **Edit expression in
  Expression Editor** and **Open expression in If / Else Builder**; the Issues view adds
  matching context-menu actions.
- **Navigation:** Find All References for `$F{}`, `$P{}` and `$V{}`, from a reference or
  from a declaration.
- **Snippets:** a JRXML snippet library (`jif`, `jternary`, `jnullsafe`, `jtext`,
  `jdecimal`, `jdate`, …) and a **Format Expression at Cursor** command.
- **Snippets:** date/time helpers for common report logic — today as a string,
  today plus days, today before/after a string date, string-to-date parsing,
  comparing two string dates, date differences, report-time-zone and report-locale
  variants.
- **If / Else builder:** a new `JRXML: Open If / Else Builder` webview panel that builds
  `if / else if / else` conditions as a nested ternary or as `IF()` / `AND()` / `OR()`,
  with null-safe guards, live output and reverse conversion of pasted expressions.
- **If / Else builder:** reads the open `.jrxml`'s fields, parameters and variables
  automatically (plus the JasperReports built-in variables and parameters) — no file
  upload. The lists refresh on save and when declarations change; **Reload** and
  **Use active file** re-attach the schema and the apply target. Names that are not
  declared in the report are called out in the panel.
- **If / Else builder:** **Apply to File** writes the result back into the expression
  tag the builder was opened from (CDATA preserved, one undoable edit) and **Copy**
  uses the VS Code clipboard. A preload from the cursor/selection and an **If / Else…**
  button in the expression editor hand expressions over to the builder.
- **Settings:** `jrxml.ifElse.nullSafe`, `jrxml.ifElse.multiline` and
  `jrxml.ifElse.style` control the builder defaults; string settings with enumerated
  options now render as a dropdown in the settings panel.
- **Views:** the Issues, Best Practices and Include Chain views now live under a
  dedicated **JRXML** icon in the Activity Bar instead of the Explorer, with a new
  monochrome document/XML icon. Their view IDs, commands and view-title actions are
  unchanged.

## [0.1.1] - 2026-11-03

### Added
- **Completion:** typed member completion. After `$F{...}`, `$P{...}` or `$V{...}`, a `.` now completes the
  Java members of the declaration's `class`, including overloads with snippets, inherited members,
  deprecation flags and method chains (`$F{Name}.trim().`). Works for the JasperReports built-in
  parameters (`$P{REPORT_DATA_SOURCE}.` → `next()`, `getFieldValue(String)`).
- **Completion:** `jrxml.typeCompletion.jdkBaseline` (default `8`) hides members newer than the target
  JDK, so a Java 8 report is never offered `String.isBlank` or `List.getFirst`.
- **Completion:** when a receiver cannot be typed, one explanation is offered instead of an unrelated
  list — an undeclared `class` attribute, a class outside the index, or an ambiguous short name.
- **Data:** `data/jdk-members.json`, generated from `javap` by `npm run gen:jdk-index`, plus the
  hand-curated `data/extra-types.json` for JasperReports engine types.

### Changed
- **Completion:** the parser now records whether a declaration's `class` was written or has to be
  inferred from the data source, so "unknown type" is no longer reported as `java.lang.Object`.

## [0.1.0] - 2026-09-16

### Fixed
- **Undeclared references:** a `<subreportParameter name="…">` or a `<parameter>`
  nested in a subreport names the *subreport's* parameter, so it is no longer
  reported as `Parameter '…' is not declared in this report`. Its value
  expression is still validated, and `<returnValue toVariable="…">` is still
  checked because that variable does belong to this report.
- **Unused warnings:** a field/parameter/variable used only before its
  declaration, or only from an expression-bearing element outside the hook's
  narrow set (`propertyExpression`, `imageExpression`, `subreportExpression`,
  `filterExpression`, chart/hyperlink expressions,
  `subreportParameterExpression`, `<sortField name="…">`, …), is no longer
  flagged as unused. References are now collected from every expression
  element.
- **Unused warnings:** declarations are now scoped by the XML tree. Only direct
  children of `<jasperReport>` are report declarations; `<dataset>` /
  `<subDataset>` members are dataset scope, and a `<parameter>` passed into a
  subreport (classic or `<element kind="subreport">`) or a `<datasetRun>` is
  neither — so dataset fields and subreport parameters are no longer reported,
  offered for deletion, or listed as report declarations. Dataset declarations
  still resolve references inside their dataset.
- **Unused warnings:** a document that cannot be scanned no longer flags every
  declaration as unused; the check is skipped when usage cannot be determined.
- **Scanner:** `<!DOCTYPE …>` declarations are skipped instead of rejected, so
  real JasperReports files that carry a DTD scan again. The DTD is never
  fetched and entities are never expanded, so XXE/SSRF/entity-expansion are
  still impossible.

### Added
- New **Issues (JRXML)** Explorer view, declared above Best Practices. It lists
  every `JRXML` diagnostic — undeclared references, unbalanced parentheses,
  unclosed strings, unused declarations, the structural lint rules and
  textcheck (missing space after `.`, double spaces, unrenderable characters,
  newlines) — plus the SQL→jsonql migration action, grouped into
  Errors / Warnings / Actions with a count badge. Clicking an item jumps to it.
  The geometry sort stays in Best Practices.
- Act on Issues (JRXML) items in place: an inline **Fix** runs the lightbulb's
  quick fix, **Fix All Issues in File** applies every preferred fix as one
  undoable edit (skipping overlapping ranges; non-preferred fixes such as
  "remove unused declaration" stay opt-in), and the item context menu offers
  Go to Issue · Fix · Copy Message · Copy Rule ID.
- A **JRXML** submenu in the editor context menu, on the editor tab and on
  `.jrxml` files in the Explorer: Open Expression Editor · Fix All Issues in
  File · Fix All (Format and Text) · Format Document · Apply Clear Fixes ·
  Sort Elements by Position · Migrate SQL Query · Open Settings. The
  destructive entries only appear when the open file actually has that work
  (`jrxml.hasClearFixes` / `jrxml.hasSortIssue` / `jrxml.hasSqlMigration`).
- Navigate issues from the keyboard: `JRXML: Go to Next/Previous Issue`
  (`Ctrl+Alt+Down` / `Ctrl+Alt+Up` in a `.jrxml` editor) wraps around the file,
  and the status bar shows the current issue count with a click-through to the
  Issues (JRXML) view. Both are also in the JRXML context submenu.
- New **`jrxml.lint.variableOrder`** warning (default on, toggle in Settings):
  a variable that references another variable declared *later* in the same
  scope, which JasperReports evaluates in declaration order. Self-references
  (accumulators), built-in variables and cross-scope (report vs dataset)
  references are not flagged. Warning only — declarations are never reordered.
- Ported the commit-time `myhooks` hook's `lint` step into the editor as three
  structural diagnostics, each with a quick fix and its own toggle:
  - `jrxml.lint.constantPrintWhen` — a `<printWhenExpression>` that is literally
    `true` or `false`.
  - `jrxml.lint.removeLineWhenBlank` — a `textField`/`subreport` missing
    `removeLineWhenBlank="true"` (or carrying a different value).
  - `jrxml.lint.markupTagWithoutMarkup` — markup tags inside a textField
    expression while `markup` is not `styled`, `html` or `rtf`.
- Offset-accurate XML scanner (`xmlspan.js`) and edit helpers (`edits.js`) used by
  the lint rules and their quick fixes.
- Golden-fixture tests copied from the hook repository (`LintEdgeReport`,
  `Blank_A4_1`, `MarkupReport`, `TextReport`) with expectations recorded from the
  hook's own output.
- Ported the hook's `format` step: `jasperReport/@name` alignment with the file
  base name, `positionType="Float"` on textField/subreport (anchored after `uuid`,
  else `kind`), `textAdjust="StretchHeight"` on textField, and Java-expression
  spacing (`javaExpr.js`). The formatter masks literals and
  `$F{}`/`$P{}`/`$V{}`/`$P!{}` references, leaves generic type arguments alone,
  and returns the input unchanged when it is not confident it is Java.
- Ported the hook's `textcheck` step (`textRules.js`): unrenderable characters,
  period spacing, double spaces, and markup-aware newline normalization, applied
  to `<text>` CDATA and to the string/text-block literals inside expressions.
- `DocumentFormattingEditProvider` (Format Document) and the `source.fixAll.jrxml`
  "Fix all JRXML format and text issues" action, both limited to format +
  textcheck. `jrxml.formatOnSave` returns as an explicit opt-in backed by a
  `WorkspaceEdit`.

- Ported the hook's `clear` step: expression-scoped unused-declaration deletion
  with the hook's built-in parameter exemptions and line-aware removal,
  description/jsonql synchronization, the legacy→jsonql rename/remove/add fixes,
  and SQL→jsonql query migration. `jrxml.applyClearFixes` and
  `jrxml.migrateSqlQuery` preview the change first.
- Ported the hook's `sort` step: band/frame direct element children ordered by
  y then x, moving each element's preceding trivia, with missing-coordinate and
  overlap warnings; `jrxml.sortElements` shows a diff before applying.
- Added `jrxml.lint.uncheckedNullDereference`, backed by a scoped Java
  expression parser (`javaParser.js`): short-circuit-aware null-check analysis
  recognising `!= null` / `== null` (either operand order), `!(...)`,
  `EQUALS(ref, null)` and `Objects.equals`/`nonNull`/`isNull`. The former
  `jrxml.bp002.nullSafeString` and `jrxml.bp003.optionalNullable` best practices
  are retired in its favour.
- The unused-declaration diagnostics and their "Remove unused…" quick fix now
  use the same expression-scoped reference collection and line-aware removal as
  the clear step.
- Shared diff-preview provider (`preview.js`), and XML entity decoding/encoding
  aligned with the hook (single-pass named+numeric decode, attribute encoder).

- Added a dedicated settings panel (`JRXML: Open Settings`) with grouped,
  live-bound toggles for every `jrxml.*` setting, plus filtering and
  "Reset all to defaults". Its schema is cross-checked against `package.json` by
  a test so the panel cannot drift.
- The Best Practices (JRXML) view now lists file-level issues alongside rule hits:
  "Elements are not sorted by position" (inline action opens the sort diff) and
  "SQL query can be migrated to …" (inline action runs the migration).
- Added `jrxml.migrate.targetLanguage` (default `jsonql`), used as the migration
  target instead of a hardcoded value.

- Text-check problems are now **diagnostics with quick fixes**, not only
  formatter edits: double spaces, a missing space after `.`, unrenderable
  characters and newline normalization are flagged inside `<text>` CDATA and
  inside string/text-block literals (code `jrxml.textcheck`), gated by
  `jrxml.textcheck.diagnostics`.

### Fixed
- Destructive commands (sort, clear, SQL migration) now **refuse to apply** edits
  discovered before the diff preview and confirmation if the document changed in
  the meantime, instead of overwriting the newer content. A `WorkspaceEdit`
  applies its ranges to the current text, so the previous behaviour could
  corrupt the file or silently drop edits made while the preview was open.
- A rule that throws no longer blanks every diagnostic: the linter isolates each
  rule and the diagnostics provider isolates each section, logging the failure
  and carrying on.
- Deeply nested input can no longer overflow the call stack: the Java expression
  parser has a depth cap (over-deep expressions are skipped, as with any
  unparseable input), and the XML walk and sort walk are now iterative.

### Added
- Extension Host smoke suite via `@vscode/test-cli`
  (`npm run test:integration`): activates the extension, asserts every
  contributed command is registered, and exercises diagnostics, the sort and
  clear commands (preview disabled), document formatting and the settings panel.

### Added
- New Explorer view **Include Chain (JRXML)**, shown right after Best Practices.
  For the open report it renders the chain of templates that include it,
  **top-down** from the top template to the open file (highlighted), following
  the hook's base-name rule: a file calls another when it contains a quoted token
  equal to that file's base name. Nodes are workspace-relative paths that open
  the file on click, and a report nothing calls shows `(not referenced)`.
- The chain view scans the workspace once (`**/*.jrxml`, excluding
  `node_modules`/`out`/`target`/`bin`), caches file text by mtime, and refreshes
  on active-editor changes, edits, saves, file create/delete/rename and
  workspace-folder changes, plus the `jrxml.refreshIncludeChain` command.

### Not ported (deliberately)
- The hook's `validate`/`compile` gate — it needs the JasperReports engine.

## [0.0.2]

### Fixed
- **Parser:** removed duplicated function bodies that shadowed the subreport-aware
  `extractReferences()`, which silently dropped `<parameter>` tags nested in
  `<element kind="subreport">` and produced false "declared but never used" warnings.
- **Parser:** `name="..."` offsets are now correct for single-quoted attributes, so
  diagnostics and go-to-definition land on the name value.
- **Parser/Outline:** `<textFieldExpression>` is no longer reported as a second
  `textField` node, CDATA is stripped from labels, and outline symbols now use real
  ranges that contain their children.
- **Security:** the expression webview now uses a nonce-based Content-Security-Policy,
  no inline event handlers, and escapes `<` when embedding the expression, so a
  `</script>` in a `.jrxml` file can no longer break out of the data block.
- **Security:** help hovers are rendered as untrusted markdown and escape
  file-derived text, so a crafted `<description>` cannot inject `command:` links.
- **Diagnostics:** `jrxml.showUnusedWarnings` and `jrxml.validateExpressions` are now
  honoured (they were declared but never read).
- **Best practices:** BP003 no longer treats Boolean values as nullable, so bare
  Boolean references are handled only by BP001 instead of two rules offering
  conflicting quick fixes on the same range.
- **Completion:** the `src/main/java` helper scan is invalidated when Java sources or
  workspace folders change, and unreadable directories no longer throw. Builtin items
  no longer displayed `undefined` as their full type.
- **Formatter:** the closing parenthesis of an expanded argument list follows
  `jrxml.indentSize` instead of a hardcoded 4 spaces.

### Changed
- Consolidated the duplicated built-in parameter/variable tables into `jasperBuiltins.js`.
- Removed the dead on-save formatting path (`jrxml.formatOnSave` was never declared).
- Removed the unused `normalizeCommaSpacing()` helper and a leftover statement in the
  expression panel constructor.
- De-duplicated the `contributes.commands` entries in `package.json`.

### Added
- `npm test` — a `node:test` unit suite covering the parser, formatter, expression
  utilities, webview HTML builder and builtin tables.
- `npm run lint` with a corrected ESLint flat config, plus `@types/vscode`/`@types/node`
  so `jsconfig.json` type-checking resolves the `vscode` module.
