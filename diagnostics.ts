// diagnostics.ts
// The vscode-free analysis pipeline: one text in, plain findings out.
//
// diagnosticsProvider.ts maps these findings to VS Code diagnostics for the
// open document; tools/validate-workspace.js runs the same pipeline over every
// JRXML file for CI. Keeping the rules here means the editor and the CI gate
// can never disagree.

import {
    parseReport, resolveDeclarationScope, findDuplicateNames,
} from './jrxmlParser';
import type { DuplicateName, ParseResult } from './jrxmlParser';
import { textSource } from './reportSource';
import { analyse } from './analysisContext';
import { declaredNames, declarationInAnyScope } from './reportSymbols';
import { EXPRESSION_TAGS } from './expressionUtils';
import type { ExpressionSigil } from './expressionUtils';
import { regions, forEachRegion } from './expressionRegions';
import { isFragmentStart, skipFragment } from './jasperTokens';
import { lintXml } from './xmlLint';
import { collectUsedNames, BUILTIN_PARAMETERS } from './xmlClear';
import { collectTextCheckIssues } from './textCheck';
import { checkVariableOrder } from './evaluationOrder';
import { checkLayout } from './layoutRules';
import { checkQueries } from './queryChecks';
import { loadResourceBundle } from './resourceBundle';
import { analyseSubreports } from './subreportIndex';
import {
    CODE as BOOLEAN_EQUALS_CODE,
    MESSAGE as BOOLEAN_EQUALS_MESSAGE,
    checkBooleanEquals,
} from './booleanEqualsRule';
import type { XmlScanResult } from './xmlspan';

export type FindingSeverity = 'error' | 'warning';

/** One plain rule hit, anchored at a document offset. */
export interface Finding {
    offset: number;
    length: number;
    message: string;
    severity: FindingSeverity;
    code: string;
    data?: Record<string, unknown>;
}

/** The flat rule switches the editor and CI pass to collectFindings. */
export interface FindingSettings {
    unused: boolean;
    expressions: boolean;
    booleanEquals: boolean;
    constantPrintWhen: boolean;
    removeLineWhenBlank: boolean;
    markupTagWithoutMarkup: boolean;
    variableOrder: boolean;
    duplicateNames: boolean;
    layout: boolean;
    queries: boolean;
    textcheck: boolean;
}

/** One document to analyse, with the settings and roots the checks read. */
export interface CollectFindingsInput {
    text: string;
    /** Absolute path, used for scope checks. */
    fileName?: string;
    settings?: Partial<FindingSettings>;
    /** For bundle/subreport resolution. */
    workspaceRoots?: readonly string[];
}

const DEFAULT_SETTINGS: FindingSettings = {
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

function normalizeSettings(settings?: Partial<FindingSettings>): FindingSettings {
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

/** An empty parse result, used when a malformed document cannot be parsed. */
function emptyParseResult(): ParseResult {
    return {
        fields: [], parameters: [], variables: [],
        dataset: { fields: [], parameters: [], variables: [] },
        language: { language: 'java', declared: false, offset: -1, length: 0 },
        allFields: [], allParameters: [], allVariables: [],
        groups: [], styles: [], references: [], resourceReferences: [],
        resourceBundle: null, datasets: [], scopeRanges: [], outline: [],
    };
}

/**
 * Run every static check over one JRXML document.
 */
function collectFindings({ text, fileName = '', settings, workspaceRoots = [] }: CollectFindingsInput): Finding[] {
    const enabled = normalizeSettings(settings);
    const findings: Finding[] = [];
    const add = (
        offset: number,
        length: number,
        message: string,
        severity: FindingSeverity,
        code: string,
        data?: Record<string, unknown>
    ): void => {
        const finding: Finding = { offset, length, message, severity, code };
        if (data !== undefined) finding.data = data;
        findings.push(finding);
    };

    // Sections are isolated: a failure in one must not blank the others.
    const context = analyse(text);
    const parsed = parseSafely(text, fileName, context.scan);

    // Run one rule, isolating its failures from the rest of the pipeline.
    const runRule = (
        check: () => readonly { offset: number; length: number; message: string; code: string }[],
        severity: FindingSeverity
    ): void => {
        try {
            for (const issue of check()) {
                add(issue.offset, issue.length, issue.message, severity, issue.code);
            }
        } catch {
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
    } catch {
        // A broken target must not blank the rest of the document's checks.
    }

    // ── 1. Unused declarations ────────────────────────────────────────────────
    if (enabled.unused) {
        let used: Set<string> | null;
        try {
            used = collectUsedNames(text, context.scan);
        } catch {
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

            // Parser references are $F/$P/$V; $R keys are collected separately.
            const sigil = ref.sigil as ExpressionSigil;
            if (declaredNames(scope, sigil).has(ref.name)) continue;

            const kindName = ref.sigil === 'F' ? 'Field' : ref.sigil === 'P' ? 'Parameter' : 'Variable';
            const tokenLen = typeof ref.end === 'number'
                ? ref.end - ref.offset
                : 4 + ref.name.length;

            if (scope.kind === 'dataset' && declarationInAnyScope(parsed, { sigil, name: ref.name })) {
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
                const scope = resolveDeclarationScope(parsed, exprOffset);
                for (const hit of checkBooleanEquals(rawExpr, parsed, scope.kind === 'unknown' ? null : scope)) {
                    add(
                        exprOffset + hit.start,
                        hit.end - hit.start,
                        BOOLEAN_EQUALS_MESSAGE,
                        'warning',
                        BOOLEAN_EQUALS_CODE,
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
    } catch {
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
function parseSafely(text: string, fileName: string, scan: XmlScanResult | null = null): ParseResult {
    try {
        return parseReport(
            textSource(text, `jrxml-diagnostics://${fileName || 'untitled'}`, hashText(text)),
            scan
        );
    } catch {
        return emptyParseResult();
    }
}

function hashText(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return hash;
}

function duplicateMessage(duplicate: DuplicateName): string {
    const labels: Record<string, string> = {
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

interface SyntaxProblem {
    index: number;
    message: string;
}

interface OpenParen {
    ch: string;
    index: number;
}

/**
 * Check for unbalanced ( ) [ ] in the expression. Only " is a string delimiter
 * (single quotes are common inside Jasper strings), and $F{}/$P{}/$V{}/$R{}/$X{}
 * tokens are skipped.
 */
function checkParens(expr: string): SyntaxProblem | null {
    const stack: OpenParen[] = [];
    const pairs: Record<string, string> = { ')': '(', ']': '[' };
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
            const top = stack[stack.length - 1];
            if (stack.length === 0 || top.ch !== pairs[ch]) {
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
function checkUnclosedString(expr: string): SyntaxProblem | null {
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
function forEachExpression(
    scan: XmlScanResult,
    text: string,
    callback: (rawExpression: string, startOffset: number) => void
): void {
    const expressionRegions = regions(scan, text)
        .filter(region => EXPRESSION_TAGS.includes(region.tag));

    forEachRegion(expressionRegions, region => {
        if (!region.expression) return;
        callback(region.expression, region.contentStart);
    });
}

export { collectFindings };
