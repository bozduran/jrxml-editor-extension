// subreports.js
// Finds the subreport expressions in a JRXML report and turns their string
// literals into candidate source paths.
//
// JasperReports resolves a subreport at fill time, so a wrong path or a typo in
// the parameter map fails late (or silently). The editor resolves the literal
// against the report directory and the workspace roots instead; dynamic
// expressions (`$P{SUBREPORT_DIR} + "detail.jrxml"`) are reported as such and
// never guessed at.

const path = require('path');
const { scanXml } = require('./xmlspan');

/**
 * @param {string} text JRXML document
 * @returns {{kind:'classic'|'element', path:string|null, dynamic:boolean,
 *            offset:number, length:number,
 *            mappings:{name:string,offset:number,length:number}[]}[]}
 */
function findSubreportLinks(text) {
    const scan = scanXml(text);
    if (scan.error) return [];

    const links = [];
    for (const node of scan.doc.walk()) {
        if (node.tag === 'subreportExpression') {
            const host = node.ancestors().find(ancestor => ancestor.tag === 'subreport');
            links.push(buildLink(node, 'classic', host ? classicMappings(host) : []));
        } else if (node.tag === 'expression' && isSubreportElement(node.parent)) {
            links.push(buildLink(node, 'element', elementMappings(node.parent)));
        }
    }

    return links.filter(Boolean);
}

function buildLink(node, kind, mappings) {
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
function parseStringLiteral(raw) {
    const match = /^\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(raw);
    if (!match) return null;

    return {
        value: unescapeJava(match[1]),
        index: raw.indexOf('"') + 1,
        rawLength: match[1].length,
    };
}

function unescapeJava(value) {
    return value.replace(/\\(["\\])/g, '$1');
}

function isSubreportElement(node) {
    return !!node && node.tag === 'element' && node.attrValue('kind') === 'subreport';
}

function classicMappings(host) {
    return host.children
        .filter(child => child.tag === 'subreportParameter')
        .map(mappingOf)
        .filter(Boolean);
}

function elementMappings(host) {
    return host.children
        .filter(child => child.tag === 'parameter')
        .map(mappingOf)
        .filter(Boolean);
}

function mappingOf(node) {
    const attr = node.attr('name');
    if (!attr || !attr.value) return null;
    return { name: attr.value, offset: attr.valueStart, length: attr.value.length };
}

/**
 * Candidate source files for a subreport expression, in priority order:
 * report directory first (for relative paths), then each workspace root.
 * A leading slash is classpath/workspace-relative, never filesystem-absolute.
 *
 * @param {string} reportFsPath
 * @param {string} value literal from the expression
 * @param {string[]} [workspaceRoots]
 * @returns {string[]}
 */
function resolveSubreportCandidates(reportFsPath, value, workspaceRoots = []) {
    if (typeof value !== 'string' || !value.trim()) return [];

    const normalized = value.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) return [];

    const absolute = normalized.startsWith('/');
    const relative = normalized.replace(/^\/+/, '');
    if (!relative) return [];

    const roots = absolute
        ? workspaceRoots
        : [path.dirname(reportFsPath), ...workspaceRoots];

    const candidates = [];
    for (const root of roots) {
        for (const candidate of withSourceExtension(path.resolve(root, relative))) {
            if (!candidates.includes(candidate)) candidates.push(candidate);
        }
    }
    return candidates;
}

/** A .jasper build artifact maps back to its .jrxml source when one exists. */
function withSourceExtension(full) {
    const ext = path.extname(full).toLowerCase();
    if (ext === '.jasper') return [full.slice(0, -'.jasper'.length) + '.jrxml', full];
    if (ext === '.jrxml') return [full];
    if (ext) return [full];
    return [full + '.jrxml', full + '.jasper'];
}

module.exports = {
    findSubreportLinks,
    resolveSubreportCandidates,
    parseStringLiteral,
};
