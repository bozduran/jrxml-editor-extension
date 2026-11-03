// expressionApply.js
// Applies a new expression to the expression tag a panel was opened from.
//
// Both the expression editor panel and the If/Else builder panel use this, so
// the target is always re-located from the live document text (never a stale
// range) and the edit is a single undoable operation.

const vscode = require('vscode');
const { findTagReplacement } = require('./expressionUtils');

/**
 * @param {import('vscode').TextEditor|undefined} editor
 * @param {{tagName:string,range:import('vscode').Range}} expressionResult
 * @param {string} newExpression
 * @returns {Promise<{ok:boolean, expressionResult?:object, reason?:string, severity?:'warning'|'error'}>}
 */
async function applyExpressionToEditor(editor, expressionResult, newExpression) {
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

    const updated = {
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

module.exports = { applyExpressionToEditor };
