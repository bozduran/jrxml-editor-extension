// javaSymbols.ts
// Lint for the Java names a report expression mentions: imports, declaration
//
// This module is vscode-free: the editor, the workspace validator and the
// tests run the same checks.
// classes, static helper calls and typed receiver calls.
//
// The project index (javaProjectIndex) supplies the workspace's own classes;
// jdkMemberIndex supplies the JDK and JasperReports engine types the extension
// ships. Anything outside those two worlds — a third-party dependency class —
// is skipped rather than guessed at, so the checks stay high-confidence.
//
// Expressions are masked with the same length-preserving reference masker the
// null-dereference rule uses, so AST spans map back to the document.

import { getMembers, isIndexed, normalizeTypeKey } from './jdkMemberIndex';
import type { MemberLookup } from './jdkMemberIndex';
import { resolveExpression, arityMatches } from './memberResolver';
import type { Resolution } from './memberResolver';
import { classBySimpleName } from './javaProjectIndex';
import type { JavaProjectIndex } from './javaProjectIndex';
import type { JavaClass, JavaMethod } from './javaSourceScan';
import { parseExpression, childExpressions } from './javaParser';
import type { JavaExpressionNode, MethodCallNode } from './javaParser';
import { maskReferences } from './expressionMask';
import { suggestName } from './textDistance';
import { regions } from './expressionRegions';
import { EXPRESSION_TAGS } from './expressionTags';
import type { Declaration, ImportDeclaration, ParseResult } from './jrxmlParser';
import type { XmlScanResult } from './xmlspan';

/** Elements whose content is a Java expression for lint purposes. */
const JAVA_EXPRESSION_TAGS: ReadonlySet<string> = new Set([
    ...EXPRESSION_TAGS,
    'propertyExpression',
    'subreportParameterExpression',
    'datasetParameterExpression',
]);

/** Packages the report compiler imports implicitly (plus java.lang). */
const IMPLICIT_PACKAGES: readonly string[] = [
    'java.lang', 'java.util', 'java.text', 'java.io', 'java.net',
];

export interface JavaSymbolFinding {
    offset: number;
    length: number;
    message: string;
    code: string;
}

export interface JavaSymbolInput {
    text: string;
    scan: XmlScanResult;
    parsed: ParseResult;
    index: JavaProjectIndex;
    /** Newest JDK members to offer; defaults to 8. */
    baseline?: number;
    /** False for Groovy/JavaScript reports. */
    javaLanguage?: boolean;
}

interface ResolvedType {
    /** Fully qualified name when one could be determined. */
    fqn: string | null;
    /** Why it resolved, or `unresolved` when nothing matched. */
    origin: 'fqn' | 'import' | 'wildcard' | 'implicit' | 'project-simple' | 'unresolved';
    projectClass: JavaClass | null;
}

function finding(offset: number, length: number, message: string, code: string): JavaSymbolFinding {
    return { offset, length, message, code };
}

/** Strip `[]`/`...` and generics; primitives and arrays are not class lookups. */
function baseTypeName(raw: string | null | undefined): string | null {
    let text = String(raw ?? '').trim();
    if (!text) return null;
    text = text.replace(/\.\.\.$/, '');
    text = text.replace(/(\[\])+$/, '');
    const generic = text.indexOf('<');
    if (generic !== -1) text = text.slice(0, generic);
    return text.trim() || null;
}

function isPrimitive(name: string): boolean {
    return /^(boolean|byte|char|short|int|long|float|double|void)$/.test(name);
}

/** True when the name lives in a package this workspace actually contains. */
function isProjectPackage(fqn: string, index: JavaProjectIndex): boolean {
    const dot = fqn.lastIndexOf('.');
    return dot !== -1 && index.packages.has(fqn.slice(0, dot));
}

/**
 * The project class this name most likely misspells, or null.
 *
 * The JDK member table is a *member* table, not a complete class list, so
 * absence from it is never evidence. Only a name in a package we scanned, close
 * to a class we actually found, is reported as unknown.
 */
function closeProjectClass(fqn: string, index: JavaProjectIndex): string | null {
    const dot = fqn.lastIndexOf('.');
    if (dot === -1) return null;

    const packageName = fqn.slice(0, dot);
    const simple = fqn.slice(dot + 1);
    if (!isProjectPackage(fqn, index)) return null;

    const candidates = index.classes
        .filter(javaClass => javaClass.packageName === packageName)
        .map(javaClass => javaClass.className);
    return suggestName(simple, candidates);
}

function isIndexedType(fqn: string): boolean {
    return isIndexed(fqn);
}

/** The workspace class a type key names, or null. */
function projectClassFor(typeKey: string, index: JavaProjectIndex): JavaClass | null {
    const direct = index.byQualified.get(typeKey);
    if (direct) return direct;
    return typeKey.includes('.') ? null : classBySimpleName(index, typeKey);
}

