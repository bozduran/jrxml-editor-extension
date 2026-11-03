// expressionActions.js
// Shared "open the expression at this position" helpers, used by the Issues
// view and by code actions, plus the internal commands those actions invoke.

const vscode = require('vscode');
const { findExpressionAtCursor } = require('./expressionUtils');
const { formatExpression } = require('./expressionFormatter');
const { applyExpressionToEditor } = require('./expressionApply');
const ExpressionEditorPanel = require('./expressionEditorPanel');
const { IfElsePanel } = require('./ifElsePanel');

function isJrxmlDocument(document) {
    return !!document && document.fileName.endsWith('.jrxml');
}

function positionFrom(document, line, character) {
    if (line && typeof line === 'object' && typeof line.line === 'number') return line;
    const safeLine = Math.max(0, Math.min(document.lineCount - 1, Number(line) || 0));
    const lineText = document.lineAt(safeLine).text;
    const safeCharacter = Math.max(0, Math.min(lineText.length, Number(character) || 0));
    return new vscode.Position(safeLine, safeCharacter);
}

function openInExpressionEditor(extensionUri, editor, position) {
    const target = findExpressionAtCursor(editor.document, position || editor.selection.active);
    if (!target) {
        vscode.window.showInformationMessage('Place the cursor inside a JRXML expression tag first.');
        return false;
    }
    ExpressionEditorPanel.createOrShow(extensionUri, target, editor);
    return true;
}

function openInIfElseBuilder(extensionUri, editor, position) {
    const target = findExpressionAtCursor(editor.document, position || editor.selection.active);
    if (!target) {
        vscode.window.showInformationMessage('Place the cursor inside a JRXML expression tag first.');
        return false;
    }
    IfElsePanel.createOrShow(extensionUri, {
        sourceEditor: editor,
        expressionResult: target,
        initialExpression: target.expression,
    });
    return true;
}

async function openAt(extensionUri, uri, line, character, kind) {
    const document = await vscode.workspace.openTextDocument(uri);
    if (!isJrxmlDocument(document)) {
        vscode.window.showWarningMessage('This command works on .jrxml files only.');
        return false;
    }

    const editor = await vscode.window.showTextDocument(document);
    const position = positionFrom(document, line, character);
    editor.selection = new vscode.Selection(position, position);

    return kind === 'builder'
        ? openInIfElseBuilder(extensionUri, editor, position)
        : openInExpressionEditor(extensionUri, editor, position);
}

function openExpressionEditorAt(extensionUri, uri, line = 0, character = 0) {
    return openAt(extensionUri, uri, line, character, 'editor');
}

function openIfElseBuilderAt(extensionUri, uri, line = 0, character = 0) {
    return openAt(extensionUri, uri, line, character, 'builder');
}

async function formatExpressionAtCursor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isJrxmlDocument(editor.document)) {
        vscode.window.showWarningMessage('Open a .jrxml file first.');
        return;
    }

    const target = findExpressionAtCursor(editor.document, editor.selection.active);
    if (!target) {
        vscode.window.showInformationMessage('Place the cursor inside a JRXML expression tag first.');
        return;
    }
    if (!target.expression.trim()) {
        vscode.window.showInformationMessage('The expression is empty.');
        return;
    }

    let formatted;
    try {
        const indentSize = vscode.workspace.getConfiguration('jrxml').get('indentSize', 4);
        formatted = formatExpression(target.expression, indentSize);
    } catch (err) {
        vscode.window.showErrorMessage(`Could not format the expression: ${err.message || err}`);
        return;
    }

    if (formatted === target.expression) {
        vscode.window.setStatusBarMessage('Expression already formatted.', 2500);
        return;
    }

    const applied = await applyExpressionToEditor(editor, target, formatted);
    if (!applied.ok) {
        if (applied.severity === 'warning') vscode.window.showWarningMessage(applied.reason);
        else vscode.window.showErrorMessage(applied.reason);
        return;
    }

    vscode.window.setStatusBarMessage('Expression formatted.', 2500);
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.formatExpressionAtCursor', formatExpressionAtCursor),
        vscode.commands.registerCommand(
            'jrxml.editExpressionAt',
            (uri, line, character) => openExpressionEditorAt(context.extensionUri, uri, line, character)
        ),
        vscode.commands.registerCommand(
            'jrxml.openIfElseBuilderAt',
            (uri, line, character) => openIfElseBuilderAt(context.extensionUri, uri, line, character)
        )
    );
}

module.exports = {
    register,
    openExpressionEditorAt,
    openIfElseBuilderAt,
    openInExpressionEditor,
    openInIfElseBuilder,
    formatExpressionAtCursor,
};
