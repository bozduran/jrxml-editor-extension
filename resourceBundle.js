// resourceBundle.js
// Locates and indexes the .properties files behind a report's
// `resourceBundle` attribute.
//
// JasperReports resolves the base name on the classpath (`i18n.messages` →
// `i18n/messages.properties`), while Studio projects often keep a flat
// `messages.properties` next to the report. Both layouts are tried, the report
// directory first, then the workspace roots. Locale variants are merged under
// the base key; the default file supplies the value shown in hover.

const fs   = require('fs');
const path = require('path');
const { scanXml } = require('./xmlspan');
const { parseProperties } = require('./properties');

const cache = new Map();

/**
 * The report's `resourceBundle` attribute.
 * @returns {{name:string, offset:number, length:number}|null}
 */
function bundleAttribute(text) {
    return bundleAttributeOfScan(scanXml(text));
}

/** The same from an existing scan, so callers that parsed the document do not scan twice. */
function bundleAttributeOfScan(scan) {
    if (!scan || scan.error || !scan.doc || scan.doc.root.tag !== 'jasperReport') return null;

    const attr = scan.doc.root.attr('resourceBundle');
    if (!attr || !attr.value.trim()) return null;

    return { name: attr.value.trim(), offset: attr.valueStart, length: attr.value.length };
}

/** Candidate base paths for a bundle name: dotted and flat layouts. */
function candidateBases(bundleName) {
    const slashed = bundleName.replace(/\./g, '/');
    return slashed === bundleName ? [bundleName] : [slashed, bundleName];
}

function localeOf(stem, fileName) {
    if (fileName === `${stem}.properties`) return '';
    return fileName.slice(stem.length + 1, -'.properties'.length);
}

/**
 * All .properties files for a bundle, base file first. The first root that
 * yields any match wins, so a report-local bundle shadows a workspace one.
 */
function findBundleFiles(reportFsPath, bundleName, workspaceRoots = []) {
    const reportDir = path.dirname(reportFsPath);
    const roots = [reportDir, ...workspaceRoots.filter(root => root !== reportDir)];

    for (const root of roots) {
        for (const base of candidateBases(bundleName)) {
            const full  = path.resolve(root, base);
            const dir   = path.dirname(full);
            const stem  = path.basename(full);

            let names;
            try {
                names = fs.readdirSync(dir);
            } catch (_) {
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

/**
 * @typedef {{value:string,file:string,locale:string,line:number,character:number}} LocatedValue
 * @typedef {{key:string, defaultValue:string|null, defaultFile:string|null,
 *            defaultPosition:LocatedValue|null, locales:Map<string,LocatedValue>}} BundleEntry
 */

/** Index every key, keeping the last value per file (java.util.Properties). */
function buildIndex(bundleName, files) {
    const entries = new Map();

    for (const file of files) {
        let text;
        try {
            text = fs.readFileSync(file.path, 'utf8');
        } catch (_) {
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

            const located = {
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
function signatureOf(files) {
    return files.map(file => {
        try {
            const stat = fs.statSync(file.path);
            return `${file.path}:${stat.mtimeMs}:${stat.size}`;
        } catch (_) {
            return `${file.path}:missing`;
        }
    }).join('|');
}

/**
 * Load (or reuse) the bundle index for a report.
 * @param {string} reportFsPath
 * @param {string} bundleName
 * @param {string[]} [workspaceRoots]
 * @returns {{name:string, files:{path:string,locale:string}[], entries:Map<string,BundleEntry>}|null}
 */
function loadResourceBundle(reportFsPath, bundleName, workspaceRoots = []) {
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
function clearResourceBundleCache() {
    cache.clear();
}

module.exports = {
    bundleAttribute,
    bundleAttributeOfScan,
    loadResourceBundle,
    findBundleFiles,
    clearResourceBundleCache,
};
