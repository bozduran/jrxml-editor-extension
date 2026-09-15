// textCheck.js
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

const { scanXml } = require('./xmlspan');
const { EXPRESSION_ELEMENTS, cdataOf, markupOf, isTextContext } = require('./xmlRules');
const { transformText, transformExpression } = require('./textRules');

const CODE = 'jrxml.textcheck';

/**
 * @param {string} text
 * @returns {{ code:string, message:string, offset:number, length:number,
 *            edit:{start:number,end:number,replacement:string} }[]}
 */
function collectTextCheckIssues(text) {
    const scan = scanXml(text);
    if (scan.error) return [];

    const issues = [];

    for (const node of scan.doc.walk()) {
        // The hook only inspects CDATA bodies; plain element text is skipped.
        const cdata = cdataOf(node, text);
        if (!cdata) continue;

        const changes  = [];
        const findings = [];
        let transformed;

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
function fixForTextCheck(text, offset) {
    const issue = collectTextCheckIssues(text).find(candidate => candidate.offset === offset);
    if (!issue) return null;

    return {
        title: `Fix text: ${issue.message.replace(/^Text check: /, '')}`,
        edit:  issue.edit,
    };
}

module.exports = { collectTextCheckIssues, fixForTextCheck, CODE };
