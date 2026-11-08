// diagnostics.js
// The vscode-free analysis pipeline: one text in, plain findings out.
//
// diagnosticsProvider.js maps these findings to VS Code diagnostics for the
// open document; tools/validate-workspace.js runs the same pipeline over every
// JRXML file for CI. Keeping the rules here means the editor and the CI gate
// can never disagree.
//
// Finding shape:
//   { offset, length, message, severity: 'error'|'warning', code, data? }

const { parseDeclarations, resolveDeclarationScope, findDuplicateNames } = require('./jrxmlParser');
const { analyse } = require('./analysisContext');
const { declaredNames, declarationInAnyScope } = require('./reportSymbols');
const { EXPRESSION_TAGS } = require('./expressionUtils');
const { regions, forEachRegion } = require('./expressionRegions');
const { isFragmentStart, skipFragment } = require('./jasperTokens');
const { lintXml } = require('./xmlLint');
const { collectUsedNames, BUILTIN_PARAMETERS } = require('./xmlClear');
const { collectTextCheckIssues } = require('./textCheck');
const { checkVariableOrder } = require('./evaluationOrder');
const { checkLayout } = require('./layoutRules');
const { checkQueries } = require('./queryChecks');
const { loadResourceBundle } = require('./resourceBundle');
const { analyseSubreports } = require('./subreportIndex');
const {
    CODE: BOOLEAN_EQUALS_CODE,
    MESSAGE: BOOLEAN_EQUALS_MESSAGE,
    checkBooleanEquals,
} = require('./booleanEqualsRule');

const DEFAULT_SETTINGS = {
    unused: true,
    expressions: true,
    booleanEquals: true,
    constantPrintWhen: true,
    removeLineWhenBlank: true,
    markupTagWithoutMarkup: true,
    variableOrder: true,
    duplicateNames: true,
    layout: true,
    queries: true,
    textcheck: true,
};

