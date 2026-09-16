# Change Log

All notable changes to the "jrxml-editor" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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

## [Unreleased]

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
