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

### Not ported (deliberately)
- The hook's `validate`/`compile` gate — it needs the JasperReports engine.
