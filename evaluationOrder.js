// evaluationOrder.js
// Reports variables that reference another variable declared *later* in the
// same scope. JasperReports evaluates variables in declaration order, so a
// forward reference yields a null/undefined value (or fails) at runtime.
//
// Scope matters: a report variable and a dataset variable live in separate
// namespaces and are never compared. Self-references are valid (the accumulator
// pattern, e.g. `$V{count} == null ? 1 : $V{count} + 1`), and built-in
// variables (`PAGE_NUMBER`, `REPORT_COUNT`, ...) are ignored.
//
// Pure and vscode-free: takes document text, returns plain findings with
// character offsets.

const { scanXml } = require('./xmlspan');
const { contentOf, decodeXml } = require('./xmlRules');
const { BUILTIN_VARIABLE_NAMES } = require('./jasperBuiltins');

const CODE = 'jrxml.lint.variableOrder';

/** Child elements that hold a variable's expression. */
const EXPRESSION_CHILD_TAGS = new Set([
    'expression',
    'variableExpression',
    'initialValueExpression',
]);

const REFERENCE_RE = /\$V\{([^}]*)\}/g;

/**
 * @typedef {{ code:string, message:string, offset:number, length:number,
 *             variable:string, referenced:string }} OrderFinding
 */

/** Scope key for a variable node: 'report' or 'dataset:<startTag>'. */
function scopeKeyOf(node, root) {
    const dataset = node.ancestors().find(a => a.tag === 'dataset' || a.tag === 'subDataset');
    if (dataset) return 'dataset:' + dataset.startTag;
    if (node.parent === root) return 'report';
    return null; // nested in a subreport etc. — not a declaration here
}

/**
 * @param {string} text
 * @returns {OrderFinding[]}
 */
function checkVariableOrder(text) {
    const scan = scanXml(text);
    if (scan.error) return [];

    const root = scan.doc.root;
    const scopes = new Map(); // scopeKey -> variable nodes, document order

    for (const node of scan.doc.walk()) {
        if (node.tag !== 'variable') continue;
        const key = scopeKeyOf(node, root);
        if (!key) continue;
        if (!scopes.has(key)) scopes.set(key, []);
        scopes.get(key).push(node);
    }

    const findings = [];

    for (const variables of scopes.values()) {
        // First declaration wins for duplicate names.
        const indexByName = new Map();
        variables.forEach((node, index) => {
            const name = decodeXml(node.attrValue('name') || '').trim();
            if (name && !indexByName.has(name)) indexByName.set(name, index);
        });

        variables.forEach((node, index) => {
            const variableName = decodeXml(node.attrValue('name') || '').trim();
            if (!variableName) return;

            for (const child of node.children) {
                if (!EXPRESSION_CHILD_TAGS.has(child.tag)) continue;
                const content = contentOf(child, text);
                if (!content) continue;

                REFERENCE_RE.lastIndex = 0;
                let match;
                while ((match = REFERENCE_RE.exec(content.content)) !== null) {
                    const referenced = decodeXml(match[1]).trim();
                    if (!referenced || referenced === variableName) continue;
                    if (BUILTIN_VARIABLE_NAMES.has(referenced)) continue;

                    const target = indexByName.get(referenced);
                    if (target === undefined || target <= index) continue;

                    findings.push({
                        code: CODE,
                        message: `Variable '${variableName}' references '$V{${referenced}}', which is declared later; `
                            + 'JasperReports evaluates variables in declaration order.',
                        offset: content.start + match.index,
                        length: match[0].length,
                        variable: variableName,
                        referenced,
                    });
                }
            }
        });
    }

    return findings;
}

module.exports = { checkVariableOrder, CODE };
