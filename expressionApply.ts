// expressionApply.ts
// Applies a new expression to the expression tag a panel was opened from.
//
// Both the expression editor panel and the If/Else builder panel use this, so
// the target is always re-located from the live document text (never a stale
// range) and the edit is a single undoable operation.

import * as vscode from 'vscode';
import { findTagReplacement } from './expressionUtils';

/** The expression target a panel carries; only `tagName` is required. */
export interface ExpressionTarget {
    tagName: string;
    range?: vscode.Range;
    expression?: string;
    fullMatch?: string;
    innerStart?: number;
    innerEnd?: number;
}

/** The outcome of applying an expression, with the refreshed target. */
export interface ApplyExpressionResult {
    ok: boolean;
    expressionResult?: ExpressionTarget;
    reason?: string;
    severity?: 'warning' | 'error';
}

async function applyExpressionToEditor(
    editor: vscode.TextEditor | undefined,
    expressionResult: ExpressionTarget | null | undefined,
    newExpression: string
): Promise<ApplyExpressionResult> {
    if (!editor || !editor.document || editor.document.isClosed) {
        return { ok: false, severity: 'warning', reason: 'Source editor is no longer open.' };
    }
    if (!expressionResult || !expressionResult.tagName) {
        return {
            ok: false,
            severity: 'warning',
            reason: 'This panel is not attached to an expression tag.',
        };
    }

    const document = editor.document;
    const originalOffset = expressionResult.range && typeof document.offsetAt === 'function'
        ? document.offsetAt(expressionResult.range.start)
        : 0;

    const replacement = findTagReplacement(
        document.getText(),
        expressionResult.tagName,
        originalOffset,
        newExpression
    );

    if (!replacement) {
        return {
            ok: false,
            severity: 'error',
            reason: `Could not find <${expressionResult.tagName}> in the document. It may have been moved or renamed.`,
        };
    }

    const start = document.positionAt(replacement.startOffset);
    const end = document.positionAt(replacement.endOffset);

    const applied = await editor.edit(editBuilder => {
        editBuilder.replace(new vscode.Range(start, end), replacement.newTag);
    });

    if (!applied) {
        return { ok: false, severity: 'error', reason: 'Failed to apply expression.' };
    }

    const updated: ExpressionTarget = {
        ...expressionResult,
        expression: newExpression,
        fullMatch: replacement.newTag,
        range: new vscode.Range(
            start,
            document.positionAt(replacement.startOffset + replacement.newTag.length)
        ),
    };

    return { ok: true, expressionResult: updated };
}

export { applyExpressionToEditor };
