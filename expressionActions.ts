// expressionActions.ts
// Shared "open the expression at this position" helpers, used by the Issues
// view and by code actions, plus the internal commands those actions invoke.

import * as vscode from 'vscode';
import { findExpressionAtCursor } from './expressionUtils';
import { formatExpression } from './expressionFormatter';
import { applyExpressionToEditor } from './expressionApply';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- single-value CommonJS module, required as-is by the host suite
import ExpressionEditorPanel = require('./expressionEditorPanel');
import { IfElsePanel } from './ifElsePanel';

function isJrxmlDocument(document: vscode.TextDocument | null | undefined): document is vscode.TextDocument {
    return !!document && document.fileName.endsWith('.jrxml');
}

function positionFrom(
    document: vscode.TextDocument,
    line: number | vscode.Position | null | undefined,
    character?: number
): vscode.Position {
    if (line && typeof line === 'object' && typeof line.line === 'number') return line;
    const safeLine = Math.max(0, Math.min(document.lineCount - 1, Number(line) || 0));
    const lineText = document.lineAt(safeLine).text;
    const safeCharacter = Math.max(0, Math.min(lineText.length, Number(character) || 0));
    return new vscode.Position(safeLine, safeCharacter);
}

function openInExpressionEditor(
    extensionUri: vscode.Uri,
    editor: vscode.TextEditor,
    position?: vscode.Position
): boolean {
    const target = findExpressionAtCursor(editor.document, position || editor.selection.active);
    if (!target) {
        vscode.window.showInformationMessage('Place the cursor inside a JRXML expression tag first.');
        return false;
    }
    ExpressionEditorPanel.createOrShow(extensionUri, target, editor);
    return true;
}

function openInIfElseBuilder(
    extensionUri: vscode.Uri,
    editor: vscode.TextEditor,
    position?: vscode.Position
): boolean {
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

async function openAt(
    extensionUri: vscode.Uri,
    uri: vscode.Uri,
    line: number | vscode.Position | null | undefined,
    character: number | undefined,
    kind: 'editor' | 'builder'
): Promise<boolean> {
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

function openExpressionEditorAt(
    extensionUri: vscode.Uri,
    uri: vscode.Uri,
    line: number | vscode.Position | null = 0,
    character = 0
): Promise<boolean> {
    return openAt(extensionUri, uri, line, character, 'editor');
}

function openIfElseBuilderAt(
    extensionUri: vscode.Uri,
    uri: vscode.Uri,
    line: number | vscode.Position | null = 0,
    character = 0
): Promise<boolean> {
    return openAt(extensionUri, uri, line, character, 'builder');
}

async function formatExpressionAtCursor(): Promise<void> {
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

    let formatted: string;
    try {
        const indentSize = vscode.workspace.getConfiguration('jrxml').get('indentSize', 4);
        formatted = formatExpression(target.expression, indentSize);
    } catch (err) {
        vscode.window.showErrorMessage(`Could not format the expression: ${errorMessage(err)}`);
        return;
    }

    if (formatted === target.expression) {
        vscode.window.setStatusBarMessage('Expression already formatted.', 2500);
        return;
    }

    const applied = await applyExpressionToEditor(editor, target, formatted);
    if (!applied.ok) {
        if (applied.severity === 'warning') vscode.window.showWarningMessage(applied.reason ?? '');
        else vscode.window.showErrorMessage(applied.reason ?? '');
        return;
    }

    vscode.window.setStatusBarMessage('Expression formatted.', 2500);
}

/** The message a thrown value carries, or its string form. */
function errorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
        const message = (err as { message?: unknown }).message;
        if (message) return String(message);
    }
    return String(err);
}

function register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.formatExpressionAtCursor', formatExpressionAtCursor),
        vscode.commands.registerCommand(
            'jrxml.editExpressionAt',
            (uri: vscode.Uri, line?: number, character?: number) => openExpressionEditorAt(context.extensionUri, uri, line, character)
        ),
        vscode.commands.registerCommand(
            'jrxml.openIfElseBuilderAt',
            (uri: vscode.Uri, line?: number, character?: number) => openIfElseBuilderAt(context.extensionUri, uri, line, character)
        )
    );
}

export {
    register,
    openExpressionEditorAt,
    openIfElseBuilderAt,
    openInExpressionEditor,
    openInIfElseBuilder,
    formatExpressionAtCursor,
};
