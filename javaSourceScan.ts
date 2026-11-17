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
const TYPE_PATTERN = /\bpublic\s+(?:(?:final|abstract|sealed|non-sealed)\s+)*(?:class|interface|enum|record)\s+(\w+)(?:\s+extends\s+([\w.$<>]+))?/;

// A public method in any modifier order. The return type may be qualified,
// generic or an array; `static` is recorded rather than required, so a call to
// an instance method can be reported as such instead of as unknown.
const METHOD_PATTERN =
    /\bpublic\s+((?:(?:final|synchronized|static|strictfp|native|abstract)\s+)*)([^;{}()=]+?)\s+(\w+)\s*\(([^)]*)\)/g;

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

/** One parameter of a scanned method. */
export interface JavaParameter {
    readonly type: string;
    readonly name: string;
}

/** A public method, static or not; callers decide which are callable. */
export interface JavaMethod {
    readonly name: string;
    readonly returnType: string;
    readonly parameters: readonly JavaParameter[];
    readonly varargs: boolean;
    readonly static: boolean;
}

/** A public top-level type and its public methods. */
export interface JavaClass {
    readonly packageName: string;
    readonly className: string;
    readonly qualifiedName: string;
    /** Simple superclass name when the declaration extends one. */
    readonly superClass: string | null;
    readonly methods: readonly JavaMethod[];
}

/** `String name, int age` → two parameters; missing names become `argN`. */
function parametersOf(argsString: string): { parameters: JavaParameter[]; varargs: boolean } {
    const parameters: JavaParameter[] = [];
    let varargs = false;

    for (const raw of splitParameters(argsString)) {
        const withoutAnnotations = raw.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
        if (!withoutAnnotations) continue;

        const tokens = withoutAnnotations.split(/\s+/).filter(Boolean);
        const rawName = tokens[tokens.length - 1] ?? '';
        const name = /^[A-Za-z_$][\w$]*$/.test(rawName) ? rawName : `arg${parameters.length + 1}`;

        let type = tokens.slice(0, -1).join(' ').replace(/^final\s+/, '').trim();
        if (type.endsWith('...')) {
            varargs = true;
            type = `${type.slice(0, -3).trim()}[]`;
        }
        parameters.push({ type, name });
    }

    return { parameters, varargs };
}

/**
 * Extract the public members of the file's `public` top-level type. Only such
 * members are usable from a report expression, which compiles in its own
 * generated class.
 */
export function extractJavaClass(source: string): JavaClass | null {
    const typeMatch = TYPE_PATTERN.exec(source);
    if (!typeMatch) return null;

    const className = typeMatch[1] ?? '';
    const packageMatch = PACKAGE_PATTERN.exec(source);
    const packageName = (packageMatch ? packageMatch[1] : '') ?? '';

    const methods: JavaMethod[] = [];
    const seen = new Set<string>();

    METHOD_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = METHOD_PATTERN.exec(source)) !== null) {
        const modifiers = match[1] ?? '';
        const returnType = stripLeadingTypeParameters(match[2] ?? '');
        const name = match[3] ?? '';
        const argsString = (match[4] ?? '').trim();
        if (!name || !returnType) continue;

        const { parameters, varargs } = parametersOf(argsString);
        const key = `${name}(${parameters.map(parameter => parameter.type).join(',')})`;
        if (seen.has(key)) continue;
        seen.add(key);

        methods.push({
            name,
            returnType,
            parameters,
            varargs,
            static: /\bstatic\b/.test(modifiers),
        });
    }

    if (!className) return null;
    return {
        packageName,
        className,
        qualifiedName: packageName ? `${packageName}.${className}` : className,
        superClass: typeMatch[2] ?? null,
        methods,
    };
}

/** The completion entry for one static method. */
function customMethodOf(javaClass: JavaClass, method: JavaMethod): CustomMethod {
    const signature = method.parameters
        .map(parameter => (parameter.type ? `${parameter.type} ${parameter.name}` : parameter.name))
        .join(', ');
    const snippetArgs = method.parameters
        .map((parameter, index) => `\${${index + 1}:${parameter.name}}`)
        .join(', ');

    return {
        label: `${javaClass.className}.${method.name}`,
        detail: `${javaClass.qualifiedName}.${method.name}(${signature}) : ${method.returnType}`,
        doc: `**Class:** \`${javaClass.qualifiedName}\`\n\nReturns: \`${method.returnType}\``,
        snippet: `${javaClass.qualifiedName}.${method.name}(${snippetArgs})`,
    };
}

// ── Scan ─────────────────────────────────────────────────────────────────────
/** Read every `.java` file below the given roots, in a stable order. */
export function scanJavaClasses(
    roots: readonly string[],
    options: JavaScanOptions = {}
): JavaClass[] {
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

    const classes: JavaClass[] = [];
    const seenFiles = new Set<string>();
    const seenClasses = new Set<string>();
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

            const javaClass = extractJavaClass(source);
            if (!javaClass || seenClasses.has(javaClass.qualifiedName)) continue;
            seenClasses.add(javaClass.qualifiedName);
            classes.push(javaClass);
        }
    };

    for (const root of roots) walk(path.resolve(root), 0);

    if (exhausted) {
        console.warn(
            `[jrxml] Java helper scan stopped after ${maxFiles} files; ` +
            'some helper methods may be missing.'
        );
    }

    return classes;
}

/** Static methods of the scanned classes, ready for completion. */
export function staticMethodsOf(classes: readonly JavaClass[]): CustomMethod[] {
    const methods: CustomMethod[] = [];
    const seen = new Set<string>();

    for (const javaClass of classes) {
        for (const method of javaClass.methods) {
            if (!method.static) continue;
            const custom = customMethodOf(javaClass, method);
            if (seen.has(custom.snippet)) continue;
            seen.add(custom.snippet);
            methods.push(custom);
        }
    }

    return methods;
}

/** Discover every module and scan it in one step. */
export function collectJavaClasses(
    workspaceRoots: readonly string[],
    options: JavaScanOptions = {}
): JavaClass[] {
    const roots: string[] = [];
    const seen = new Set<string>();

    for (const root of workspaceRoots) {
        for (const candidate of discoverJavaSourceRoots(root, options)) {
            if (seen.has(candidate)) continue;
            seen.add(candidate);
            roots.push(candidate);
        }
    }

    return scanJavaClasses(roots, options);
}
