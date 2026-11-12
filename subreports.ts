// subreports.ts
// Finds the subreport expressions in a JRXML report and turns their string
// literals into candidate source paths.
//
// JasperReports resolves a subreport at fill time, so a wrong path or a typo in
// the parameter map fails late (or silently). The editor resolves the literal
// against the report directory and the workspace roots instead; dynamic
// expressions (`$P{SUBREPORT_DIR} + "detail.jrxml"`) are reported as such and
// never guessed at.

import * as path from 'path';
import { scanXml } from './xmlspan';
import type { XmlNode, XmlScanResult } from './xmlspan';

/** A subreport parameter name and its value span. */
export interface SubreportMapping {
    name: string;
    offset: number;
    length: number;
}

/** A subreport expression and the source path its literal resolves to. */
export interface SubreportLink {
    kind: 'classic' | 'element';
    path: string | null;
    dynamic: boolean;
    offset: number;
    length: number;
    mappings: SubreportMapping[];
}

/** The parts of a string literal the caller needs to build an edit. */
export interface StringLiteral {
    value: string;
    index: number;
    rawLength: number;
}

export function findSubreportLinks(text: string, providedScan: XmlScanResult | null = null): SubreportLink[] {
    const scan = providedScan || scanXml(text);
    if (scan.error || !scan.doc) return [];

    const links: SubreportLink[] = [];
    for (const node of scan.doc.walk()) {
        if (node.tag === 'subreportExpression') {
            const host = node.ancestors().find(ancestor => ancestor.tag === 'subreport');
            const link = buildLink(node, 'classic', host ? classicMappings(host) : []);
            if (link) links.push(link);
        } else if (node.tag === 'expression' && isSubreportElement(node.parent)) {
            const link = buildLink(node, 'element', elementMappings(node.parent));
            if (link) links.push(link);
        }
    }

    return links;
}

function buildLink(
    node: XmlNode,
    kind: SubreportLink['kind'],
    mappings: SubreportMapping[]
): SubreportLink | null {
    const first = node.textNodes[0];
    if (!first) return null;

    const raw = node.textContent();
    const literal = parseStringLiteral(raw);
    if (!literal) {
        return {
            kind, path: null, dynamic: true,
            offset: node.startTag, length: 0,
            mappings,
        };
    }

    return {
        kind,
        path: literal.value,
        dynamic: false,
        offset: first.start + literal.index,
        length: literal.rawLength,
        mappings,
    };
}

/** A whole expression that is one double-quoted Java string literal. */
export function parseStringLiteral(raw: string): StringLiteral | null {
    const match = /^\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(raw);
    if (!match) return null;

    return {
        value: unescapeJava(match[1]),
        index: raw.indexOf('"') + 1,
        rawLength: match[1].length,
    };
}

function unescapeJava(value: string): string {
    return value.replace(/\\(["\\])/g, '$1');
}

function isSubreportElement(node: XmlNode | null | undefined): node is XmlNode {
    return !!node && node.tag === 'element' && node.attrValue('kind') === 'subreport';
}

function classicMappings(host: XmlNode): SubreportMapping[] {
    return host.children
        .filter(child => child.tag === 'subreportParameter')
        .map(mappingOf)
        .filter((mapping): mapping is SubreportMapping => mapping !== null);
}

function elementMappings(host: XmlNode): SubreportMapping[] {
    return host.children
        .filter(child => child.tag === 'parameter')
        .map(mappingOf)
        .filter((mapping): mapping is SubreportMapping => mapping !== null);
}

function mappingOf(node: XmlNode): SubreportMapping | null {
    const attr = node.attr('name');
    if (!attr || !attr.value) return null;
    return { name: attr.value, offset: attr.valueStart, length: attr.value.length };
}

/**
 * Candidate source files for a subreport expression, in priority order:
 * report directory first (for relative paths), then each workspace root.
 * A leading slash is classpath/workspace-relative, never filesystem-absolute.
 */
export function resolveSubreportCandidates(
    reportFsPath: string,
    value: string,
    workspaceRoots: readonly string[] = []
): string[] {
    if (typeof value !== 'string' || !value.trim()) return [];

    const normalized = value.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) return [];

    const absolute = normalized.startsWith('/');
    const relative = normalized.replace(/^\/+/, '');
    if (!relative) return [];

    const roots = absolute
        ? workspaceRoots
        : [path.dirname(reportFsPath), ...workspaceRoots];

    const candidates: string[] = [];
    for (const root of roots) {
        for (const candidate of withSourceExtension(path.resolve(root, relative))) {
            if (!candidates.includes(candidate)) candidates.push(candidate);
        }
    }
    return candidates;
}

/** A .jasper build artifact maps back to its .jrxml source when one exists. */
function withSourceExtension(full: string): string[] {
    const ext = path.extname(full).toLowerCase();
    if (ext === '.jasper') return [full.slice(0, -'.jasper'.length) + '.jrxml', full];
    if (ext === '.jrxml') return [full];
    if (ext) return [full];
    return [full + '.jrxml', full + '.jasper'];
}
