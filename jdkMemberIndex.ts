// jdkMemberIndex.js
// The member table behind typed completion: what can be called on a value of a
// given declared class.
//
// Data comes from two committed files — data/jdk-members.json (generated from
// javap by tools/gen-jdk-index.js) and data/extra-types.json (hand-curated
// JasperReports engine types) — so nothing here needs a JDK at runtime.
//
// This module deliberately does not require('vscode'): the receiver resolver,
// the completion builder and the tests all work on plain objects.

const fs   = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'data', 'jdk-members.json');
const EXTRA_PATH = path.join(__dirname, 'data', 'extra-types.json');

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
const MINIMAL_TYPES = {
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

let cachedIndex = null;
const flatCache = new Map();

// ── Loading ───────────────────────────────────────────────────────────────────

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null; // missing/corrupt data must never break completion
    }
}

/** Preference order for short-name collisions, most specific package first. */
function compareFqn(a, b) {
    const rank = (fqn) => {
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
function buildIndex(jdk, extra) {
    if (!jdk || !jdk.types) {
        return { types: MINIMAL_TYPES, edges: {}, baseline: 8, usingFallback: true, ambiguous: new Map(), bySimpleName: new Map() };
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

    const ambiguous = new Map();
    const bySimpleName = new Map();
    for (const fqn of Object.keys(types)) {
        const simple = fqn.split('.').pop();
        if (!bySimpleName.has(simple)) bySimpleName.set(simple, []);
        bySimpleName.get(simple).push(fqn);
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
function loadIndex() {
    if (!cachedIndex) cachedIndex = buildIndex(readJson(INDEX_PATH), readJson(EXTRA_PATH));
    return cachedIndex;
}

/** Drop every cache (tests, and any future index reload). */
function clearCache() {
    cachedIndex = null;
    flatCache.clear();
}

// ── Type keys ─────────────────────────────────────────────────────────────────

/** Remove generic arguments: `java.util.List<java.lang.String>` → `java.util.List`. */
function stripGenerics(text) {
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
function normalizeTypeKey(raw) {
    if (raw === null || raw === undefined) return null;

    let key = stripGenerics(String(raw).trim()).replace(/\.\.\.$/, '[]');
    if (!key) return null;
    if (PRIMITIVES.has(key) || key.endsWith('[]')) return key;

    const index = loadIndex();
    if (index.types[key]) return key;

    const candidates = index.bySimpleName.get(key);
    if (candidates && candidates.length) return candidates[0];

    return key; // unknown, but the caller can still report what was asked for
}

/** True when the key names a type this index can list members for. */
function isIndexed(rawTypeKey) {
    const key = normalizeTypeKey(rawTypeKey);
    if (!key) return false;
    if (key.endsWith('[]')) return true;
    return !!loadIndex().types[key];
}

/** `{ candidates: [...] }` when a short name is ambiguous, else null. */
function ambiguityOf(rawTypeKey) {
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
function flattened(typeKey) {
    const index = loadIndex();
    if (flatCache.has(typeKey)) return flatCache.get(typeKey);

    const methods = [];
    const fields = [];
    const seenMethods = new Set();
    const seenFields = new Set();
    const visited = new Set();

    const queue = [typeKey];
    while (queue.length) {
        const fqn = queue.shift();
        if (visited.has(fqn)) continue;
        visited.add(fqn);

        const type = index.types[fqn];
        if (type) {
            for (const method of type.methods) {
                const signature = `${method.name}(${method.params.join(',')})`;
                if (seenMethods.has(signature)) continue;
                seenMethods.add(signature);
                methods.push({ ...method, declaringType: fqn });
            }
            for (const field of type.fields) {
                if (seenFields.has(field.name)) continue;
                seenFields.add(field.name);
                fields.push({ ...field, declaringType: fqn });
            }
        }

        for (const parent of index.edges[fqn] || []) {
            if (!visited.has(parent)) queue.push(parent);
        }
    }

    const result = { methods, fields };
    flatCache.set(typeKey, result);
    return result;
}

/** Members of an array type: `length` plus the Object methods it still has. */
function arrayMembers(typeKey, baseline) {
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

function unresolved(typeKey, reason) {
    return { typeKey, resolved: false, reason, methods: [], fields: [], ambiguous: false };
}

/**
 * Members a value of `rawTypeKey` offers.
 *
 * @param {string} rawTypeKey  declared class or a short name
 * @param {{ baseline?: number, includeStatics?: boolean }} [options]
 * @returns {{ typeKey: string|null, resolved: boolean, reason?: string,
 *             kind?: string, methods: object[], fields: object[], ambiguous: boolean }}
 */
function getMembers(rawTypeKey, options = {}) {
    const baseline = options.baseline === undefined ? loadIndex().baseline : options.baseline;
    const includeStatics = !!options.includeStatics;
    const ambiguity = ambiguityOf(rawTypeKey);

    const key = normalizeTypeKey(rawTypeKey);
    if (!key) return unresolved(null, 'no-type');

    if (key.endsWith('[]')) return { ...arrayMembers(key, baseline), ambiguous: !!ambiguity, ambiguity };

    const index = loadIndex();
    if (!index.types[key]) return { ...unresolved(key, 'unknown-type'), ambiguous: !!ambiguity, ambiguity };

    const flat = flattened(key);
    // Copy on the way out: the flattened table is shared, callers must not be
    // able to mutate it (and completion items do get decorated by callers).
    const keep = (member) => member.since <= baseline && (includeStatics || !member.static);
    const copy = (member) => ({ ...member });

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
function stats() {
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

module.exports = {
    buildIndex,
    getMembers,
    normalizeTypeKey,
    isIndexed,
    ambiguityOf,
    stats,
    clearCache,
    INDEX_PATH,
    EXTRA_PATH,
};
