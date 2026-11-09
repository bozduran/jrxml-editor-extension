// jdkMemberIndex.ts
// The member table behind typed completion: what can be called on a value of a
// given declared class.
//
// Data comes from two committed files — data/jdk-members.json (generated from
// javap by tools/gen-jdk-index.js) and data/extra-types.json (hand-curated
// JasperReports engine types) — so nothing here needs a JDK at runtime.
//
// This module deliberately does not require('vscode'): the receiver resolver,
// the completion builder and the tests all work on plain objects.

import * as fs from 'fs';
import * as path from 'path';

export const INDEX_PATH = path.join(__dirname, 'data', 'jdk-members.json');
export const EXTRA_PATH = path.join(__dirname, 'data', 'extra-types.json');

export interface JdkMethod {
    name: string;
    params: string[];
    returns?: string;
    static?: boolean;
    varargs?: boolean;
    since: number;
    deprecated?: boolean;
}

export interface JdkField {
    name: string;
    type: string;
    static?: boolean;
    since: number;
    deprecated?: boolean;
}

export interface JdkType {
    kind?: string;
    methods?: JdkMethod[];
    fields?: JdkField[];
    super?: string[];
}

/** The generated JDK table, before the extra types are merged in. */
export interface JdkIndexFile {
    schemaVersion?: number;
    generator?: string;
    generatedWith?: string | null;
    baseline?: number;
    note?: string;
    edges?: Record<string, string[]>;
    types?: Record<string, JdkType>;
}

/** data/extra-types.json: hand-curated JasperReports engine types. */
export interface ExtraTypesFile {
    schemaVersion?: number;
    source?: string;
    note?: string;
    types?: Record<string, JdkType>;
}

export interface FlattenedMethod extends JdkMethod {
    declaringType: string;
}

export interface FlattenedField extends JdkField {
    declaringType: string;
}

export interface MemberTable {
    methods: FlattenedMethod[];
    fields: FlattenedField[];
}

export interface Ambiguity {
    name: string;
    candidates: string[];
}

export interface MemberLookup {
    typeKey: string | null;
    resolved: boolean;
    reason?: string;
    kind?: string;
    methods: FlattenedMethod[];
    fields: FlattenedField[];
    ambiguous: boolean;
    ambiguity?: Ambiguity | null;
}

export interface MemberOptions {
    baseline?: number;
    includeStatics?: boolean;
}

export interface MemberIndex {
    types: Record<string, JdkType>;
    edges: Record<string, string[]>;
    baseline: number;
    /** Absent on the minimal fallback table, exactly as the legacy object was. */
    generatedWith?: string | null;
    usingFallback: boolean;
    ambiguous: Map<string, string[]>;
    bySimpleName: Map<string, string[]>;
}

export interface MemberStats {
    types: number;
    members: number;
    baseline: number;
    generatedWith?: string | null;
    usingFallback: boolean;
}

const PRIMITIVES = new Set(['boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void']);

/** Package preference when a short name matches more than one type (`Date`). */
const PACKAGE_PRIORITY = [
    'java.util.',
    'java.lang.',
    'java.sql.',
    'java.time.',
    'java.math.',
    'java.text.',
    'java.net.',
    'net.sf.jasperreports.engine.data.',
    'net.sf.jasperreports.engine.',
];

/**
 * Used only when the generated data is missing or unreadable, so a broken
 * install still completes the most common calls instead of failing.
 */
const MINIMAL_TYPES: Record<string, JdkType> = {
    'java.lang.Object': {
        kind: 'class',
        methods: [
            { name: 'toString', params: [], returns: 'java.lang.String', static: false, since: 8 },
            { name: 'equals', params: ['java.lang.Object'], returns: 'boolean', static: false, since: 8 },
            { name: 'hashCode', params: [], returns: 'int', static: false, since: 8 },
            { name: 'getClass', params: [], returns: 'java.lang.Class', static: false, since: 8 },
        ],
        fields: [],
    },
    'java.lang.String': {
        kind: 'class',
        methods: [
            { name: 'length', params: [], returns: 'int', static: false, since: 8 },
            { name: 'charAt', params: ['int'], returns: 'char', static: false, since: 8 },
            { name: 'substring', params: ['int'], returns: 'java.lang.String', static: false, since: 8 },
            { name: 'substring', params: ['int', 'int'], returns: 'java.lang.String', static: false, since: 8 },
            { name: 'toUpperCase', params: [], returns: 'java.lang.String', static: false, since: 8 },
            { name: 'toLowerCase', params: [], returns: 'java.lang.String', static: false, since: 8 },
            { name: 'trim', params: [], returns: 'java.lang.String', static: false, since: 8 },
            { name: 'indexOf', params: ['java.lang.String'], returns: 'int', static: false, since: 8 },
            { name: 'replace', params: ['java.lang.CharSequence', 'java.lang.CharSequence'], returns: 'java.lang.String', static: false, since: 8 },
            { name: 'startsWith', params: ['java.lang.String'], returns: 'boolean', static: false, since: 8 },
            { name: 'endsWith', params: ['java.lang.String'], returns: 'boolean', static: false, since: 8 },
            { name: 'contains', params: ['java.lang.CharSequence'], returns: 'boolean', static: false, since: 8 },
            { name: 'equals', params: ['java.lang.Object'], returns: 'boolean', static: false, since: 8 },
            { name: 'isEmpty', params: [], returns: 'boolean', static: false, since: 8 },
            { name: 'split', params: ['java.lang.String'], returns: 'java.lang.String[]', static: false, since: 8 },
        ],
        fields: [],
    },
    'java.lang.Number': {
        kind: 'class',
        methods: [
            { name: 'intValue', params: [], returns: 'int', static: false, since: 8 },
            { name: 'longValue', params: [], returns: 'long', static: false, since: 8 },
            { name: 'doubleValue', params: [], returns: 'double', static: false, since: 8 },
            { name: 'floatValue', params: [], returns: 'float', static: false, since: 8 },
        ],
        fields: [],
    },
};

