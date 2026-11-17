// javaSourceScan.ts
// Finds the Java classes a report can call and the public static methods they
// expose.
//
// Maven and Gradle keep sources in <module>/src/main/java, and an aggregator
// project nests those modules at arbitrary depths, so the scan looks for that
// directory anywhere below each workspace folder instead of assuming the
// workspace root is a single project. Build outputs, dependency folders and
// dot-directories are skipped, and the walk is bounded so a large monorepo
// cannot block the extension host indefinitely.
//
// This module is deliberately free of `vscode` imports: the completion provider
// owns the cache and the configuration, the scanner only touches the file
// system.

import * as fs from 'fs';
import * as path from 'path';

import type { CustomMethod } from './expressionSuggestions';

/** Directories that never hold project sources worth scanning. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
    'node_modules', 'target', 'build', 'out', 'bin', 'dist', 'coverage',
    'vendor', 'generated', 'generated-sources', 'test',
]);

const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_FILES = 8000;

export interface JavaScanOptions {
    /**
     * Workspace-relative folders scanned in addition to every discovered
     * `src/main/java` (for layouts Maven and Gradle do not use).
     */
    readonly extraPaths?: readonly string[];
    /** How deep the module search descends below a workspace root. */
    readonly maxDepth?: number;
    /** Upper bound on the number of `.java` files read in one scan. */
    readonly maxFiles?: number;
}

// ── File system helpers ──────────────────────────────────────────────────────

function isDirectory(target: string): boolean {
    try {
        return fs.statSync(target).isDirectory();
    } catch {
        return false;
    }
}

/** Read a directory, returning `[]` for unreadable or missing paths. */
function children(dir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

function isSkippedDirectory(entry: fs.Dirent): boolean {
    return entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name);
}

// ── Source roots ─────────────────────────────────────────────────────────────

/**
 * Every `src/main/java` directory below `workspaceRoot`, plus the configured
 * extra paths. Symlinks are not followed, so a cyclic link cannot hang the walk.
 */
export function discoverJavaSourceRoots(
    workspaceRoot: string,
    options: JavaScanOptions = {}
): string[] {
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const roots: string[] = [];
    const seen = new Set<string>();

    const add = (candidate: string): void => {
        const resolved = path.resolve(candidate);
        if (seen.has(resolved) || !isDirectory(resolved)) return;
        seen.add(resolved);
        roots.push(resolved);
    };

    const visit = (dir: string, depth: number): void => {
        // A module keeps its sources one level below `src/main`.
        add(path.join(dir, 'src', 'main', 'java'));
        if (depth >= maxDepth) return;

        for (const entry of children(dir)) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
            if (isSkippedDirectory(entry)) continue;
            // `src` itself is covered by the parent's `src/main/java` check.
            if (entry.name === 'src') continue;
            visit(path.join(dir, entry.name), depth + 1);
        }
    };

    const root = path.resolve(workspaceRoot);
    if (isDirectory(root)) visit(root, 0);

    for (const extra of options.extraPaths ?? []) {
        if (typeof extra !== 'string') continue;
        const trimmed = extra.trim();
        if (trimmed) add(path.resolve(root, trimmed));
    }

    return roots;
}

// ── Method extraction ────────────────────────────────────────────────────────

const PACKAGE_PATTERN = /^\s*package\s+([\w.]+)\s*;/m;
const TYPE_PATTERN = /\bpublic\s+(?:(?:final|abstract|sealed|non-sealed)\s+)*(?:class|interface|enum|record)\s+(\w+)/;

// `public` … `static` in any modifier order, then the return type and the
// method name. The return type may be qualified, generic or an array.
const METHOD_PATTERN =
    /\bpublic\s+((?:(?:final|synchronized|static|strictfp|native)\s+)*?)static\s+((?:(?:final|synchronized|strictfp|native)\s+)*)([^;{}()=]+?)\s+(\w+)\s*\(([^)]*)\)/g;

/** Drop a leading `<T extends X>` block from a generic method's return type. */
function stripLeadingTypeParameters(type: string): string {
    const text = type.trim();
    if (!text.startsWith('<')) return text;

    let depth = 0;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (char === '<') depth += 1;
        else if (char === '>') {
            depth -= 1;
            if (depth === 0) return text.slice(i + 1).trim();
        }
    }
    return text;
}