/** A MemberLookup view over a scanned project class. */
function projectMemberLookup(javaClass: JavaClass): MemberLookup {
    return {
        typeKey: javaClass.qualifiedName,
        resolved: true,
        kind: 'class',
        methods: javaClass.methods.map(method => ({
            name: method.name,
            params: method.parameters.map(parameter => parameter.type),
            returns: method.returnType,
            static: method.static,
            varargs: method.varargs,
            since: 8,
            declaringType: javaClass.qualifiedName,
        })),
        fields: [],
        ambiguous: false,
    };
}

/** Resolve a receiver type against the project first, then the member table. */
function typeLookup(index: JavaProjectIndex, baseline: number) {
    return (typeKey: string | null): MemberLookup => {
        if (typeKey) {
            const project = projectClassFor(typeKey, index);
            if (project) return projectMemberLookup(project);
        }
        return getMembers(typeKey, { baseline });
    };
}

/** Resolve a written class name against imports, the project and the index. */
function resolveType(
    name: string,
    imports: readonly ImportDeclaration[],
    index: JavaProjectIndex
): ResolvedType {
    const simple = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;

    if (name.includes('.')) {
        const projectClass = index.byQualified.get(name) ?? null;
        if (projectClass) return { fqn: name, origin: 'fqn', projectClass };
        if (isIndexedType(name)) return { fqn: name, origin: 'fqn', projectClass: null };
        return { fqn: null, origin: 'unresolved', projectClass: null };
    }

    for (const entry of imports) {
        if (entry.value.endsWith('.*')) continue;
        if (entry.value === name || entry.value.endsWith(`.${name}`)) {
            const projectClass = index.byQualified.get(entry.value) ?? null;
            if (projectClass) return { fqn: entry.value, origin: 'import', projectClass };
            if (isIndexedType(entry.value)) return { fqn: entry.value, origin: 'import', projectClass: null };
            return { fqn: null, origin: 'unresolved', projectClass: null };
        }
    }

    for (const entry of imports) {
        if (!entry.value.endsWith('.*')) continue;
        const prefix = entry.value.slice(0, -1); // keep the dot
        const candidate = `${prefix}${simple}`;
        const projectClass = index.byQualified.get(candidate) ?? null;
        if (projectClass) return { fqn: candidate, origin: 'wildcard', projectClass };
        if (isIndexedType(candidate)) return { fqn: candidate, origin: 'wildcard', projectClass: null };
    }

    for (const pkg of IMPLICIT_PACKAGES) {
        const candidate = `${pkg}.${simple}`;
        if (isIndexedType(candidate)) {
            return { fqn: normalizeTypeKey(candidate), origin: 'implicit', projectClass: null };
        }
    }

    const projectClass = classBySimpleName(index, simple);
    if (projectClass) {
        return { fqn: projectClass.qualifiedName, origin: 'project-simple', projectClass };
    }

    const normalized = normalizeTypeKey(simple);
    if (normalized && isIndexedType(normalized)) {
        return { fqn: normalized, origin: 'implicit', projectClass: null };
    }

    return { fqn: null, origin: 'unresolved', projectClass: null };
}

// ── Expression walking ───────────────────────────────────────────────────────

function forEachCall(node: JavaExpressionNode, visit: (call: MethodCallNode) => void): void {
    if (node.kind === 'methodCall') visit(node);
    for (const child of childExpressions(node)) forEachCall(child, visit);
}

/** `com.acme.Helpers` for a name/field-access chain, or null. */
function flattenName(node: JavaExpressionNode | null): string | null {
    if (!node) return null;
    if (node.kind === 'name') return node.name;
    if (node.kind === 'fieldAccess') {
        const scope = flattenName(node.scope);
        return scope ? `${scope}.${node.name}` : null;
    }
    return null;
}

function expressionTexts(scan: XmlScanResult, text: string): { expression: string; contentStart: number; tag: string }[] {
    return regions(scan, text, JAVA_EXPRESSION_TAGS)
        .map(region => ({ expression: region.expression, contentStart: region.contentStart, tag: region.tag }))
        .filter(region => region.expression.length > 0);
}

// ── Checks ───────────────────────────────────────────────────────────────────

