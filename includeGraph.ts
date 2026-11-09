// includeGraph.ts
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

export interface ReportFile {
    readonly path: string;
    readonly text: string;
}

export interface IncludeIndex {
    readonly paths: string[];
    readonly base: Map<string, string>;
    readonly tokens: Map<string, Set<string>>;
    readonly byBase: Map<string, string[]>;
    readonly callees: Map<string, Set<string>>;
    readonly callers: Map<string, Set<string>>;
}

export interface IncludeTreeNode {
    path: string;
    current: boolean;
    children: IncludeTreeNode[];
}

const QUOTED = /"([^"]*)"/g;

export function normalizePath(value: string): string {
    return String(value).replace(/\\/g, '/');
}

/** File name without its extension. */
export function baseName(filePath: string): string {
    const name = normalizePath(filePath).split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

/** Every double-quoted token in a document. */
export function quotedTokens(text: string): Set<string> {
    const tokens = new Set<string>();
    QUOTED.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = QUOTED.exec(text)) !== null) {
        if (match[1]) tokens.add(match[1]);
    }
    return tokens;
}

/** Build the call graph. */
export function buildIndex(files: readonly ReportFile[]): IncludeIndex {
    const base   = new Map<string, string>();
    const tokens = new Map<string, Set<string>>();
    const byBase = new Map<string, string[]>();

    for (const file of files) {
        const path = normalizePath(file.path);
        const name = baseName(path);

        base.set(path, name);
        tokens.set(path, quotedTokens(file.text));

        const sameName = byBase.get(name);
        if (sameName) sameName.push(path);
        else byBase.set(name, [path]);
    }

    const callees = new Map<string, Set<string>>();
    const callers = new Map<string, Set<string>>();

    for (const path of base.keys()) {
        const targets = new Set<string>();
        const fileTokens = tokens.get(path);
        if (!fileTokens) continue;

        for (const token of fileTokens) {
            for (const candidate of (byBase.get(token) || [])) {
                if (candidate !== path) targets.add(candidate); // self-references ignored
            }
        }

        callees.set(path, targets);
        for (const target of targets) {
            let targetCallers = callers.get(target);
            if (!targetCallers) {
                targetCallers = new Set();
                callers.set(target, targetCallers);
            }
            targetCallers.add(path);
        }
    }

    return { paths: [...base.keys()].sort(), base, tokens, byBase, callees, callers };
}

/** Every file that calls `target`, directly or transitively. */
export function referencersOf(index: IncludeIndex, target: string): Set<string> {
    const seen  = new Set<string>([target]);
    const queue = [target];

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
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
export function affectedFiles(index: IncludeIndex, target: string): Set<string> {
    const affected = referencersOf(index, target);
    affected.add(target);
    return affected;
}

/**
 * Top templates for `target`: the affected files that nothing calls. When every
 * affected file has a caller (a cycle), the target is its own top.
 */
export function topsFor(index: IncludeIndex, target: string): string[] {
    const tops = [...affectedFiles(index, target)]
        .filter(path => (index.callers.get(path) || new Set()).size === 0)
        .sort();

    return tops.length > 0 ? tops : [target];
}

/**
 * Downward tree from every top, pruned to the branches that reach `target`.
 * Cycles are cut and children are sorted by path.
 */
export function buildTree(index: IncludeIndex, target: string): IncludeTreeNode[] {
    if (!index.base.has(target)) return [];

    const above = affectedFiles(index, target);
    return topsFor(index, target).map(top => buildNode(index, top, target, above, new Set()));
}

function buildNode(
    index: IncludeIndex,
    path: string,
    target: string,
    above: ReadonlySet<string>,
    ancestors: ReadonlySet<string>
): IncludeTreeNode {
    const node: IncludeTreeNode = { path, current: path === target, children: [] };
    if (path === target) return node;

    const next = new Set(ancestors);
    next.add(path);

    const children = [...(index.callees.get(path) || [])]
        .filter(child => above.has(child) && !next.has(child))
        .sort();

    node.children = children.map(child => buildNode(index, child, target, above, next));
    return node;
}
