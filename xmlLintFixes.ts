// xmlLintFixes.ts
// Pure quick-fix computation for the structural lint rules ported from the
// myhooks hook. vscode-free: returns { title, edit } where edit is
// { start, end, replacement } in character offsets.
//
// Only the constant-printWhen removal and the two attribute fixes are offered;
// the hook itself has no fixes for these rules, so these are extension-only
// conveniences (marked as such in the code-action title where relevant).
//
// NOTE: two attribute fixes on the same tag insert at the same offset. Code
// actions apply one fix at a time, so that is fine today; a future "apply all"
// command must merge same-offset insertions before calling applyEdits().

import { scanXml, nodeStartingAt, attrInsertOffset } from './xmlspan';
import type { XmlNode } from './xmlspan';
import { lineAwareSpan } from './edits';
import type { Edit } from './edits';

/** The part of a diagnostic finding a quick fix needs. */
export interface LintFinding {
    code: string;
    offset: number;
}

/** A quick-fix title and the edit that applies it. */
export interface LintFix {
    title: string;
    edit: Edit;
}

export function fixForFinding(text: string, finding: LintFinding): LintFix | null {
    const scan = scanXml(text);
    if (scan.error || !scan.doc) return null;

    const node = nodeStartingAt(scan.doc.root, finding.offset);
    if (!node) return null;

    switch (finding.code) {
        case 'jrxml.lint.constantPrintWhen': {
            const span = lineAwareSpan(text, node.startTag, node.end);
            return {
                title: 'Remove constant <printWhenExpression>',
                edit: { start: span.start, end: span.end, replacement: '' },
            };
        }
        case 'jrxml.lint.removeLineWhenBlank':
            return {
                title: 'Set removeLineWhenBlank="true"',
                edit: setAttrEdit(node, 'removeLineWhenBlank', 'true'),
            };
        case 'jrxml.lint.markupTagWithoutMarkup': {
            const hasMarkup = !!node.attr('markup');
            return {
                title: `${hasMarkup ? 'Set' : 'Add'} markup="styled"`,
                edit: setAttrEdit(node, 'markup', 'styled'),
            };
        }
        default:
            return null;
    }
}

/** Edit that sets an existing attribute value or inserts the attribute. */
function setAttrEdit(node: XmlNode, name: string, value: string): Edit {
    const attr = node.attr(name);
    if (attr) {
        return { start: attr.valueStart, end: attr.valueEnd, replacement: value };
    }
    const at = attrInsertOffset(node);
    return { start: at, end: at, replacement: ` ${name}="${value}"` };
}
