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
- **Auto-format on change** checkbox

### 3. Bracket / parenthesis colorization
Inside the expression preview, brackets are colored by depth (level 1 gold, level 2 orchid, level 3 sky blue).

### 4. Diagnostics
- Unused fields, parameters and variables
- Undeclared `$F`/`$P`/`$V` references
- Unbalanced parentheses and unclosed string literals
- **Structural lint rules** ported from the project's commit-time `myhooks` hook:
  - `jrxml.lint.constantPrintWhen` — a `<printWhenExpression>` that is literally `true` or `false`
  - `jrxml.lint.removeLineWhenBlank` — a `textField`/`subreport` missing `removeLineWhenBlank="true"` (or with another value)
  - `jrxml.lint.markupTagWithoutMarkup` — markup tags inside a textField expression while `markup` is not `styled`, `html` or `rtf`

  Each has a quick fix and can be switched off individually. The hook's structural
  `validate`/`compile` gate is intentionally **not** ported (it needs the JasperReports engine).
- Outline, hover and go-to-definition for `$F{}` / `$P{}` / `$V{}`

### 5. Document formatting and text check
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

### 6. Best practices & null-safety recommendations
An extensible rules engine surfaces inline recommendations and quick fixes:

| Rule | What it flags |
|------|---------------|
| `jrxml.bp001.booleanEquals` | `==`/`!=` on Boolean values → use `EQUALS(...)` / `NOT(EQUALS(...))` |
| `jrxml.bp002.nullSafeString` | `$F{x}.equals("literal")` → flip to `"literal".equals($F{x})` |
| `jrxml.bp003.optionalNullable` | bare nullable references → `Optional.ofNullable($F{x}).orElse(<default>)` |

Warnings can be suppressed per rule from the **Best Practices (JRXML)** view or the lightbulb menu; quick fixes remain available while suppressed.

### 7. Smart autocomplete
Context-aware completion for fields, parameters and variables, JasperReports built-ins, common Java statics, and **user-defined `public static` helper methods** discovered under `src/main/java`. The Java scan is cached and re-runs when `.java` files or workspace folders change.

---

## Usage

1. Open any `.jrxml` file
2. Place your cursor **inside** an expression tag (e.g. `<textFieldExpression>`)
3. Either:
   - Right-click → **JRXML: Open Expression Editor**
   - Click **`$(edit) JRXML Expr`** in the status bar (bottom right), or run **JRXML: Open Expression Editor** from the command palette

---

## Commands

| Command | Description |
|---------|-------------|
| `JRXML: Open Expression Editor` | Open the expression under the cursor in the side panel |
| `JRXML: Go to Declaration` | Jump from `$F{}`/`$P{}`/`$V{}` to its declaration |
| `JRXML: Refresh Best Practices` | Re-run the best-practice rules |
| `JRXML: Suppress Best Practice Rule` | Hide squiggles for a rule (quick fixes stay) |
| `JRXML: Re-enable Best Practice Rule` | Restore squiggles for a rule |
| `JRXML: Jump to Issue` | Move the cursor to a reported best-practice hit |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `jrxml.indentSize` | `4` | Spaces per indent level when formatting expressions |
| `jrxml.autoOpenEditor` | `false` | Auto-open the editor when the cursor enters an expression |
| `jrxml.showUnusedWarnings` | `true` | Warn about declared fields/parameters/variables that are never used |
| `jrxml.validateExpressions` | `true` | Error on unbalanced parentheses, unclosed strings and undeclared `$F`/`$P`/`$V` references |
| `jrxml.lint.constantPrintWhen` | `true` | Warn when `<printWhenExpression>` is a constant `true`/`false` |
| `jrxml.lint.removeLineWhenBlank` | `true` | Warn when a `textField`/`subreport` is missing `removeLineWhenBlank="true"` |
| `jrxml.lint.markupTagWithoutMarkup` | `true` | Warn when markup tags are used without `markup="styled"`/`html`/`rtf` |
| `jrxml.format.reportName` | `true` | Set `jasperReport/@name` to the file base name |
| `jrxml.format.positionType` | `true` | Add/set `positionType="Float"` on `textField`/`subreport` |
| `jrxml.format.textAdjust` | `true` | Add/set `textAdjust="StretchHeight"` on `textField` |
| `jrxml.format.expression` | `true` | Normalize expression operator/ternary/comma/cast spacing |
| `jrxml.textcheck.enabled` | `true` | Rendered-text rules in text and string literals |
| `jrxml.formatOnSave` | `false` | Run format + textcheck on save (never clear/sort) |
| `jrxml.suppressedBestPractices` | `[]` | Best-practice rule IDs whose squiggles are hidden |

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
npm test     # node:test unit suite (parser, formatter, utilities, webview HTML, builtins)
npm run lint # eslint
```

---

## Supported expression tags

The editor activates for cursor positions inside any of these tags:

`textFieldExpression`, `imageExpression`, `variableExpression`, `groupExpression`,
`printWhenExpression`, `initialValueExpression`, `filterExpression`, `expression`,
`jr:expression`, `defaultValueExpression`, `hyperlinkReferenceExpression`,
`subreportExpression`, `bucketExpression`, `keyExpression`, `valueExpression`,
`categoryExpression`, `seriesExpression`, `labelExpression`, and more.

---

## Security notes

The expression panel webview is rendered with a nonce-based Content-Security-Policy and no inline event handlers; expression text is escaped before being embedded, so `.jrxml` content cannot inject script into the panel. Hovers are rendered as untrusted markdown.
