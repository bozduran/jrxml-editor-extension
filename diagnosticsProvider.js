// diagnosticsProvider.js
// Produces:
//   WARNING  — declared field/parameter/variable never used in any expression
//   ERROR    — $F/$P/$V reference to a name that isn't declared
//   ERROR    — unbalanced parentheses inside an expression tag
//   WARNING  — unclosed string literal inside an expression tag
//   WARNING  — structural lint rules (constant printWhenExpression,
//              removeLineWhenBlank, markup tags without markup)
//   WARNING  — Boolean comparisons that should use EQUALS()

const vscode = require('vscode');
const { parseDeclarations, clearCache } = require('./jrxmlParser');
const { EXPRESSION_TAGS, stripCdata } = require('./expressionUtils');
const { BUILTIN_VARIABLE_NAMES, BUILTIN_PARAMETER_NAMES } = require('./jasperBuiltins');
const { lintXml } = require('./xmlLint');
const { collectUsedNames, BUILTIN_PARAMETERS } = require('./xmlClear');
const { collectTextCheckIssues } = require('./textCheck');
const { checkVariableOrder } = require('./evaluationOrder');
const {
    CODE: BOOLEAN_EQUALS_CODE,
    MESSAGE: BOOLEAN_EQUALS_MESSAGE,
    checkBooleanEquals,
} = require('./booleanEqualsRule');

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

    // Sections are isolated: a failure in one must not blank the others.
    let parsed;
    try {
        parsed = parseDeclarations(document);
    } catch (err) {
        console.error('[JRXML] declaration parsing failed:', err);
        parsed = {
            fields: [], parameters: [], variables: [],
            dataset: { fields: [], parameters: [], variables: [] },
            allFields: [], allParameters: [], allVariables: [],
            groups: [], references: [], outline: [],
        };
    }

    const cfg = vscode.workspace.getConfiguration('jrxml');
    const checkUnused = cfg.get('showUnusedWarnings', true);
    const checkExpr   = cfg.get('validateExpressions', true);
    const checkBoolean = cfg.get('lint.booleanEquals', true);
    const lintEnabled = {
        constantPrintWhen:      cfg.get('lint.constantPrintWhen', true),
        removeLineWhenBlank:    cfg.get('lint.removeLineWhenBlank', true),
        markupTagWithoutMarkup: cfg.get('lint.markupTagWithoutMarkup', true),
    };

    // ── 1. Unused declarations ────────────────────────────────────────────────
    if (checkUnused) {
        // References are collected from expression elements (plus query,
        // subreport pass-throughs and other expression-bearing attributes),
        // matching the hook's ground-truth model. Only report-scope
        // declarations are checked: dataset members belong to their dataset,
        // and a parameter passed into a subreport is not declared here.
        let used;
        try {
            used = collectUsedNames(text);
        } catch (err) {
            console.error('[JRXML] reference collection failed:', err);
            used = null;
        }

        // null means the document could not be scanned: reporting "never
        // used" for every declaration would be a mass false positive.
        if (used) {
            for (const f of parsed.fields) {
                if (!used.has('FIELD:' + f.name)) {
                    diagnostics.push(makeDiagnostic(
                        document, f.nameOffset, f.name.length,
                        `Field '${f.name}' is declared but never used in any expression.`,
                        vscode.DiagnosticSeverity.Warning,
                        'jrxml.unusedField'
                    ));
                }
            }

            for (const p of parsed.parameters) {
                if (p.isSystem || BUILTIN_PARAMETERS.has(p.name)) continue;
                if (!used.has('PARAMETER:' + p.name)) {
                    diagnostics.push(makeDiagnostic(
                        document, p.nameOffset, p.name.length,
                        `Parameter '${p.name}' is declared but never used in any expression.`,
                        vscode.DiagnosticSeverity.Warning,
                        'jrxml.unusedParameter'
                    ));
                }
            }

            for (const v of parsed.variables) {
                if (!used.has('VARIABLE:' + v.name)) {
                    diagnostics.push(makeDiagnostic(
                        document, v.nameOffset, v.name.length,
                        `Variable '${v.name}' is declared but never used in any expression.`,
                        vscode.DiagnosticSeverity.Warning,
                        'jrxml.unusedVariable'
                    ));
                }
            }
        }
    }

    // ── 2. Undeclared references ─────────────────────────────────────────────
    if (checkExpr) {
        // A reference inside a dataset resolves against that dataset's
        // declarations, so the declared set spans report and dataset scope.
        const declaredFields = new Set(parsed.allFields.map(f => f.name));
        const declaredParams = new Set([...parsed.allParameters.map(p => p.name), ...BUILTIN_PARAMETER_NAMES]);
        const declaredVars   = new Set([...parsed.allVariables.map(v => v.name), ...BUILTIN_VARIABLE_NAMES]);

        for (const ref of parsed.references) {
            // <subreportParameter name="X"> / a <parameter> nested in a
            // subreport names the SUBREPORT's parameter, not one of this
            // report's. It is only a usage marker for the unused check; the
            // value expression beside it is what references this report's own
            // symbols and is validated separately. <returnValue toVariable="V">
            // is different: V IS a variable of this report.
            if (ref.fromSubreport && ref.sigil === 'P') continue;

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
    }

    // ── 3. Expression syntax and style ───────────────────────────────────────
    if (checkExpr || checkBoolean) {
        forEachExpression(text, (rawExpr, exprOffset) => {
            if (checkExpr) {
                // Check unbalanced parens
                const parenError = checkParens(rawExpr);
                if (parenError) {
                    diagnostics.push(makeDiagnostic(
                        document, exprOffset + parenError.index, 1,
                        parenError.message,
                        vscode.DiagnosticSeverity.Error,
                        'jrxml.unbalancedParen'
                    ));
                }

                // Check unclosed strings
                const strError = checkUnclosedString(rawExpr);
                if (strError) {
                    diagnostics.push(makeDiagnostic(
                        document, exprOffset + strError.index,
                        rawExpr.length - strError.index,
                        strError.message,
                        vscode.DiagnosticSeverity.Warning,
                        'jrxml.unclosedString'
                    ));
                }
            }

            if (checkBoolean) {
                for (const hit of checkBooleanEquals(rawExpr, parsed)) {
                    const diagnostic = makeDiagnostic(
                        document,
                        exprOffset + hit.start,
                        hit.end - hit.start,
                        BOOLEAN_EQUALS_MESSAGE,
                        vscode.DiagnosticSeverity.Warning,
                        BOOLEAN_EQUALS_CODE
                    );
                    diagnostic.data = { replacement: hit.replacement };
                    diagnostics.push(diagnostic);
                }
            }
        });
    }

    // ── 4. Structural lint rules (ported from the commit-time hook) ───────────
    // Malformed XML is skipped rather than guessed at.
    try {
        const lint = lintXml(text, lintEnabled);
        if (!lint.error) {
            for (const finding of lint.findings) {
                diagnostics.push(makeDiagnostic(
                    document, finding.offset, finding.length, finding.message,
                    vscode.DiagnosticSeverity.Warning, finding.code
                ));
            }
        }
    } catch (err) {
        console.error('[JRXML] lint rules failed:', err);
    }

    // ── 4b. Variable evaluation order (declared-later references) ─────────────
    if (cfg.get('lint.variableOrder', true)) {
        try {
            for (const finding of checkVariableOrder(text)) {
                diagnostics.push(makeDiagnostic(
                    document, finding.offset, finding.length, finding.message,
                    vscode.DiagnosticSeverity.Warning, finding.code
                ));
            }
        } catch (err) {
            console.error('[JRXML] variable order check failed:', err);
        }
    }

    // ── 5. Text check (double spaces, period spacing, unrenderable, newlines) ─
    if (cfg.get('textcheck.diagnostics', true)) {
        try {
            for (const issue of collectTextCheckIssues(text)) {
                diagnostics.push(makeDiagnostic(
                    document, issue.offset, issue.length, issue.message,
                    vscode.DiagnosticSeverity.Warning, issue.code
                ));
            }
        } catch (err) {
            console.error('[JRXML] text check failed:', err);
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

/**
 * Run `callback(rawExpression, startOffset)` for every non-empty expression
 * element. CDATA markers and surrounding whitespace are stripped, matching the
 * offsets the diagnostics use.
 */
function forEachExpression(text, callback) {
    const expressionRe = new RegExp(
        `(<(?<tag>${EXPRESSION_TAGS.join('|')})(?:\\s[^>]*)?>)([\\s\\S]*?)<\\/\\k<tag>>`,
        'g'
    );

    let match;
    while ((match = expressionRe.exec(text)) !== null) {
        const inner = match[3];
        const raw = stripCdata(inner);
        if (!raw) continue;
        callback(raw, match.index + match[1].length + inner.indexOf(raw));
    }
}

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
            clearCache(doc.uri);
        }),
        // Cancel a pending debounce when the extension deactivates
        { dispose: () => clearTimeout(debounceTimer) }
    );
}

module.exports = { register, updateDiagnostics };
