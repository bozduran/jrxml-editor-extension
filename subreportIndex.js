// subreportIndex.js
// Resolves the subreport links of a master report to real files and, when the
// target is a .jrxml source, to that report's declared parameters.
//
// Target parameter lists are cached by path + mtime: diagnostics re-run on
// every edit, but the targets rarely change.

const fs   = require('fs');
const { findSubreportLinks, resolveSubreportCandidates } = require('./subreports');
const { parseDeclarations } = require('./jrxmlParser');

const parameterCache = new Map();

/**
 * Every subreport link with `target` (absolute path or null) and
 * `targetParameters` (Map name -> declaration, or null when unknown).
 *
 * @param {{fileName?:string,getText:()=>string}} document
 * @param {string[]} [workspaceRoots]
 */
function analyseSubreports(document, workspaceRoots = []) {
    if (!document || typeof document.fileName !== 'string' || !document.fileName) return [];

    return findSubreportLinks(document.getText()).map(link => {
        if (link.dynamic || !link.path) {
            return { ...link, target: null, targetParameters: null };
        }

        const candidates = resolveSubreportCandidates(document.fileName, link.path, workspaceRoots);
        const target = candidates.find(isFile) || null;
        return {
            ...link,
            target,
            targetParameters: target ? parametersOf(target) : null,
        };
    });
}

function isFile(candidate) {
    try {
        return fs.statSync(candidate).isFile();
    } catch (_) {
        return false;
    }
}

/** Declared parameters of a .jrxml target, cached by mtime + size. */
function parametersOf(fsPath) {
    if (!fsPath.toLowerCase().endsWith('.jrxml')) return null;

    let stat;
    try {
        stat = fs.statSync(fsPath);
    } catch (_) {
        return null;
    }

    const cached = parameterCache.get(fsPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.parameters;
    }

    let text;
    try {
        text = fs.readFileSync(fsPath, 'utf8');
    } catch (_) {
        return null;
    }

    // Reuse the real declaration parser. The synthetic version (mtime) makes
    // its document cache agree with the file cache above.
    const parsed = parseDeclarations({
        uri: { toString: () => `jrxml-subreport://${fsPath}` },
        version: stat.mtimeMs,
        getText: () => text,
    });

    const parameters = new Map(parsed.parameters.map(parameter => [parameter.name, parameter]));
    parameterCache.set(fsPath, { mtimeMs: stat.mtimeMs, size: stat.size, parameters });
    return parameters;
}

/** Drop every cached target parameter list (for tests and workspace changes). */
function clearSubreportCache() {
    parameterCache.clear();
}

module.exports = { analyseSubreports, clearSubreportCache };
