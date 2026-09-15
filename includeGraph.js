// includeGraph.js
// The include-chain graph for .jrxml files: which report calls which, by base
// name, and the top-down chain that leads to a given report.
//
// Pure and vscode-free. Callers pass `{ path, text }` records (paths already
// workspace-relative with forward slashes) and get plain node objects back.
//
// A file *calls* another when it contains a double-quoted token equal to that
// file's base name — the hook's own rule. Self-references are ignored, and when
// several files share a base name every one of them is a target, so a report is
// never silently invisible just because its name is duplicated.

const QUOTED = /"([^"]*)"/g;

function normalizePath(value) {
    return String(value).replace(/\\/g, '/');
}

/** File name without its extension. */
function baseName(filePath) {
    const name = normalizePath(filePath).split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

/** Every double-quoted token in a document. */
function quotedTokens(text) {
    const tokens = new Set();
    QUOTED.lastIndex = 0;

    let match;
    while ((match = QUOTED.exec(text)) !== null) {
        if (match[1]) tokens.add(match[1]);
    }
    return tokens;
}

/**
 * Build the call graph.
 * @param {{path:string, text:string}[]} files
 */
function buildIndex(files) {
    const base   = new Map();
    const tokens = new Map();
    const byBase = new Map();

    for (const file of files) {
        const path = normalizePath(file.path);
        const name = baseName(path);

        base.set(path, name);
        tokens.set(path, quotedTokens(file.text));

        if (!byBase.has(name)) byBase.set(name, []);
        byBase.get(name).push(path);
    }

    const callees = new Map();
    const callers = new Map();

    for (const path of base.keys()) {
        const targets = new Set();

        for (const token of tokens.get(path)) {
            for (const candidate of (byBase.get(token) || [])) {
                if (candidate !== path) targets.add(candidate); // self-references ignored
            }
        }

        callees.set(path, targets);
        for (const target of targets) {
            if (!callers.has(target)) callers.set(target, new Set());
            callers.get(target).add(path);
        }
    }

    return { paths: [...base.keys()].sort(), base, tokens, byBase, callees, callers };
}

/** Every file that calls `target`, directly or transitively. */
function referencersOf(index, target) {
    const seen  = new Set([target]);
    const queue = [target];

    while (queue.length > 0) {
        const current = queue.shift();
        for (const caller of (index.callers.get(current) || [])) {
            if (!seen.has(caller)) {
                seen.add(caller);
                queue.push(caller);
            }
        }
    }

    seen.delete(target);
    return seen;
}

/** `referencersOf(target)` plus the target itself. */
function affectedFiles(index, target) {
    const affected = referencersOf(index, target);
    affected.add(target);
    return affected;
}

/**
 * Top templates for `target`: the affected files that nothing calls. When every
 * affected file has a caller (a cycle), the target is its own top.
 */
function topsFor(index, target) {
    const tops = [...affectedFiles(index, target)]
        .filter(path => (index.callers.get(path) || new Set()).size === 0)
        .sort();

    return tops.length > 0 ? tops : [target];
}

/**
 * Downward tree from every top, pruned to the branches that reach `target`.
 * Cycles are cut and children are sorted by path.
 *
 * @returns {{ path:string, current:boolean, children:object[] }[]}
 */
function buildTree(index, target) {
    if (!index.base.has(target)) return [];

    const above = affectedFiles(index, target);
    return topsFor(index, target).map(top => buildNode(index, top, target, above, new Set()));
}

function buildNode(index, path, target, above, ancestors) {
    const node = { path, current: path === target, children: [] };
    if (path === target) return node;

    const next = new Set(ancestors);
    next.add(path);

    const children = [...(index.callees.get(path) || [])]
        .filter(child => above.has(child) && !next.has(child))
        .sort();

    node.children = children.map(child => buildNode(index, child, target, above, next));
    return node;
}

module.exports = {
    buildIndex,
    buildTree,
    referencersOf,
    affectedFiles,
    topsFor,
    baseName,
    quotedTokens,
    normalizePath,
};
