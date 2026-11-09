// codeActionsProvider.ts
// Provides lightbulb quick-fix actions for JRXML diagnostics:
//
//  jrxml.unusedField / unusedParameter / unusedVariable
//    → "Go to declaration"
//    → "Remove declaration"
//
//  jrxml.booleanEquals  (Boolean comparison style)
//    → "Replace with EQUALS(...) / NOT(EQUALS(...))"
//
//  jrxml.undeclaredReference  ($F/$P/$V used but not declared)
//    → "Add <field name='x' class='java.lang.Object'> declaration"
//    → "Add <parameter name='x' class='java.lang.Object'> declaration"
//    → "Add <variable name='x' ...> declaration"

import * as vscode from 'vscode';
import { fixForFinding } from './xmlLintFixes';
import { scanXml } from './xmlspan';
import { findInsertionPoint } from './declarationInsertion';
import { removalSpan } from './xmlClear';
import { decodeXml } from './xmlRules';
import { fixForTextCheck } from './textCheck';
import { findExpressionAtCursor } from './expressionUtils';

// ── Lint rule quick fixes ─────────────────────────────────────────────────────

const LINT_CODES = new Set([
    'jrxml.lint.constantPrintWhen',
    'jrxml.lint.removeLineWhenBlank',
    'jrxml.lint.markupTagWithoutMarkup',
]);

// ── Insertion point helpers ───────────────────────────────────────────────────

/**
 * Build a full declaration snippet for the given kind and name.
 */
function buildDeclarationSnippet(kind: string, name: string): string {
    switch (kind) {
        case 'field':
            return `\n\t<field name="${name}" class="java.lang.Object">\n\t\t<description><![CDATA[]]></description>\n\t</field>`;
        case 'parameter':
            return `\n\t<parameter name="${name}" class="java.lang.Object" isForPrompting="true"/>`;
        case 'variable':
            return `\n\t<variable name="${name}" class="java.lang.Object" resetType="Report" calculation="Nothing">\n\t\t<variableExpression><![CDATA[]]></variableExpression>\n\t</variable>`;
        default:
            return '';
    }
}

/** A string code; object-shaped diagnostic codes never match a rule here. */
function codeOf(diagnostic: vscode.Diagnostic): string {
    return typeof diagnostic.code === 'string' ? diagnostic.code : '';
}

/** VS Code carries quick-fix payloads on Diagnostic.data, which @types/vscode 1.85 omits. */
interface DiagnosticWithData extends vscode.Diagnostic {
    data?: unknown;
}

/** The quick-fix replacement a boolean-equals finding carries, if any. */
function replacementOf(diagnostic: vscode.Diagnostic): string | null {
    const data = (diagnostic as DiagnosticWithData).data;
    if (!data || typeof data !== 'object') return null;
    const replacement = (data as { replacement?: unknown }).replacement;
    return typeof replacement === 'string' ? replacement : null;
}

// ── Provider ──────────────────────────────────────────────────────────────────

