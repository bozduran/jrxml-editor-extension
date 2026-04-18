// diagnosticsProvider.js
// Produces:
//   WARNING  — declared field/parameter/variable never used in any expression
//   ERROR    — $F/$P/$V reference to a name that isn't declared
//   ERROR    — unbalanced parentheses inside an expression tag
//   WARNING  — unclosed string literal inside an expression tag

const vscode = require('vscode');
const { parseDeclarations } = require('./jrxmlParser');
const { EXPRESSION_TAGS } = require('./expressionUtils');

// Built-in names that should never be flagged as "undeclared"
const BUILTIN_VARS = new Set([
    'PAGE_NUMBER','PAGE_COUNT','REPORT_COUNT','COLUMN_NUMBER','COLUMN_COUNT',
    'MASTER_CURRENT_PAGE','MASTER_TOTAL_PAGES','PAGE_VARIABLE_COUNT',
]);
const BUILTIN_PARAMS = new Set([
    'REPORT_CONNECTION','REPORT_DATA_SOURCE','REPORT_PARAMETERS_MAP',
    'IS_IGNORE_PAGINATION','REPORT_LOCALE','REPORT_TIME_ZONE',
    'REPORT_FORMAT_FACTORY','REPORT_CLASS_LOADER','REPORT_MAX_COUNT',
    'REPORT_VIRTUALIZER','REPORT_TEMPLATES','REPORT_URL_HANDLER_FACTORY',
]);

const diagnosticCollection = vscode.languages.createDiagnosticCollection('jrxml');

/**
 * Run all checks on a document and update the diagnostic collection.
 * @param {vscode.TextDocument} document
 */
function updateDiagnostics(document) {
    if (!document.fileName.endsWith('.jrxml')) {
        diagnosticCollection.delete(document.uri);
        return;
    }

    const diagnostics = [];
    const text   = document.getText();
    const parsed = parseDeclarations(document);

    // ── 1. Unused declarations ────────────────────────────────────────────────
    const usedFields  = new Set(parsed.references.filter(r => r.sigil === 'F').map(r => r.name));
    const usedParams  = new Set(parsed.references.filter(r => r.sigil === 'P').map(r => r.name));
    const usedVars    = new Set(parsed.references.filter(r => r.sigil === 'V').map(r => r.name));

    for (const f of parsed.fields) {
        if (!usedFields.has(f.name)) {
            diagnostics.push(makeDiagnostic(
                document, f.nameOffset, f.name.length,
                `Field '${f.name}' is declared but never used in any expression.`,
                vscode.DiagnosticSeverity.Warning,
                'jrxml.unusedField'
            ));
        }
    }

    for (const p of parsed.parameters) {
        if (p.isSystem) continue; // skip built-in system params
        if (!usedParams.has(p.name)) {
            diagnostics.push(makeDiagnostic(
                document, p.nameOffset, p.name.length,
                `Parameter '${p.name}' is declared but never used in any expression.`,
                vscode.DiagnosticSeverity.Warning,
                'jrxml.unusedParameter'
            ));
        }
    }

    for (const v of parsed.variables) {
        if (!usedVars.has(v.name)) {
            diagnostics.push(makeDiagnostic(
                document, v.nameOffset, v.name.length,
                `Variable '${v.name}' is declared but never used in any expression.`,
                vscode.DiagnosticSeverity.Warning,
                'jrxml.unusedVariable'
            ));
        }
    }

    // ── 2. Undeclared references ──────────────────────────────────────────────
    const declaredFields  = new Set(parsed.fields.map(f => f.name));
    const declaredParams  = new Set([...parsed.parameters.map(p => p.name), ...BUILTIN_PARAMS]);
    const declaredVars    = new Set([...parsed.variables.map(v => v.name), ...BUILTIN_VARS]);

    for (const ref of parsed.references) {
        let isDeclared = false;
        if (ref.sigil === 'F') isDeclared = declaredFields.has(ref.name);
        else if (ref.sigil === 'P') isDeclared = declaredParams.has(ref.name);
        else if (ref.sigil === 'V') isDeclared = declaredVars.has(ref.name);

        if (!isDeclared) {
            const kindName = ref.sigil === 'F' ? 'Field' : ref.sigil === 'P' ? 'Parameter' : 'Variable';
            // The full token is $X{name} — length = 4 + name.length
            const tokenLen = 3 + ref.name.length + 1; // $F{ + name + }
            diagnostics.push(makeDiagnostic(
                document, ref.offset, tokenLen,
                `${kindName} '${ref.name}' is not declared in this report.`,
                vscode.DiagnosticSeverity.Error,
                'jrxml.undeclaredReference'
            ));
        }
    }

    // ── 3. Expression syntax validation ──────────────────────────────────────
    const exprTagRe = new RegExp(
        `(<(?:${EXPRESSION_TAGS.join('|')})(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/(?:${EXPRESSION_TAGS.join('|')})>)`,
        'g'
    );

    let em;
    while ((em = exprTagRe.exec(text)) !== null) {
        const openTag    = em[1];
        const inner      = em[2];
        const exprOffset = em.index + openTag.length;

        // Strip CDATA
        const rawExpr = inner
            .replace(/^\s*<!\[CDATA\[/, '')
            .replace(/\]\]>\s*$/, '')
            .trim();

        if (!rawExpr) continue;

        // Check unbalanced parens
        const parenError = checkParens(rawExpr);
        if (parenError) {
            const errOffset = exprOffset + inner.indexOf(rawExpr) + parenError.index;
            diagnostics.push(makeDiagnostic(
                document, errOffset, 1,
                parenError.message,
                vscode.DiagnosticSeverity.Error,
                'jrxml.unbalancedParen'
            ));
        }

        // Check unclosed strings
        const strError = checkUnclosedString(rawExpr);
        if (strError) {
            const errOffset = exprOffset + inner.indexOf(rawExpr) + strError.index;
            diagnostics.push(makeDiagnostic(
                document, errOffset, rawExpr.length - strError.index,
                strError.message,
                vscode.DiagnosticSeverity.Warning,
                'jrxml.unclosedString'
            ));
        }
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

// ── Syntax checkers ───────────────────────────────────────────────────────────

/**
 * Check for unbalanced ( ) [ ] in the expression.
 *
 * Rules:
 *  - Only " is treated as a string delimiter (not '). Single quotes are
 *    common inside Jasper string literals: "it's fine", "O'Brien".
 *  - $F{} $P{} $V{} curly braces are skipped — they are Jasper syntax,
 *    not Java block braces, and should not be paren-matched.
 *  - Only ( ) [ ] are checked — { } are too ambiguous in JRXML context.
 */
function checkParens(expr) {
    const stack = [];
    const pairs = { ')': '(', ']': '[' };
    let inStr = false;

    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];

        // Skip Jasper $F{} $P{} $V{} $R{} $X{} tokens entirely
        if (ch === '$' && i + 1 < expr.length && 'FPVRXfpvrx'.includes(expr[i + 1]) && expr[i + 2] === '{') {
            // Skip to the closing }
            i += 3;
            while (i < expr.length && expr[i] !== '}') i++;
            continue;
        }

        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inStr = false;
            continue;
        }

        // Only " starts a string — NOT single quote
        if (ch === '"') { inStr = true; continue; }

        if ('(['.includes(ch)) {
            stack.push({ ch, index: i });
        } else if (')]'.includes(ch)) {
            if (stack.length === 0 || stack[stack.length - 1].ch !== pairs[ch]) {
                return { index: i, message: `Unmatched closing '${ch}' in expression.` };
            }
            stack.pop();
        }
    }

    if (stack.length > 0) {
        const unclosed = stack[stack.length - 1];
        return { index: unclosed.index, message: `Unclosed '${unclosed.ch}' in expression.` };
    }
    return null;
}

