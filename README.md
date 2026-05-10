# JRXML Editor

A VS Code extension for working with JasperReports `.jrxml` files — focused on making expressions readable and editable.

---

## Features

### 1. Syntax Highlighting
`.jrxml` files get a dedicated language mode with:
- **JasperReports built-in functions** (`TODAY`, `IF`, `SUM`, `MIN`, `MAX`, etc.) — highlighted in purple
- **Java keywords** (`if`, `else`, `new`, `null`, `true`, `false`, …) — blue
- **Java types** (`String`, `Integer`, `BigDecimal`, `Date`, …) — teal
- **Method calls** — yellow
- **Jasper field/param/variable references** (`$F{name}`, `$P{name}`, `$V{name}`, `$R{name}`) — cyan/blue
- **String literals, numbers, comments** — standard colors

### 2. Expression Editor Panel
Open any expression in a dedicated side panel:
- **Edit** pane — editable text area
- **Preview** pane — live syntax-highlighted view with bracket colorization
- **Format** button — auto-formats Java expressions into readable multi-line form
  - Ternary chains → indented `? / :` layout
  - Method chains → one call per line
  - Long `&&` / `||` / `+` lines → broken at operators
  - Long argument lists → one arg per line
- **Apply to File** — writes the edited expression back into the `.jrxml` file
- **Copy** — copies expression to clipboard
- **Reset** — reverts to the original expression
- **Auto-format** checkbox — formats while you type

### 3. Bracket / Parenthesis Colorization
Inside the expression preview, brackets are colored by depth:
- Level 1: **Gold**
- Level 2: **Orchid**
- Level 3: **Sky blue**

🔧 Updated Features section (add this)

### 4. Best Practices & Null Safety Recommendations

The editor provides inline recommendations to improve expression quality:

Suggests null-safe patterns (e.g., avoiding direct .toString() on nullable values)
Encourages defensive checks ($F{field} != null)
Highlights risky constructs that may cause runtime exceptions in JasperReports
Promotes cleaner, more maintainable expressions

### 5. Smart Autocomplete (Experimental)

Autocomplete is enhanced with JRXML-aware intelligence:

Suggests fields, parameters, and variables ($F, $P, $V)
Includes jaspersoft native functions
Detects and includes user-defined helper functions
Scans project files to provide custom function suggestions
Improves discoverability of reusable logic

---

## Usage

1. Open any `.jrxml` file
2. Place your cursor **inside** an expression tag (e.g., `<textFieldExpression>`)
3. Either:
   - Right-click → **JRXML: Open Expression Editor**
   - Click **`$(edit) JRXML Expr`** in the status bar (bottom right)

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `jrxml.indentSize` | `4` | Spaces per indent level when formatting |
| `jrxml.autoOpenEditor` | `false` | Auto-open editor when cursor enters an expression |

---

## Installation

### From .vsix file
1. Open VS Code
2. `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
3. Select `jrxml-editor-extension-1.0.0.vsix`

### Manual (development)
```
cd jrxml-editor-extension
npm install
```
Press `F5` in VS Code to launch the Extension Development Host.

---

## Supported Expression Tags

The editor activates for cursor positions inside any of these tags:

`textFieldExpression`, `imageExpression`, `variableExpression`, `groupExpression`,
`printWhenExpression`, `initialValueExpression`, `filterExpression`, `expression`,
`jr:expression`, `defaultValueExpression`, `hyperlinkReferenceExpression`,
`subreportExpression`, `bucketExpression`, `keyExpression`, `valueExpression`,
`categoryExpression`, `seriesExpression`, `labelExpression`, and more.