function checkImports(
    imports: readonly ImportDeclaration[],
    expressions: readonly { expression: string }[],
    index: JavaProjectIndex
): JavaSymbolFinding[] {
    const findings: JavaSymbolFinding[] = [];
    if (imports.length === 0) return findings;

    const allExpressions = expressions.map(region => region.expression).join('\n');

    for (const entry of imports) {
        if (entry.value.endsWith('.*')) continue; // package wildcards cannot be verified

        const resolved = resolveType(entry.value, [], index);
        if (resolved.origin === 'unresolved') {
            const hint = closeProjectClass(entry.value, index);
            if (!hint && !isProjectPackage(entry.value, index)) continue;
            findings.push(finding(
                entry.valueOffset, entry.valueLength,
                `Import '${entry.value}' does not exist in this workspace${hint ? `; did you mean '${hint}'?` : '.'}`,
                'jrxml.unknownImport'
            ));
            continue;
        }

        const simple = entry.value.slice(entry.value.lastIndexOf('.') + 1);
        const used = new RegExp(`\\b${simple.replace(/[$]/g, '\\$')}\\b`).test(allExpressions);
        if (!used) {
            findings.push(finding(
                entry.valueOffset, entry.valueLength,
                `Imported class '${simple}' is never used in this report's expressions.`,
                'jrxml.unusedImport'
            ));
        }
    }

    return findings;
}

function checkDeclarationClasses(
    declarations: readonly Declaration[],
    index: JavaProjectIndex
): JavaSymbolFinding[] {
    const findings: JavaSymbolFinding[] = [];

    for (const declaration of declarations) {
        if (declaration.typeSource === 'inferred') continue;

        const name = baseTypeName(declaration.fullType || declaration.type);
        if (!name || isPrimitive(name)) continue;

        const resolved = resolveType(name, [], index);
        if (resolved.origin !== 'unresolved') continue;

        const hint = closeProjectClass(name, index);
        if (!hint && !isProjectPackage(name, index)) continue;

        findings.push(finding(
            declaration.nameOffset, declaration.name.length,
            `Class '${name}' does not exist in this workspace${hint ? `; did you mean '${hint}'?` : '.'}`,
            'jrxml.unknownClass'
        ));
    }

    return findings;
}

function checkStaticCall(
    call: MethodCallNode,
    className: string,
    imports: readonly ImportDeclaration[],
    index: JavaProjectIndex,
    baseline: number,
    base: number
): JavaSymbolFinding | null {
    const resolved = resolveType(className, imports, index);

    if (resolved.origin === 'project-simple') {
        const target = resolved.projectClass;
        if (target && !imports.some(entry => entry.value === target.qualifiedName)) {
            return finding(
                base + call.start, call.end - call.start,
                `'${target.className}' resolves to the project class '${target.qualifiedName}' but the report does not import it. Add <import value="${target.qualifiedName}"/> or use the fully qualified name.`,
                'jrxml.missingImport'
            );
        }
    }

    if (resolved.fqn === null) {
        // Only a near-miss of a project class is evidence; a dependency class
        // the extension has never seen is not.
        const hint = closeProjectClass(className, index);
        if (!hint && !isProjectPackage(className, index)) return null;

        return finding(
            base + call.start, call.end - call.start,
            `Class '${className}' does not exist in this workspace${hint ? `; did you mean '${hint}'?` : '.'}`,
            'jrxml.unknownClass'
        );
    }

    const projectClass = resolved.projectClass;
    if (projectClass) return checkProjectMethod(call, projectClass, base);

    const members = getMembers(resolved.fqn, { baseline, includeStatics: true });
    if (!members.resolved) return null;

    const named = members.methods.filter(method => method.name === call.name);
    const statics = named.filter(method => method.static);

    if (statics.length === 0) {
        if (named.length > 0) {
            return finding(
                base + call.start, call.end - call.start,
                `'${call.name}' is declared by '${resolved.fqn}' but is not static.`,
                'jrxml.unknownJavaHelper'
            );
        }
        return finding(
            base + call.start, call.end - call.start,
            `Class '${resolved.fqn}' has no method named '${call.name}'.`,
            'jrxml.unknownJavaHelper'
        );
    }

    if (!statics.some(method => arityMatches(method, call.args.length))) {
        return finding(
            base + call.start, call.end - call.start,
            `No overload of '${resolved.fqn}.${call.name}' takes ${call.args.length} argument(s).`,
            'jrxml.javaHelperArity'
        );
    }

    return null;
}

function checkProjectMethod(call: MethodCallNode, projectClass: JavaClass, base: number): JavaSymbolFinding | null {
    // A class whose methods the scanner could not read is not evidence of a
    // missing method; stay quiet rather than guess.
    if (projectClass.methods.length === 0) return null;

    const named = projectClass.methods.filter(method => method.name === call.name);
    const statics = named.filter(method => method.static);

    if (statics.length === 0) {
        if (named.length > 0) {
            return finding(
                base + call.start, call.end - call.start,
                `'${call.name}' is declared by '${projectClass.qualifiedName}' but is not static.`,
                'jrxml.unknownJavaHelper'
            );
        }
        if (projectClass.superClass) return null; // inherited statics are not scanned
        return finding(
            base + call.start, call.end - call.start,
            `Class '${projectClass.qualifiedName}' has no method named '${call.name}'.`,
            'jrxml.unknownJavaHelper'
        );
    }

    const accepts = (method: JavaMethod): boolean => {
        if (method.parameters.length === call.args.length) return true;
        return method.varargs && call.args.length >= method.parameters.length - 1;
    };
    if (!statics.some(accepts)) {
        return finding(
            base + call.start, call.end - call.start,
            `No overload of '${projectClass.qualifiedName}.${call.name}' takes ${call.args.length} argument(s).`,
            'jrxml.javaHelperArity'
        );
    }

    return null;
}