/** Split parameters on the commas that are not inside a generic argument list. */
function splitParameters(args: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of args) {
        if (char === '<') depth += 1;
        else if (char === '>' && depth > 0) depth -= 1;

        if (char === ',' && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    if (current.trim()) parts.push(current);
    return parts;
}

/** `String name, int age` → `['name', 'age']`; missing names become `argN`. */
function parameterNames(argsString: string): string[] {
    if (!argsString.trim()) return [];

    return splitParameters(argsString).map((parameter, index) => {
        const withoutAnnotations = parameter.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
        const tokens = withoutAnnotations.split(/\s+/).filter(Boolean);
        const name = tokens[tokens.length - 1] ?? '';
        return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `arg${index + 1}`;
    });
}

/**
 * Extract the callable static methods from one Java source. Only members of a
 * `public` top-level type are usable from a report expression, which compiles
 * in its own generated class.
 */
export function extractStaticMethods(source: string): CustomMethod[] {
    const typeMatch = TYPE_PATTERN.exec(source);
    if (!typeMatch) return [];

    const className = typeMatch[1];
    const packageMatch = PACKAGE_PATTERN.exec(source);
    const pkg = packageMatch ? packageMatch[1] : '';
    const qualifiedClass = pkg ? `${pkg}.${className}` : className;

    const methods: CustomMethod[] = [];
    const seen = new Set<string>();

    METHOD_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = METHOD_PATTERN.exec(source)) !== null) {
        const returnType = stripLeadingTypeParameters(match[3] ?? '');
        const methodName = match[4];
        const argsString = (match[5] ?? '').trim();
        if (!methodName || !returnType) continue;

        const names = parameterNames(argsString);
        const snippetArgs = names.map((name, index) => `\${${index + 1}:${name}}`).join(', ');
        const snippet = `${qualifiedClass}.${methodName}(${snippetArgs})`;
        if (seen.has(snippet)) continue;
        seen.add(snippet);

        methods.push({
            label: `${className}.${methodName}`,
            detail: `${qualifiedClass}.${methodName}(${argsString}) : ${returnType}`,
            doc: `**Class:** \`${qualifiedClass}\`\n\nReturns: \`${returnType}\``,
            snippet,
        });
    }

    return methods;
}

// ── Scan ─────────────────────────────────────────────────────────────────────

/** Read every `.java` file below the given roots, in a stable order. */
export function scanJavaMethods(
    roots: readonly string[],
    options: JavaScanOptions = {}
): CustomMethod[] {
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

    const methods: CustomMethod[] = [];
    const seenFiles = new Set<string>();
    const seenSnippets = new Set<string>();
    let filesRead = 0;
    let exhausted = false;

    const walk = (dir: string, depth: number): void => {
        if (exhausted || depth > maxDepth) return;

        for (const entry of children(dir)) {
            if (exhausted) return;

            if (entry.isSymbolicLink()) continue;

            if (entry.isDirectory()) {
                if (isSkippedDirectory(entry)) continue;
                walk(path.join(dir, entry.name), depth + 1);
                continue;
            }

            if (!entry.isFile() || !entry.name.endsWith('.java')) continue;

            const file = path.resolve(dir, entry.name);
            if (seenFiles.has(file)) continue;
            if (filesRead >= maxFiles) {
                exhausted = true;
                return;
            }
            seenFiles.add(file);
            filesRead += 1;

            let source: string;
            try {
                source = fs.readFileSync(file, 'utf-8');
            } catch {
                continue; // unreadable file — skip it, keep the scan going
            }

            for (const method of extractStaticMethods(source)) {
                if (seenSnippets.has(method.snippet)) continue;
                seenSnippets.add(method.snippet);
                methods.push(method);
            }
        }
    };

    for (const root of roots) walk(path.resolve(root), 0);

    if (exhausted) {
        console.warn(
            `[jrxml] Java helper scan stopped after ${maxFiles} files; ` +
            'some helper methods may be missing.'
        );
    }

    return methods;
}

/**
 * Discover and scan in one step. `workspaceRoots` are the folder paths, in the
 * order the workspace lists them.
 */
export function collectJavaMethods(
    workspaceRoots: readonly string[],
    options: JavaScanOptions = {}
): CustomMethod[] {
    const roots: string[] = [];
    const seen = new Set<string>();

    for (const root of workspaceRoots) {
        for (const candidate of discoverJavaSourceRoots(root, options)) {
            if (seen.has(candidate)) continue;
            seen.add(candidate);
            roots.push(candidate);
        }
    }

    return scanJavaMethods(roots, options);
}