function normalizeSettings(settings) {
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

/**
 * Run every static check over one JRXML document.
 *
 * @param {object} input
 * @param {string} input.text
 * @param {string} [input.fileName]        absolute path, used for scope checks
 * @param {object} [input.settings]        see DEFAULT_SETTINGS
 * @param {string[]} [input.workspaceRoots] for bundle/subreport resolution
 * @returns {{offset:number,length:number,message:string,
 *            severity:'error'|'warning',code:string,data?:object}[]}
 */
function collectFindings({ text, fileName = '', settings, workspaceRoots = [] }) {
    const enabled = normalizeSettings(settings);
    const findings = [];
    const add = (offset, length, message, severity, code, data) => {
        const finding = { offset, length, message, severity, code };
        if (data !== undefined) finding.data = data;
        findings.push(finding);
    };

    // Sections are isolated: a failure in one must not blank the others.
    const context = analyse(text);
    const parsed = parseSafely(text, fileName, context.scan);

    // Run one rule, isolating its failures from the rest of the pipeline.
    const runRule = (check, severity) => {
        try {
            for (const issue of check()) {
                add(issue.offset, issue.length, issue.message, severity, issue.code);
            }
        } catch (_) {
            // A broken rule must not blank the other checks.
        }
    };

    // ── 0. Language model ────────────────────────────────────────────────────
    const language = parsed.language;
    if (language && language.declared && language.language !== 'java') {
        add(
            language.offset, language.length,
            `Report language '${language.language}' is not modeled: only Java expressions are fully supported. Typed completion is disabled and expression checks may be inaccurate.`,
            'warning', 'jrxml.unsupportedLanguage'
        );
    }

    // ── 0b. Resource-bundle references ───────────────────────────────────────
    if (parsed.resourceBundle) {
        const bundle    = parsed.resourceBundle;
        const resources = fileName
            ? loadResourceBundle(fileName, bundle.name, workspaceRoots)
            : null;

        if (!resources) {
            add(
                bundle.offset, bundle.length,
                `Resource bundle '${bundle.name}' was not found next to the report or in the workspace.`,
                'warning', 'jrxml.missingResourceBundle'
            );
        } else {
            for (const ref of parsed.resourceReferences || []) {
                if (resources.entries.has(ref.name)) continue;
                add(
                    ref.offset, ref.end - ref.offset,
                    `Resource key '${ref.name}' is not defined in resource bundle '${bundle.name}'.`,
                    'warning', 'jrxml.missingResourceKey'
                );
            }
        }
    }

    // ── 0c. Subreport targets and parameter maps ─────────────────────────────
    try {
        const links = analyseSubreports({ fileName, getText: () => text }, workspaceRoots, context.scan);
        for (const link of links) {
            if (link.dynamic || !link.path) continue;

            if (!link.target) {
                add(
                    link.offset, link.length,
                    `Subreport '${link.path}' was not found next to the report or in the workspace.`,
                    'warning', 'jrxml.missingSubreport'
                );
                continue;
            }

            if (!link.targetParameters) continue;
            for (const mapping of link.mappings) {
                if (link.targetParameters.has(mapping.name)) continue;
                add(
                    mapping.offset, mapping.length,
                    `Parameter '${mapping.name}' is not declared in subreport '${link.path}'.`,
                    'warning', 'jrxml.unknownSubreportParameter'
                );
            }
        }
    } catch (_) {
        // A broken target must not blank the rest of the document's checks.
    }

    // ── 1. Unused declarations ────────────────────────────────────────────────
    if (enabled.unused) {
        let used;
        try {
            used = collectUsedNames(text, context.scan);
        } catch (_) {
            used = null;
        }

        // null means the document could not be scanned: reporting "never used"
        // for every declaration would be a mass false positive.
        if (used) {
            for (const field of parsed.fields) {
                if (!used.has('FIELD:' + field.name)) {
                    add(
                        field.nameOffset, field.name.length,
                        `Field '${field.name}' is declared but never used in any expression.`,
                        'warning', 'jrxml.unusedField'
                    );
                }
            }

            for (const parameter of parsed.parameters) {
                if (parameter.isSystem || BUILTIN_PARAMETERS.has(parameter.name)) continue;
                if (!used.has('PARAMETER:' + parameter.name)) {
                    add(
                        parameter.nameOffset, parameter.name.length,
                        `Parameter '${parameter.name}' is declared but never used in any expression.`,
                        'warning', 'jrxml.unusedParameter'
                    );
                }
            }

            for (const variable of parsed.variables) {
                if (!used.has('VARIABLE:' + variable.name)) {
                    add(
                        variable.nameOffset, variable.name.length,
                        `Variable '${variable.name}' is declared but never used in any expression.`,
                        'warning', 'jrxml.unusedVariable'
                    );
                }
            }
        }
    }

    // ── 2. Undeclared references ─────────────────────────────────────────────
    if (enabled.expressions) {
        for (const ref of parsed.references) {
            if (ref.fromSubreport && ref.sigil === 'P') continue;

            const scope = resolveDeclarationScope(parsed, ref.offset);
            if (scope.kind === 'unknown') continue;

            if (declaredNames(scope, ref.sigil).has(ref.name)) continue;

            const kindName = ref.sigil === 'F' ? 'Field' : ref.sigil === 'P' ? 'Parameter' : 'Variable';
            const tokenLen = typeof ref.end === 'number'
                ? ref.end - ref.offset
                : 4 + ref.name.length;

            if (scope.kind === 'dataset' && declarationInAnyScope(parsed, { sigil: ref.sigil, name: ref.name })) {
                add(
                    ref.offset, tokenLen,
                    `${kindName} '${ref.name}' is declared at report scope and is not available inside dataset '${scope.datasetName}'. Pass it to the dataset as a parameter.`,
                    'error', 'jrxml.outOfScopeReference'
                );
                continue;
            }

            add(
                ref.offset, tokenLen,
                `${kindName} '${ref.name}' is not declared in this report.`,
                'error', 'jrxml.undeclaredReference'
            );
        }
    }

    // ── 2b. Duplicate declaration names ───────────────────────────────────────
    if (enabled.duplicateNames) {
        for (const duplicate of findDuplicateNames(parsed)) {
            add(
                duplicate.offset, duplicate.length,
                duplicateMessage(duplicate),
                'error', 'jrxml.duplicateName'
            );
        }
    }

    // ── 3. Expression syntax and style ───────────────────────────────────────
    if (enabled.expressions || enabled.booleanEquals) {
        forEachExpression(context.scan, text, (rawExpr, exprOffset) => {
            if (enabled.expressions) {
                const parenError = checkParens(rawExpr);
                if (parenError) {
                    add(
                        exprOffset + parenError.index, 1,
                        parenError.message,
                        'error', 'jrxml.unbalancedParen'
                    );
                }

                const stringError = checkUnclosedString(rawExpr);
                if (stringError) {
                    add(
                        exprOffset + stringError.index,
                        rawExpr.length - stringError.index,
                        stringError.message,
                        'warning', 'jrxml.unclosedString'
                    );
                }
            }

            if (enabled.booleanEquals) {
                for (const hit of checkBooleanEquals(rawExpr, parsed)) {
                    add(
                        exprOffset + hit.start,
                        hit.end - hit.start,
                        BOOLEAN_EQUALS_MESSAGE,
                        'warning', BOOLEAN_EQUALS_CODE,
                        { replacement: hit.replacement }
                    );
                }
            }
        });
    }

    // ── 4. Structural lint rules ─────────────────────────────────────────────
    try {
        const lint = lintXml(text, {
            constantPrintWhen:      enabled.constantPrintWhen,
            removeLineWhenBlank:    enabled.removeLineWhenBlank,
            markupTagWithoutMarkup: enabled.markupTagWithoutMarkup,
        }, context.scan);
        if (!lint.error) {
            for (const issue of lint.findings) {
                add(issue.offset, issue.length, issue.message, 'warning', issue.code);
            }
        }
    } catch (_) {
        // Malformed XML is already reported by the expression checks above.
    }

    // ── 4. Query literals and comments ───────────────────────────────────────
    if (enabled.queries) runRule(() => checkQueries(text, context.scan), 'warning');

    // ── 4a. Layout ───────────────────────────────────────────────────────────
    if (enabled.layout) runRule(() => checkLayout(text, context.scan), 'error');

    // ── 4b. Variable evaluation order ────────────────────────────────────────
    if (enabled.variableOrder) runRule(() => checkVariableOrder(text, context.scan), 'warning');

    // ── 5. Text check ────────────────────────────────────────────────────────
    if (enabled.textcheck) runRule(() => collectTextCheckIssues(text, context.scan), 'warning');

    return findings;
}

/** Parse with a synthetic document whose version follows the text content. */
function parseSafely(text, fileName, scan = null) {
    try {
        return parseDeclarations({
            uri: { toString: () => `jrxml-diagnostics://${fileName || 'untitled'}` },
            version: hashText(text),
            getText: () => text,
        }, scan);
    } catch (_) {
        return {
            fields: [], parameters: [], variables: [],
            dataset: { fields: [], parameters: [], variables: [] },
            allFields: [], allParameters: [], allVariables: [],
            groups: [], styles: [], references: [], resourceReferences: [],
            resourceBundle: null, datasets: [], scopeRanges: [], outline: [],
        };
    }
}

function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return hash;
}