/**
 * Check for unclosed double-quoted string literals.
 * Single quotes are intentionally ignored — they appear constantly inside
 * double-quoted strings in Jasper expressions and are not Java char literals.
 */
function checkUnclosedString(expr) {
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];

        // Skip Jasper $X{} tokens so their content doesn't confuse us
        if (ch === '$' && i + 1 < expr.length && 'FPVRXfpvrx'.includes(expr[i + 1]) && expr[i + 2] === '{') {
            i += 3;
            while (i < expr.length && expr[i] !== '}') i++;
            continue;
        }

        if (ch === '"') {
            const start = i;
            i++;
            while (i < expr.length) {
                if (expr[i] === '\\') { i += 2; continue; }
                if (expr[i] === '"')    { break; }
                i++;
            }
            if (i >= expr.length) {
                return { index: start, message: 'Unclosed string literal (missing closing ").' };
            }
        }
    }
    return null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function makeDiagnostic(document, offset, length, message, severity, code) {
    const start = document.positionAt(offset);
    const end   = document.positionAt(offset + length);
    const diag  = new vscode.Diagnostic(new vscode.Range(start, end), message, severity);
    diag.source = 'JRXML';
    diag.code   = code;
    return diag;
}

// ── Registration helper ───────────────────────────────────────────────────────

function register(context) {
    context.subscriptions.push(diagnosticCollection);

    // Run on open
    if (vscode.window.activeTextEditor?.document.fileName.endsWith('.jrxml')) {
        updateDiagnostics(vscode.window.activeTextEditor.document);
    }

    // Run when a jrxml doc changes (debounced 500ms)
    let debounceTimer;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (!e.document.fileName.endsWith('.jrxml')) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => updateDiagnostics(e.document), 500);
        })
    );

    // Run when switching tabs
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor?.document.fileName.endsWith('.jrxml')) {
                updateDiagnostics(editor.document);
            }
        })
    );

    // Run on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.fileName.endsWith('.jrxml')) updateDiagnostics(doc);
        })
    );

    // Clean up when a file is closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnosticCollection.delete(doc.uri);
        })
    );
}

module.exports = { register, updateDiagnostics };
