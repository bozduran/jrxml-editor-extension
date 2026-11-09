// textCheck.ts
// Surfaces the text-check rules as diagnostics with a quick fix, so the
// problems the formatter would silently fix are visible in the editor too:
//
//   - double spaces inside <text> CDATA and inside string/text-block literals
//   - a missing space after '.' before a capital letter
//   - unrenderable characters
//   - newlines that do not match the element's markup token
//
// Pure and vscode-free. One issue per changed text node, mirroring the hook's
// textcheck fix granularity; the diagnostic is anchored at the first change and
// its fix rewrites that node.

import { scanXml } from './xmlspan';
import type { XmlScanResult } from './xmlspan';
import { EXPRESSION_ELEMENTS, cdataOf, markupOf, isTextContext } from './xmlRules';
import { transformText, transformExpression } from './textRules';
import type { TextChange } from './textRules';
import type { Edit } from './edits';

const CODE = 'jrxml.textcheck';

/** One text-check issue with its anchoring offset and rewrite. */
export interface TextCheckIssue {
    code: string;
    message: string;
    offset: number;
    length: number;
    edit: Edit;
}

/** The quick fix for one issue. */
export interface TextCheckFix {
    title: string;
    edit: Edit;
}

function collectTextCheckIssues(
    text: string,
    providedScan: XmlScanResult | null = null
): TextCheckIssue[] {
    const scan = providedScan || scanXml(text);
    if (scan.error || !scan.doc) return [];

    const issues: TextCheckIssue[] = [];

    for (const node of scan.doc.walk()) {
        // The hook only inspects CDATA bodies; plain element text is skipped.
        const cdata = cdataOf(node, text);
        if (!cdata) continue;

        const changes: TextChange[] = [];
        const findings: string[] = [];
        let transformed: string;

        if (node.tag === 'text') {
            transformed = transformText(cdata.content, markupOf(node), findings, changes);
        } else if (EXPRESSION_ELEMENTS.has(node.tag)) {
            transformed = transformExpression(
                cdata.content, isTextContext(node), markupOf(node), findings, changes
            );
        } else {
            continue;
        }

        if (transformed === cdata.content || changes.length === 0) continue;

        const first = changes.reduce((a, b) => (b.offset < a.offset ? b : a), changes[0]);

        issues.push({
            code:    CODE,
            message: `Text check: ${findings.length ? findings.join(', ') : 'fix text'}`,
            offset:  cdata.start + first.offset,
            length:  Math.max(1, first.length),
            edit:    { start: cdata.start, end: cdata.end, replacement: transformed },
        });
    }

    return issues;
}

/** The quick fix for the issue anchored at `offset`, or null. */
function fixForTextCheck(text: string, offset: number): TextCheckFix | null {
    const issue = collectTextCheckIssues(text).find(candidate => candidate.offset === offset);
    if (!issue) return null;

    return {
        title: `Fix text: ${issue.message.replace(/^Text check: /, '')}`,
        edit:  issue.edit,
    };
}

export { collectTextCheckIssues, fixForTextCheck, CODE };