const provider = vscode.languages.registerCodeActionsProvider(
    { language: 'jrxml' },
    {
        provideCodeActions(
            document: vscode.TextDocument,
            range: vscode.Range,
            context: vscode.CodeActionContext
        ): vscode.CodeAction[] {
            const actions: vscode.CodeAction[] = [];

            for (const diag of context.diagnostics) {
                if (diag.source !== 'JRXML') continue;
                const code = codeOf(diag);

                // Any diagnostic inside an expression can be inspected there.
                if (findExpressionAtCursor(document, diag.range.start)) {
                    const editExpression = new vscode.CodeAction(
                        'Edit expression in Expression Editor',
                        vscode.CodeActionKind.QuickFix
                    );
                    editExpression.diagnostics = [diag];
                    editExpression.command = {
                        command: 'jrxml.editExpressionAt',
                        title: 'Edit expression',
                        arguments: [document.uri, diag.range.start.line, diag.range.start.character],
                    };
                    actions.push(editExpression);

                    const openInBuilder = new vscode.CodeAction(
                        'Open expression in If / Else Builder',
                        vscode.CodeActionKind.QuickFix
                    );
                    openInBuilder.diagnostics = [diag];
                    openInBuilder.command = {
                        command: 'jrxml.openIfElseBuilderAt',
                        title: 'Open in If / Else Builder',
                        arguments: [document.uri, diag.range.start.line, diag.range.start.character],
                    };
                    actions.push(openInBuilder);
                }

                // ── Unused declarations ───────────────────────────────────────
                if (['jrxml.unusedField', 'jrxml.unusedParameter', 'jrxml.unusedVariable'].includes(code)) {
                    const kind = code === 'jrxml.unusedField'     ? 'field'
                               : code === 'jrxml.unusedParameter' ? 'parameter'
                               :                                    'variable';
                    const name = decodeXml(document.getText(diag.range));

                    // Action 1: Jump to the declaration
                    const jumpAction = new vscode.CodeAction(
                        `Go to <${kind}> declaration for '${name}'`,
                        vscode.CodeActionKind.QuickFix
                    );
                    jumpAction.diagnostics = [diag];
                    jumpAction.command = {
                        command: 'jrxml.goToDeclaration',
                        title:   'Go to declaration',
                        arguments: [document.uri, diag.range.start]
                    };
                    actions.push(jumpAction);

                    // Action 2: Remove the entire declaration tag
                    const removeAction = new vscode.CodeAction(
                        `Remove unused <${kind} name="${name}">`,
                        vscode.CodeActionKind.QuickFix
                    );
                    removeAction.diagnostics = [diag];
                    removeAction.isPreferred = false;

                    const text         = document.getText();
                    const declRemoval  = buildRemovalEdit(document, text, kind, name);
                    if (declRemoval) {
                        removeAction.edit = declRemoval;
                        actions.push(removeAction);
                    }
                }

                // ── Undeclared reference ──────────────────────────────────────
                if (code === 'jrxml.undeclaredReference') {
                    // Extract $F/$P/$V and name from the diagnostic range text
                    const tokenText = document.getText(diag.range); // e.g. $F{salary}
                    const tokenMatch = tokenText.match(/^\$(F|P|V)\{([\w.]+)\}$/);
                    if (!tokenMatch) continue;

                    const sigil    = tokenMatch[1];
                    const name     = tokenMatch[2];
                    const kindMap: Record<string, string> = { F: 'field', P: 'parameter', V: 'variable' };
                    const kind     = kindMap[sigil];
                    const tagName  = kind === 'field' ? 'field' : kind === 'parameter' ? 'parameter' : 'variable';

                    const addAction = new vscode.CodeAction(
                        `Add <${tagName} name="${name}"> declaration`,
                        vscode.CodeActionKind.QuickFix
                    );
                    addAction.diagnostics = [diag];
                    addAction.isPreferred = true;

                    const text      = document.getText();
                    const insertAt  = findInsertionPoint(text, tagName);
                    const snippet   = buildDeclarationSnippet(kind, name);

                    const edit = new vscode.WorkspaceEdit();
                    edit.insert(document.uri, document.positionAt(insertAt), snippet);
                    addAction.edit = edit;
                    actions.push(addAction);
                }

                // ── Boolean comparison style ──────────────────────────────────
                if (code === 'jrxml.booleanEquals') {
                    const replacement = replacementOf(diag);
                    if (replacement === null) continue;

                    const action = new vscode.CodeAction(
                        `Replace with ${replacement}`,
                        vscode.CodeActionKind.QuickFix
                    );
                    action.diagnostics = [diag];
                    action.isPreferred = true;

                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, diag.range, replacement);
                    action.edit = edit;
                    actions.push(action);
                }

                // ── Structural lint rules ─────────────────────────────────────
                if (LINT_CODES.has(code)) {
                    const fix = fixForFinding(document.getText(), {
                        code,
                        offset: document.offsetAt(diag.range.start),
                    });
                    if (!fix) continue;

                    const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
                    action.diagnostics = [diag];
                    // Removing a constant expression is a convenience; setting the
                    // attribute is the expected fix, so prefer it.
                    action.isPreferred = code !== 'jrxml.lint.constantPrintWhen';

                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(
                            document.positionAt(fix.edit.start),
                            document.positionAt(fix.edit.end)
                        ),
                        fix.edit.replacement
                    );
                    action.edit = edit;
                    actions.push(action);
                }

                // ── Text check ────────────────────────────────────────────────
                if (code === 'jrxml.textcheck') {
                    const fix = fixForTextCheck(document.getText(), document.offsetAt(diag.range.start));
                    if (!fix) continue;

                    const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
                    action.diagnostics = [diag];
                    action.isPreferred = true;

                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(
                            document.positionAt(fix.edit.start),
                            document.positionAt(fix.edit.end)
                        ),
                        fix.edit.replacement
                    );
                    action.edit = edit;
                    actions.push(action);
                }
            }

            return actions;
        }
    },
    {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    }
);

// ── Remove declaration edit builder ──────────────────────────────────────────

/**
 * Build a WorkspaceEdit that removes the full declaration tag for the given
 * kind and name. The span is line-aware, so an element alone on its line takes
 * its indentation and line break with it, while a shared line (a comment, say)
 * keeps its layout.
 */
function buildRemovalEdit(
    document: vscode.TextDocument,
    text: string,
    kind: string,
    name: string
): vscode.WorkspaceEdit | null {
    const scan = scanXml(text);
    if (scan.error || !scan.doc) return null;

    const node = scan.doc.root.children.find(
        child => child.tag === kind && decodeXml(child.attrValue('name') || '') === name
    );
    if (!node) return null;

    const span = removalSpan(text, node.startTag, node.end);
    const edit = new vscode.WorkspaceEdit();
    edit.delete(
        document.uri,
        new vscode.Range(document.positionAt(span.start), document.positionAt(span.end))
    );
    return edit;
}

export { provider };
