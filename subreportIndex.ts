// subreportIndex.ts
// Resolves the subreport links of a master report to real files and, when the
// target is a .jrxml source, to that report's declared parameters.
//
// Target parameter lists are cached by path + mtime: diagnostics re-run on
// every edit, but the targets rarely change.

import * as fs from 'fs';
import { findSubreportLinks, resolveSubreportCandidates } from './subreports';
import type { SubreportLink } from './subreports';
import { parseReport } from './jrxmlParser';
import type { Declaration } from './jrxmlParser';
import { textSource } from './reportSource';
import type { XmlScanResult } from './xmlspan';

/** The slice of a report document subreport resolution needs. */
export interface SubreportDocument {
    fileName?: string;
    getText(): string;
}

/** A subreport link with its resolved target and parameter declarations. */
export interface AnalysedSubreport extends SubreportLink {
    target: string | null;
    targetParameters: Map<string, Declaration> | null;
}

interface ParameterCacheEntry {
    mtimeMs: number;
    size: number;
    parameters: Map<string, Declaration>;
}

const parameterCache = new Map<string, ParameterCacheEntry>();

/**
 * Every subreport link with `target` (absolute path or null) and
 * `targetParameters` (Map name -> declaration, or null when unknown).
 */
function analyseSubreports(
    document: SubreportDocument | null | undefined,
    workspaceRoots: readonly string[] = [],
    providedScan: XmlScanResult | null = null
): AnalysedSubreport[] {
    if (!document || typeof document.fileName !== 'string' || !document.fileName) return [];

    const fileName = document.fileName;
    return findSubreportLinks(document.getText(), providedScan).map((link): AnalysedSubreport => {
        if (link.dynamic || !link.path) {
            return { ...link, target: null, targetParameters: null };
        }

        const candidates = resolveSubreportCandidates(fileName, link.path, workspaceRoots);
        const target = candidates.find(isFile) || null;
        return {
            ...link,
            target,
            targetParameters: target ? parametersOf(target) : null,
        };
    });
}

function isFile(candidate: string): boolean {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

/** Declared parameters of a .jrxml target, cached by mtime + size. */
function parametersOf(fsPath: string): Map<string, Declaration> | null {
    if (!fsPath.toLowerCase().endsWith('.jrxml')) return null;

    let stat: fs.Stats;
    try {
        stat = fs.statSync(fsPath);
    } catch {
        return null;
    }

    const cached = parameterCache.get(fsPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.parameters;
    }

    let text: string;
    try {
        text = fs.readFileSync(fsPath, 'utf8');
    } catch {
        return null;
    }

    // Reuse the real declaration parser. The synthetic version (mtime) makes
    // its document cache agree with the file cache above.
    const parsed = parseReport(
        textSource(text, `jrxml-subreport://${fsPath}`, stat.mtimeMs)
    );

    const parameters = new Map(parsed.parameters.map(
        (parameter): [string, Declaration] => [parameter.name, parameter]
    ));
    parameterCache.set(fsPath, { mtimeMs: stat.mtimeMs, size: stat.size, parameters });
    return parameters;
}

/** Drop every cached target parameter list (for tests and workspace changes). */
function clearSubreportCache(): void {
    parameterCache.clear();
}

export { analyseSubreports, clearSubreportCache };