let cachedIndex: MemberIndex | null = null;
const flatCache = new Map<string, MemberTable>();

// ── Loading ───────────────────────────────────────────────────────────────────

/**
 * Read a JSON data file. The shapes are exercised by test/jdkIndexData.test.js;
 * this is the one untyped file boundary, and a bad file yields the fallback.
 */
function readJson<T>(file: string): T | null {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed as T | null;
    } catch {
        return null; // missing/corrupt data must never break completion
    }
}

/** Preference order for short-name collisions, most specific package first. */
function compareFqn(a: string, b: string): number {
    const rank = (fqn: string): number => {
        const i = PACKAGE_PRIORITY.findIndex(prefix => fqn.startsWith(prefix));
        return i === -1 ? PACKAGE_PRIORITY.length : i;
    };
    return rank(a) - rank(b) || a.length - b.length || a.localeCompare(b);
}

/**
 * Merge the generated JDK table with the hand-curated extra types and index the
 * short names. Exported so tests can exercise the fallback without touching the
 * filesystem.
 */
export function buildIndex(
    jdk: JdkIndexFile | null | undefined,
    extra: ExtraTypesFile | null | undefined
): MemberIndex {
    if (!jdk || !jdk.types) {
        return {
            types: MINIMAL_TYPES,
            edges: {},
            baseline: 8,
            usingFallback: true,
            ambiguous: new Map(),
            bySimpleName: new Map(),
        };
    }

    const types = { ...jdk.types };
    const edges = { ...(jdk.edges || {}) };

    if (extra && extra.types) {
        for (const [fqn, type] of Object.entries(extra.types)) {
            types[fqn] = type;
            const supers = Array.isArray(type.super) ? [...type.super] : [];
            // Hand-curated types get the same implicit Object supertype the
            // generated table records for every other reference type.
            if (fqn !== 'java.lang.Object' && !supers.includes('java.lang.Object')) {
                supers.push('java.lang.Object');
            }
            edges[fqn] = supers;
        }
    }

    const ambiguous = new Map<string, string[]>();
    const bySimpleName = new Map<string, string[]>();
    for (const fqn of Object.keys(types)) {
        const simple = fqn.split('.').pop() ?? '';
        const sameName = bySimpleName.get(simple);
        if (sameName) sameName.push(fqn);
        else bySimpleName.set(simple, [fqn]);
    }
    for (const [simple, list] of bySimpleName) {
        list.sort(compareFqn);
        if (list.length > 1) ambiguous.set(simple, list);
    }

    return {
        types,
        edges,
        baseline: jdk.baseline ?? 8,
        generatedWith: jdk.generatedWith || null,
        usingFallback: false,
        bySimpleName,
        ambiguous,
    };
}

/** The merged index, loaded once per process. */
function loadIndex(): MemberIndex {
    if (!cachedIndex) {
        cachedIndex = buildIndex(
            readJson<JdkIndexFile>(INDEX_PATH),
            readJson<ExtraTypesFile>(EXTRA_PATH)
        );
    }
    return cachedIndex;
}

/** Drop every cache (tests, and any future index reload). */
export function clearCache(): void {
    cachedIndex = null;
    flatCache.clear();
}

// ── Type keys ─────────────────────────────────────────────────────────────────

/** Remove generic arguments: `java.util.List<java.lang.String>` → `java.util.List`. */
function stripGenerics(text: string): string {
    let out = '';
    let depth = 0;
    for (const ch of text) {
        if (ch === '<') depth++;
        else if (ch === '>') depth = Math.max(0, depth - 1);
        else if (depth === 0) out += ch;
    }
    return out.trim();
}

/**
 * Resolve a declared `class` value to an index key.
 * Accepts full names, short names (`String`, `JRDataSource`), arrays and
 * primitives. Returns null only for input that names no type at all.
 */
export function normalizeTypeKey(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;

    const key = stripGenerics(String(raw).trim()).replace(/\.\.\.$/, '[]');
    if (!key) return null;
    if (PRIMITIVES.has(key) || key.endsWith('[]')) return key;

    const index = loadIndex();
    if (index.types[key]) return key;

    const candidates = index.bySimpleName.get(key);
    if (candidates && candidates.length) return candidates[0];

    return key; // unknown, but the caller can still report what was asked for
}

