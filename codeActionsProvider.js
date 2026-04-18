// codeActionsProvider.js
// Provides lightbulb quick-fix actions for JRXML diagnostics:
//
//  jrxml.unusedField / unusedParameter / unusedVariable
//    → "Go to declaration"
//    → "Remove declaration"
//
//  jrxml.undeclaredReference  ($F/$P/$V used but not declared)
//    → "Add <field name='x' class='java.lang.Object'> declaration"
//    → "Add <parameter name='x' class='java.lang.Object'> declaration"
//    → "Add <variable name='x' ...> declaration"

const vscode = require('vscode');
const { parseDeclarations } = require('./jrxmlParser');

// ── Insertion point helpers ───────────────────────────────────────────────────

/**
 * Find the offset just after the last <field .../> or </field> block,
 * so we can insert a new field declaration after all existing ones.
 * Falls back to just before </jasperReport> if none exist.
 */
function findInsertionPoint(text, tagName) {
    // Find the last closing of this tag type
    const closingRe = new RegExp(`<\\/${tagName}>|<${tagName}[^>]*\\/>`, 'g');
    let last = -1, m;
    while ((m = closingRe.exec(text)) !== null) last = m.index + m[0].length;

    if (last !== -1) return last;

    // No existing tags — insert before the first <group>, <background>, <title>,
    // <pageHeader>, <detail>, <columnHeader>, <pageFooter>, <summary>, or </jasperReport>
    const anchors = [
        /<group[\s>]/, /<background[\s>]/, /<title[\s>]/, /<pageHeader[\s>]/,
        /<columnHeader[\s>]/, /<detail[\s>]/, /<pageFooter[\s>]/, /<summary[\s>]/,
        /<\/jasperReport>/
    ];
    for (const a of anchors) {
        const am = a.exec(text);
        if (am) return am.index;
    }
    return text.length;
}

/**
 * Build a full declaration snippet for the given kind and name.
 */
function buildDeclarationSnippet(kind, name) {
    switch (kind) {
        case 'field':
            return `\n\t<field name="${name}" class="java.lang.Object">\n\t\t<fieldDescription><![CDATA[]]></fieldDescription>\n\t</field>`;
        case 'parameter':
            return `\n\t<parameter name="${name}" class="java.lang.Object" isForPrompting="true"/>`;
        case 'variable':
            return `\n\t<variable name="${name}" class="java.lang.Object" resetType="Report" calculation="Nothing">\n\t\t<variableExpression><![CDATA[]]></variableExpression>\n\t</variable>`;
        default:
            return '';
    }
}

// ── Provider ──────────────────────────────────────────────────────────────────

const provider = vscode.languages.registerCodeActionsProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideCodeActions(document, range, context) {
            const actions = [];

            for (const diag of context.diagnostics) {
                if (diag.source !== 'JRXML') continue;

                // ── Unused declarations ───────────────────────────────────────
                if (['jrxml.unusedField', 'jrxml.unusedParameter', 'jrxml.unusedVariable'].includes(diag.code)) {
                    const kind = diag.code === 'jrxml.unusedField'     ? 'field'
                               : diag.code === 'jrxml.unusedParameter' ? 'parameter'
                               :                                          'variable';
                    const name = document.getText(diag.range);

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
                if (diag.code === 'jrxml.undeclaredReference') {
                    // Extract $F/$P/$V and name from the diagnostic range text
                    const tokenText = document.getText(diag.range); // e.g. $F{salary}
                    const tokenMatch = tokenText.match(/^\$(F|P|V)\{([\w.]+)\}$/);
                    if (!tokenMatch) continue;

                    const sigil    = tokenMatch[1];
                    const name     = tokenMatch[2];
                    const kindMap  = { F: 'field', P: 'parameter', V: 'variable' };
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
 * kind and name, including any surrounding blank lines.
 */
function buildRemovalEdit(document, text, kind, name) {
    // Build a regex that matches the full tag (self-closing or with children)
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagRe = new RegExp(
        `\\n?[ \\t]*<${kind}\\s[^>]*name\\s*=\\s*["']${escapedName}["'][^>]*(?:\\/>|>[\\s\\S]*?<\\/${kind}>)[ \\t]*`,
        'g'
    );

    const m = tagRe.exec(text);
    if (!m) return null;

    const edit = new vscode.WorkspaceEdit();
    edit.delete(
        document.uri,
        new vscode.Range(
            document.positionAt(m.index),
            document.positionAt(m.index + m[0].length)
        )
    );
    return edit;
}

module.exports = { provider };
