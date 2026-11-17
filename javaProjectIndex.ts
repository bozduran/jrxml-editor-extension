// javaProjectIndex.ts
// The workspace's Java sources, indexed once and shared by completion, lint and
// the CI validator.
//
// The scanner (javaSourceScan) only walks the file system; this module owns the
// cache and the lookups the checks need: a class by qualified name, classes by
// simple name, and the package set that tells a project class apart from a
// third-party dependency the extension knows nothing about.

import { collectJavaClasses, staticMethodsOf } from './javaSourceScan';
import type { JavaClass, JavaScanOptions } from './javaSourceScan';
import type { CustomMethod } from './expressionSuggestions';

export interface JavaProjectIndex {
    readonly classes: readonly JavaClass[];
    readonly methods: CustomMethod[];
    readonly byQualified: ReadonlyMap<string, JavaClass>;
    readonly bySimpleName: ReadonlyMap<string, readonly JavaClass[]>;
    readonly packages: ReadonlySet<string>;
}

export const EMPTY_JAVA_PROJECT_INDEX: JavaProjectIndex = Object.freeze({
    classes: Object.freeze([]) as readonly JavaClass[],
    methods: [],
    byQualified: new Map<string, JavaClass>(),
    bySimpleName: new Map<string, readonly JavaClass[]>(),
    packages: new Set<string>(),
});

/** Index an already-scanned set of classes. Pure, so tests need no filesystem. */
export function buildJavaProjectIndex(classes: readonly JavaClass[]): JavaProjectIndex {
    const byQualified = new Map<string, JavaClass>();
    const bySimpleName = new Map<string, JavaClass[]>();
    const packages = new Set<string>();
    const unique: JavaClass[] = [];

    for (const javaClass of classes) {
        if (byQualified.has(javaClass.qualifiedName)) continue;
        byQualified.set(javaClass.qualifiedName, javaClass);
        unique.push(javaClass);

        if (javaClass.packageName) packages.add(javaClass.packageName);
        const sameName = bySimpleName.get(javaClass.className);
        if (sameName) sameName.push(javaClass);
        else bySimpleName.set(javaClass.className, [javaClass]);
    }

    // Short-name lookups are only trustworthy when the name is unambiguous.
    for (const [simpleName, list] of bySimpleName) {
        if (list.length > 1) bySimpleName.set(simpleName, list.slice().sort(
            (a, b) => a.qualifiedName.localeCompare(b.qualifiedName)
        ));
    }

    return {
        classes: unique,
        methods: staticMethodsOf(unique),
        byQualified,
        bySimpleName,
        packages,
    };
}

/** One class for an exact simple name, or null when unknown/ambiguous. */
export function classBySimpleName(index: JavaProjectIndex, simpleName: string): JavaClass | null {
    const candidates = index.bySimpleName.get(simpleName);
    return candidates && candidates.length === 1 ? candidates[0] : null;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
    key: string;
    index: JavaProjectIndex;
}

let cache: CacheEntry | null = null;

function cacheKey(roots: readonly string[], options: JavaScanOptions): string {
    return JSON.stringify([
        roots,
        options.extraPaths ?? [],
        options.maxDepth ?? null,
        options.maxFiles ?? null,
    ]);
}

/**
 * The index for the given workspace folders. Scans on the first call, then
 * returns the cached index until `clearJavaProjectIndex` runs.
 */
export function getJavaProjectIndex(
    workspaceRoots: readonly string[],
    options: JavaScanOptions = {}
): JavaProjectIndex {
    const roots = workspaceRoots.filter(root => typeof root === 'string' && root.length > 0);
    if (roots.length === 0) return EMPTY_JAVA_PROJECT_INDEX;

    const key = cacheKey(roots, options);
    if (cache && cache.key === key) return cache.index;

    let classes: JavaClass[] = [];
    try {
        classes = collectJavaClasses(roots, options);
    } catch (err) {
        console.error('Error scanning Java sources:', err);
    }

    const index = buildJavaProjectIndex(classes);
    cache = { key, index };
    return index;
}

/** Drop the cached scan (Java file or configuration changes). */
export function clearJavaProjectIndex(): void {
    cache = null;
}