/** True when the key names a type this index can list members for. */
export function isIndexed(rawTypeKey: string | null | undefined): boolean {
    const key = normalizeTypeKey(rawTypeKey);
    if (!key) return false;
    if (key.endsWith('[]')) return true;
    return !!loadIndex().types[key];
}

/** `{ candidates: [...] }` when a short name is ambiguous, else null. */
export function ambiguityOf(rawTypeKey: string | null | undefined): Ambiguity | null {
    const key = stripGenerics(String(rawTypeKey ?? '').trim());
    const index = loadIndex();
    if (!key || key.includes('.') || index.types[key]) return null;
    const candidates = index.ambiguous.get(key);
    return candidates ? { name: key, candidates: [...candidates] } : null;
}

// ── Member lookup ─────────────────────────────────────────────────────────────

/**
 * Own and inherited members of one type, most-derived first, deduplicated by
 * signature. Cached: the completion provider calls this on every keystroke.
 */
function flattened(typeKey: string): MemberTable {
    const index = loadIndex();
    const cached = flatCache.get(typeKey);
    if (cached) return cached;

    const methods: FlattenedMethod[] = [];
    const fields: FlattenedField[] = [];
    const seenMethods = new Set<string>();
    const seenFields = new Set<string>();
    const visited = new Set<string>();

    const queue = [typeKey];
    while (queue.length) {
        const fqn = queue.shift();
        if (fqn === undefined) break;
        if (visited.has(fqn)) continue;
        visited.add(fqn);

        const type = index.types[fqn];
        if (type) {
            for (const method of type.methods || []) {
                const signature = `${method.name}(${method.params.join(',')})`;
                if (seenMethods.has(signature)) continue;
                seenMethods.add(signature);
                methods.push({ ...method, declaringType: fqn });
            }
            for (const field of type.fields || []) {
                if (seenFields.has(field.name)) continue;
                seenFields.add(field.name);
                fields.push({ ...field, declaringType: fqn });
            }
        }

        for (const parent of index.edges[fqn] || []) {
            if (!visited.has(parent)) queue.push(parent);
        }
    }

    const result: MemberTable = { methods, fields };
    flatCache.set(typeKey, result);
    return result;
}

/** Members of an array type: `length` plus the Object methods it still has. */
function arrayMembers(typeKey: string, baseline: number): MemberLookup {
    const object = flattened('java.lang.Object');
    return {
        typeKey,
        resolved: true,
        kind: 'array',
        methods: [
            { name: 'clone', params: [], returns: typeKey, static: false, since: 8, declaringType: typeKey },
            ...object.methods.filter(m => m.since <= baseline),
        ],
        fields: [{ name: 'length', type: 'int', static: false, since: 8, declaringType: typeKey }],
        ambiguous: false,
    };
}

function unresolved(typeKey: string | null, reason: string): MemberLookup {
    return { typeKey, resolved: false, reason, methods: [], fields: [], ambiguous: false };
}

/**
 * Members a value of `rawTypeKey` offers.
 * `rawTypeKey` is a declared class or a short name.
 */
export function getMembers(
    rawTypeKey: string | null | undefined,
    options: MemberOptions = {}
): MemberLookup {
    const baseline = options.baseline === undefined ? loadIndex().baseline : options.baseline;
    const includeStatics = !!options.includeStatics;
    const ambiguity = ambiguityOf(rawTypeKey);

    const key = normalizeTypeKey(rawTypeKey);
    if (!key) return unresolved(null, 'no-type');

    if (key.endsWith('[]')) {
        return { ...arrayMembers(key, baseline), ambiguous: !!ambiguity, ambiguity };
    }

    const index = loadIndex();
    if (!index.types[key]) {
        return { ...unresolved(key, 'unknown-type'), ambiguous: !!ambiguity, ambiguity };
    }

    const flat = flattened(key);
    // Copy on the way out: the flattened table is shared, callers must not be
    // able to mutate it (and completion items do get decorated by callers).
    const keep = (member: FlattenedMethod | FlattenedField): boolean =>
        member.since <= baseline && (includeStatics || !member.static);
    const copy = <T extends object>(member: T): T => ({ ...member });

    return {
        typeKey: key,
        resolved: true,
        kind: index.types[key].kind || 'class',
        methods: flat.methods.filter(keep).map(copy),
        fields: flat.fields.filter(keep).map(copy),
        ambiguous: !!ambiguity,
        ambiguity,
    };
}

/** Diagnostics for the Output channel and for tests. */
export function stats(): MemberStats {
    const index = loadIndex();
    const typeCount = Object.keys(index.types).length;
    let memberCount = 0;
    for (const type of Object.values(index.types)) {
        memberCount += (type.methods || []).length + (type.fields || []).length;
    }
    return {
        types: typeCount,
        members: memberCount,
        baseline: index.baseline,
        generatedWith: index.generatedWith,
        usingFallback: index.usingFallback,
    };
}