/** Map a receiver-call failure to a finding, if it is about this call. */
function memberCallFinding(
    call: MethodCallNode,
    callText: string,
    resolution: Resolution,
    base: number,
    index: JavaProjectIndex,
    lookup: (typeKey: string | null) => MemberLookup
): JavaSymbolFinding | null {
    if (resolution.reason !== 'unknown-method') return null;
    if (resolution.methodName !== call.name) return null;
    if (!resolution.typeKey) return null;

    const members = lookup(resolution.typeKey);
    if (!members || !members.resolved) return null;

    const named = members.methods.filter(method => method.name === call.name);
    if (named.length === 0) {
        // An inherited method is not scanned, so silence is the honest answer.
        const project = projectClassFor(resolution.typeKey, index);
        if (project?.superClass) return null;
    }

    const open = callText.indexOf('(');
    const head = open === -1 ? callText : callText.slice(0, open + 1);
    const nameIndex = head.lastIndexOf(call.name);
    const offset = base + call.start + (nameIndex >= 0 ? nameIndex : 0);

    if (named.length > 0) {
        return finding(
            offset, call.name.length,
            `No overload of '${resolution.typeKey}.${call.name}' takes ${call.args.length} argument(s).`,
            'jrxml.javaMemberArity'
        );
    }

    return finding(
        offset, call.name.length,
        `Type '${resolution.typeKey}' has no method '${call.name}' for this call.`,
        'jrxml.unknownJavaMember'
    );
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Every Java-name finding for one report. `javaLanguage: false` skips the whole
 * family, because the Java member table does not describe Groovy or JavaScript.
 */
export function checkJavaSymbols(input: JavaSymbolInput): JavaSymbolFinding[] {
    if (input.javaLanguage === false) return [];

    const { parsed, index } = input;
    const baseline = input.baseline ?? 8;
    const expressions = expressionTexts(input.scan, input.text);
    const findings: JavaSymbolFinding[] = [];
    const seen = new Set<string>();
    const push = (entry: JavaSymbolFinding | null): void => {
        if (!entry) return;
        const key = `${entry.offset}:${entry.code}`;
        if (seen.has(key)) return;
        seen.add(key);
        findings.push(entry);
    };

    for (const entry of checkImports(parsed.imports, expressions, index)) push(entry);
    for (const entry of checkDeclarationClasses(
        [...parsed.allFields, ...parsed.allParameters, ...parsed.allVariables], index
    )) push(entry);

    const declarations = {
        fields: parsed.allFields,
        parameters: parsed.allParameters,
        variables: parsed.allVariables,
    };
    const lookup = typeLookup(index, baseline);
    const resolverContext = { declarations, lookup };

    for (const region of expressions) {
        if (region.tag === 'printWhenExpression' && isLiteralExpression(region.expression)) {
            push(finding(
                region.contentStart, region.expression.length,
                'printWhenExpression must evaluate to a boolean, but this is a literal value.',
                'jrxml.printWhenNotBoolean'
            ));
        }

        const masked = maskReferences(region.expression);
        const ast = parseExpression(masked);
        if (!ast) continue;

        forEachCall(ast, call => {
            const className = flattenName(call.scope);
            if (className) {
                const last = className.slice(className.lastIndexOf('.') + 1);
                // `$F_item_` and other masked references are not class names.
                if (/^[A-Z][\w$]*$/.test(last)) {
                    push(checkStaticCall(call, className, parsed.imports, index, baseline, region.contentStart));
                    return;
                }
            }

            // A receiver call on a declared value, e.g. $F{name}.trim().
            const callText = region.expression.slice(call.start, call.end);
            const resolution = resolveExpression(callText, resolverContext, 0);
            push(memberCallFinding(call, callText, resolution, region.contentStart, index, lookup));
        });
    }

    findings.sort((a, b) => a.offset - b.offset || a.code.localeCompare(b.code));
    return findings;
}

function isLiteralExpression(expression: string): boolean {
    const text = expression.trim();
    if (!text) return false;
    if (text === 'null') return true;
    if (/^"(?:[^"\\]|\\.)*"$/.test(text)) return true;
    if (/^'(?:[^'\\]|\\.)*'$/.test(text)) return true;
    return /^[+-]?(?:\d|\.\d)/.test(text) && !/\$[FPV]\{/.test(text);
}
