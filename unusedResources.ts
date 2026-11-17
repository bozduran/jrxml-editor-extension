// unusedResources.ts
// Report-local declarations that nothing references: named styles and
// subdatasets, plus the opt-in resource-bundle key summary.
//
// A style is used when any `style` attribute names it (including another
// style's parent); a `default`/`isDefault` style applies implicitly and is
// never reported. A subdataset is used when a `subDataset` attribute names it,
// which is how `<datasetRun>` references one.
//
// Groups and sort fields are deliberately not checked: a group is structural
// (its bands are its use) and a sort field is consumed by the query, so neither
// has a reference that can legitimately be absent.

import type { XmlNode, XmlScanResult } from './xmlspan';
import type { ParseResult } from './jrxmlParser';
import type { BundleIndex } from './resourceBundle';

export interface UnusedResourceFinding {
    offset: number;
    length: number;
    message: string;
    code: string;
}

export interface UnusedResourceInput {
    scan: XmlScanResult;
    parsed: ParseResult;
    /** Resolved resource bundle for the report, when one was found. */
    bundle?: BundleIndex | null;
    /** Report keys the report never references; off by default. */
    includeResourceKeys?: boolean;
}

function localName(tag: string): string {
    const colon = tag.indexOf(':');
    return colon === -1 ? tag : tag.slice(colon + 1);
}

function attributeSpan(node: XmlNode, name: string): { offset: number; length: number } {
    const attr = node.attr(name);
    if (attr) return { offset: attr.valueStart, length: attr.valueEnd - attr.valueStart };
    return { offset: node.startTag + 1, length: localName(node.tag).length };
}

/** Named `<style>` declarations and the names other nodes reference. */
function checkStyles(scan: XmlScanResult): UnusedResourceFinding[] {
    const root = scan.doc?.root;
    if (!root) return [];

    const declared = new Map<string, XmlNode>();
    for (const child of root.children) {
        if (localName(child.tag) !== 'style') continue;
        const name = child.attrValue('name');
        if (name) declared.set(name, child);
    }
    if (declared.size === 0) return [];

    const used = new Set<string>();
    for (const node of root.walk()) {
        const style = node.attrValue('style');
        if (style) used.add(style);
    }

    const findings: UnusedResourceFinding[] = [];
    for (const [name, node] of declared) {
        if (used.has(name)) continue;
        if (node.attrValue('default') === 'true' || node.attrValue('isDefault') === 'true') continue;

        const span = attributeSpan(node, 'name');
        findings.push({
            offset: span.offset,
            length: span.length,
            message: `Style '${name}' is declared but never referenced.`,
            code: 'jrxml.unusedStyle',
        });
    }
    return findings;
}

/** Report-level `<subDataset>` declarations nothing runs. */
function checkSubDatasets(scan: XmlScanResult): UnusedResourceFinding[] {
    const root = scan.doc?.root;
    if (!root) return [];

    const declared = new Map<string, XmlNode>();
    for (const child of root.children) {
        if (localName(child.tag) !== 'subDataset') continue;
        const name = child.attrValue('name');
        if (name) declared.set(name, child);
    }
    if (declared.size === 0) return [];

    const used = new Set<string>();
    for (const node of root.walk()) {
        const subDataset = node.attrValue('subDataset');
        if (subDataset) used.add(subDataset);
    }

    const findings: UnusedResourceFinding[] = [];
    for (const [name, node] of declared) {
        if (used.has(name)) continue;

        const span = attributeSpan(node, 'name');
        findings.push({
            offset: span.offset,
            length: span.length,
            message: `Subdataset '${name}' is declared but no datasetRun uses it.`,
            code: 'jrxml.unusedSubDataset',
        });
    }
    return findings;
}

/**
 * A single summary anchored at the resourceBundle attribute. Keys live in a
 * .properties file, not in this document, and bundles are often shared between
 * reports, which is why this check is opt-in.
 */
function checkResourceKeys(
    parsed: ParseResult,
    bundle: BundleIndex | null | undefined
): UnusedResourceFinding[] {
    const attribute = parsed.resourceBundle;
    if (!attribute || !bundle || bundle.entries.size === 0) return [];

    const used = new Set((parsed.resourceReferences || []).map(reference => reference.name));
    const unused = [...bundle.entries.keys()].filter(key => !used.has(key)).sort();
    if (unused.length === 0) return [];

    const shown = unused.slice(0, 5).join(', ');
    const suffix = unused.length > 5 ? `, … (${unused.length} in total)` : '';
    return [{
        offset: attribute.offset,
        length: attribute.length,
        message: `Resource bundle '${bundle.name}' defines keys this report never uses: ${shown}${suffix}.`,
        code: 'jrxml.unusedResourceKey',
    }];
}

/** Every unused-resource finding for one report. */
export function checkUnusedResources(input: UnusedResourceInput): UnusedResourceFinding[] {
    const { scan, parsed } = input;
    if (!scan || scan.error || !scan.doc) return [];

    const findings: UnusedResourceFinding[] = [
        ...checkStyles(scan),
        ...checkSubDatasets(scan),
    ];

    if (input.includeResourceKeys) {
        findings.push(...checkResourceKeys(parsed, input.bundle));
    }

    findings.sort((a, b) => a.offset - b.offset || a.code.localeCompare(b.code));
    return findings;
}
