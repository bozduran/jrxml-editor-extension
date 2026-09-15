// xmlLint.js
// Structural lint rules ported from the myhooks pre-commit hook's `lint` step.
//
// Pure and vscode-free: takes document text, returns plain findings with
// character offsets. The diagnostics provider turns them into vscode.Diagnostic.
//
// Rule ids:
//   jrxml.lint.constantPrintWhen      — <printWhenExpression> is literally true/false
//   jrxml.lint.removeLineWhenBlank    — textField/subreport missing or wrong attribute
//   jrxml.lint.markupTagWithoutMarkup — markup tags used but markup not styled/html/rtf
//
// Findings are emitted in document order; for one element the rule order matches
// the hook (markup, then removeLineWhenBlank).

const { scanXml } = require('./xmlspan');
const { EXPRESSION_ELEMENTS, contentOf } = require('./xmlRules');
const { checkNullDereference } = require('./lintNullDeref');

const RULE = {
    constantPrintWhen:        'jrxml.lint.constantPrintWhen',
    removeLineWhenBlank:      'jrxml.lint.removeLineWhenBlank',
    markupTagWithoutMarkup:   'jrxml.lint.markupTagWithoutMarkup',
    uncheckedNullDereference: 'jrxml.lint.uncheckedNullDereference',
};

// HTML / styled-text tags recognised by the markup rule.
const MARKUP_TAGS = [
    'a', 'b', 'blockquote', 'body', 'br', 'center', 'code', 'div', 'em', 'font',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'html', 'i', 'img', 'li', 'ol',
    'p', 'pre', 's', 'span', 'strike', 'strong', 'style', 'sub', 'sup',
    'table', 'td', 'th', 'tr', 'u', 'ul',
];

const MARKUP_TAG_RE = new RegExp(
    `<\\/?(?:${MARKUP_TAGS.join('|')})(?=[\\s/>])(?:\\s[^<>]*)?\\/?>`,
    'i'
);

/**
 * @typedef {{ rule:string, code:string, message:string, offset:number, length:number }} LintFinding
 */

/**
 * Run the lint rules over a document.
 *
 * @param {string} text
 * @param {{ constantPrintWhen?:boolean, removeLineWhenBlank?:boolean, markupTagWithoutMarkup?:boolean }} [enabled]
 * @returns {{ findings: LintFinding[], error: string|null }}
 */
function lintXml(text, enabled = {}) {
    const scan = scanXml(text);
    if (scan.error) return { findings: [], error: scan.error };

    const findings = [];

    for (const node of scan.doc.walk()) {
        if (node.tag === 'printWhenExpression' && enabled.constantPrintWhen !== false) {
            const content = node.textContent().trim();
            if (content === 'true' || content === 'false') {
                findings.push(makeFinding(
                    RULE.constantPrintWhen,
                    `printWhenExpression is a constant '${content}'`,
                    node
                ));
            }
        }

        if (EXPRESSION_ELEMENTS.has(node.tag) && enabled.uncheckedNullDereference !== false) {
            const content = contentOf(node, text);
            if (content && content.content.trim() !== '') {
                for (const warning of checkNullDereference(content.content)) {
                    findings.push({
                        rule:    'uncheckedNullDereference',
                        code:    RULE.uncheckedNullDereference,
                        message: warning.message,
                        offset:  content.start + warning.offset,
                        length:  warning.length,
                    });
                }
            }
        }

        if (node.tag !== 'element') continue;

        const kind = node.attrValue('kind');

        // Rule order per element matches the hook: markup first, then removeLine.
        if (kind === 'textField' && enabled.markupTagWithoutMarkup !== false) {
            const markup = (node.attrValue('markup') || '').trim().toLowerCase();
            if (markup !== 'styled' && markup !== 'html' && markup !== 'rtf') {
                const expression = node.children.find(
                    c => c.tag === 'expression' || c.tag === 'textFieldExpression'
                );
                if (expression) {
                    const tag = firstMarkupTag(expression.textContent());
                    if (tag) {
                        findings.push(makeFinding(
                            RULE.markupTagWithoutMarkup,
                            `text contains markup tag <${tag}> but markup is not "styled", "html" or "rtf"`,
                            node
                        ));
                    }
                }
            }
        }

        if ((kind === 'textField' || kind === 'subreport') && enabled.removeLineWhenBlank !== false) {
            const attr = node.attr('removeLineWhenBlank');
            if (!attr) {
                findings.push(makeFinding(
                    RULE.removeLineWhenBlank,
                    `${kind} is missing removeLineWhenBlank="true"`,
                    node
                ));
            } else if (attr.value.trim() !== 'true') {
                findings.push(makeFinding(
                    RULE.removeLineWhenBlank,
                    `removeLineWhenBlank is "${attr.value}" on ${kind}; expected "true"`,
                    node
                ));
            }
        }
    }

    return { findings, error: null };
}

function makeFinding(code, message, node) {
    return {
        rule:   code.slice('jrxml.lint.'.length),
        code,
        message,
        offset: node.startTag,
        length: node.startTagEnd - node.startTag,
    };
}

/** First recognised markup tag inside the string / text-block literals of `java`. */
function firstMarkupTag(java) {
    for (const literal of findStringLiterals(java)) {
        const match = literal.raw.match(MARKUP_TAG_RE);
        if (match) {
            const name = match[0].match(/^<\/?([A-Za-z][A-Za-z0-9]*)/);
            if (name) return name[1];
        }
    }
    return null;
}

/**
 * Locate string and text-block literals in a Java expression. Escape-aware so a
 * quote inside a char literal cannot open a string. Char literals themselves are
 * never returned — the markup rule only inspects string/text-block content.
 *
 * @param {string} java
 * @returns {{ start:number, end:number, raw:string, kind:'string'|'textblock' }[]}
 */
function findStringLiterals(java) {
    const out = [];
    const n = java.length;
    let i = 0;

    while (i < n) {
        const c = java[i];

        // Line comment
        if (c === '/' && java[i + 1] === '/') {
            i += 2;
            while (i < n && java[i] !== '\n') i++;
            continue;
        }
        // Block comment
        if (c === '/' && java[i + 1] === '*') {
            i += 2;
            while (i < n && !(java[i] === '*' && java[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        // Text block
        if (c === '"' && java[i + 1] === '"' && java[i + 2] === '"') {
            const start = i;
            i += 3;
            while (i < n && !(java[i] === '"' && java[i + 1] === '"' && java[i + 2] === '"')) {
                if (java[i] === '\\') i += 2; else i++;
            }
            i = Math.min(n, i + 3);
            out.push({ start, end: i, raw: java.slice(start, i), kind: 'textblock' });
            continue;
        }
        // String literal
        if (c === '"') {
            const start = i;
            i++;
            while (i < n) {
                if (java[i] === '\\') { i += 2; continue; }
                if (java[i] === '"') { i++; break; }
                i++;
            }
            out.push({ start, end: i, raw: java.slice(start, i), kind: 'string' });
            continue;
        }
        // Char literal — skipped (never scanned for markup), but must be consumed
        // so a quote inside it cannot start a string.
        if (c === "'") {
            i++;
            while (i < n) {
                if (java[i] === '\\') { i += 2; continue; }
                if (java[i] === "'") { i++; break; }
                i++;
            }
            continue;
        }

        i++;
    }

    return out;
}

module.exports = { lintXml, findStringLiterals, firstMarkupTag, MARKUP_TAGS, RULE };