function duplicateMessage(duplicate) {
    const labels = {
        field: 'Field', parameter: 'Parameter', variable: 'Variable',
        group: 'Group', dataset: 'Dataset', style: 'Style',
    };
    const label = labels[duplicate.kind] || 'Declaration';
    const where = duplicate.scope
        ? ` in dataset '${duplicate.scope}'`
        : ' in this report';
    return `${label} '${duplicate.name}' is declared more than once${where}.`;
}

// ── Expression syntax checkers ───────────────────────────────────────────────

/**
 * Check for unbalanced ( ) [ ] in the expression. Only " is a string delimiter
 * (single quotes are common inside Jasper strings), and $F{}/$P{}/$V{}/$R{}/$X{}
 * tokens are skipped.
 */
function checkParens(expr) {
    const stack = [];
    const pairs = { ')': '(', ']': '[' };
    let inStr = false;

    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];

        if (isFragmentStart(expr, i)) {
            i = skipFragment(expr, i) - 1;
            continue;
        }

        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inStr = false;
            continue;
        }

        if (ch === '"') { inStr = true; continue; }

        if ('(['.includes(ch)) {
            stack.push({ ch, index: i });
        } else if (')]'.includes(ch)) {
            if (stack.length === 0 || stack[stack.length - 1].ch !== pairs[ch]) {
                return { index: i, message: `Unmatched closing '${ch}' in expression.` };
            }
            stack.pop();
        }
    }

    if (stack.length > 0) {
        const unclosed = stack[stack.length - 1];
        return { index: unclosed.index, message: `Unclosed '${unclosed.ch}' in expression.` };
    }
    return null;
}

/** Unclosed double-quoted string literals; single quotes are ignored. */
function checkUnclosedString(expr) {
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];

        if (isFragmentStart(expr, i)) {
            i = skipFragment(expr, i) - 1;
            continue;
        }

        if (ch === '"') {
            const start = i;
            i++;
            while (i < expr.length) {
                if (expr[i] === '\\') { i += 2; continue; }
                if (expr[i] === '"')    { break; }
                i++;
            }
            if (i >= expr.length) {
                return { index: start, message: 'Unclosed string literal (missing closing ").' };
            }
        }
    }
    return null;
}

/** Run `callback(rawExpression, startOffset)` for every non-empty expression. */
function forEachExpression(scan, text, callback) {
    const expressionRegions = regions(scan, text)
        .filter(region => EXPRESSION_TAGS.includes(region.tag));

    forEachRegion(expressionRegions, region => {
        if (!region.expression) return;
        callback(region.expression, region.contentStart);
    });
}

module.exports = { collectFindings };
