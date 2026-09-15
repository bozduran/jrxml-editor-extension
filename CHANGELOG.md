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

- Initial release
