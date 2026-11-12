// resourceBundle.ts
// Locates and indexes the .properties files behind a report's
// `resourceBundle` attribute.
//
// JasperReports resolves the base name on the classpath (`i18n.messages` →
// `i18n/messages.properties`), while Studio projects often keep a flat
// `messages.properties` next to the report. Both layouts are tried, the report
// directory first, then the workspace roots. Locale variants are merged under
// the base key; the default file supplies the value shown in hover.

import * as fs from 'fs';
import * as path from 'path';
import { scanXml } from './xmlspan';
import type { XmlScanResult } from './xmlspan';
import { parseProperties } from './properties';

/** A bundle attribute name and its value span. */
export interface BundleAttribute {
    name: string;
    offset: number;
    length: number;
}

/** One .properties file backing a bundle. */
export interface BundleFile {
    path: string;
    locale: string;
}

/** A key's value in one file, with the position the editor can reveal. */
export interface LocatedValue {
    value: string;
    file: string;
    locale: string;
    line: number;
    character: number;
}

/** Every key in a bundle: default value plus the locale variants. */
export interface BundleEntry {
    key: string;
    defaultValue: string | null;
    defaultFile: string | null;
    defaultPosition: LocatedValue | null;
    locales: Map<string, LocatedValue>;
}

/** The bundle index the completion, hover and diagnostics share. */
export interface BundleIndex {
    name: string;
    files: BundleFile[];
    entries: Map<string, BundleEntry>;
}

interface CacheEntry {
    signature: string;
    index: BundleIndex;
}

const cache = new Map<string, CacheEntry>();

/** The report's `resourceBundle` attribute. */
export function bundleAttribute(text: string): BundleAttribute | null {
    return bundleAttributeOfScan(scanXml(text));
}

/** The same from an existing scan, so callers that parsed the document do not scan twice. */
export function bundleAttributeOfScan(scan: XmlScanResult | null): BundleAttribute | null {
    if (!scan || scan.error || !scan.doc || scan.doc.root.tag !== 'jasperReport') return null;

    const attr = scan.doc.root.attr('resourceBundle');
    if (!attr || !attr.value.trim()) return null;

    return { name: attr.value.trim(), offset: attr.valueStart, length: attr.value.length };
}

/** Candidate base paths for a bundle name: dotted and flat layouts. */
function candidateBases(bundleName: string): string[] {
    const slashed = bundleName.replace(/\./g, '/');
    return slashed === bundleName ? [bundleName] : [slashed, bundleName];
}

function localeOf(stem: string, fileName: string): string {
    if (fileName === `${stem}.properties`) return '';
    return fileName.slice(stem.length + 1, -'.properties'.length);
}

/**
 * All .properties files for a bundle, base file first. The first root that
 * yields any match wins, so a report-local bundle shadows a workspace one.
 */
export function findBundleFiles(
    reportFsPath: string,
    bundleName: string,
    workspaceRoots: readonly string[] = []
): BundleFile[] {
    const reportDir = path.dirname(reportFsPath);
    const roots = [reportDir, ...workspaceRoots.filter(root => root !== reportDir)];

    for (const root of roots) {
        for (const base of candidateBases(bundleName)) {
            const full  = path.resolve(root, base);
            const dir   = path.dirname(full);
            const stem  = path.basename(full);

            let names: string[];
            try {
                names = fs.readdirSync(dir);
            } catch {
                continue; // directory does not exist — try the next candidate
            }

            const matches = names.filter(name =>
                name === `${stem}.properties` ||
                (name.startsWith(`${stem}_`) && name.endsWith('.properties')));

            if (matches.length === 0) continue;

            return matches
                .map(name => ({
                    path:   path.join(dir, name),
                    locale: localeOf(stem, name),
                }))
                .sort((a, b) => a.locale.localeCompare(b.locale));
        }
    }

    return [];
}

/** Index every key, keeping the last value per file (java.util.Properties). */
function buildIndex(bundleName: string, files: BundleFile[]): BundleIndex {
    const entries = new Map<string, BundleEntry>();

    for (const file of files) {
        let text: string;
        try {
            text = fs.readFileSync(file.path, 'utf8');
        } catch {
            continue; // file vanished between listing and reading
        }

        for (const entry of parseProperties(text)) {
            const record = entries.get(entry.key) || {
                key: entry.key,
                defaultValue: null,
                defaultFile: null,
                defaultPosition: null,
                locales: new Map(),
            };

            const located: LocatedValue = {
                value: entry.value,
                file:  file.path,
                locale: file.locale,
                line: entry.line,
                character: entry.character,
            };

            if (file.locale === '') {
                record.defaultValue    = entry.value;
                record.defaultFile     = file.path;
                record.defaultPosition = located;
            } else {
                record.locales.set(file.locale, located);
            }
            entries.set(entry.key, record);
        }
    }

    return { name: bundleName, files, entries };
}

/** File mtimes + sizes, so an edited bundle is re-indexed on the next access. */
function signatureOf(files: readonly BundleFile[]): string {
    return files.map(file => {
        try {
            const stat = fs.statSync(file.path);
            return `${file.path}:${stat.mtimeMs}:${stat.size}`;
        } catch {
            return `${file.path}:missing`;
        }
    }).join('|');
}

/** Load (or reuse) the bundle index for a report. */
export function loadResourceBundle(
    reportFsPath: string,
    bundleName: string,
    workspaceRoots: readonly string[] = []
): BundleIndex | null {
    if (!reportFsPath || !bundleName) return null;

    const files = findBundleFiles(reportFsPath, bundleName, workspaceRoots);
    if (files.length === 0) return null;

    const key = `${reportFsPath}\0${bundleName}\0${workspaceRoots.join('\0')}`;
    const signature = signatureOf(files);
    const cached = cache.get(key);
    if (cached && cached.signature === signature) return cached.index;

    const index = buildIndex(bundleName, files);
    cache.set(key, { signature, index });
    return index;
}

/** Drop every cached bundle (used when properties files change on disk). */
export function clearResourceBundleCache(): void {
    cache.clear();
}
