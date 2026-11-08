#!/usr/bin/env node
// CI gate for JRXML files: runs the same analysis as the editor over every
// **/*.jrxml and exits non-zero when there is an error.
//
// Usage:
//   node tools/validate-workspace.js [--json] [path ...]
//
// With no path it scans the current directory. `--json` prints machine-readable
// results for CI. The exit code is 1 when any error-severity finding exists.
//
// This is a static gate, not a replacement for the JasperReports compiler:
// keep the project's Maven/Ant compile + verifyDesign step as the authoritative
// build gate.

const fs   = require('fs');
const path = require('path');
const { collectFindings } = require('../diagnostics');

const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', 'out', 'target', 'bin', 'dist',
    '.vscode-test', '.dsh', 'coverage',
]);

/** Recursively collect .jrxml files under a file or directory. */
function collectFiles(target) {
    let stat;
    try {
        stat = fs.statSync(target);
    } catch (_) {
        return [];
    }

    if (stat.isFile()) {
        return target.toLowerCase().endsWith('.jrxml') ? [path.resolve(target)] : [];
    }
    if (!stat.isDirectory()) return [];

    const files = [];
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const full = path.join(target, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) continue;
            files.push(...collectFiles(full));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jrxml')) {
            files.push(path.resolve(full));
        }
    }
    return files;
}

/** Analyse every file, keeping the text for line/column reporting. */
function validateFiles(files, workspaceRoots = []) {
    return files.map(file => {
        const text = fs.readFileSync(file, 'utf8');
        return {
            file,
            text,
            findings: collectFindings({ text, fileName: file, workspaceRoots }),
        };
    });
}

function summarise(results) {
    let errors = 0;
    let warnings = 0;

    for (const result of results) {
        for (const finding of result.findings) {
            if (finding.severity === 'error') errors++;
            else warnings++;
        }
    }

    return { files: results.length, errors, warnings };
}

function positionOf(text, offset) {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length, column: before[before.length - 1].length + 1 };
}

function formatText(results) {
    const lines = [];

    for (const result of results) {
        for (const finding of result.findings) {
            const position = positionOf(result.text, finding.offset);
            lines.push(
                `${result.file}:${position.line}:${position.column} `
                + `${finding.severity} ${finding.message} [${finding.code}]`
            );
        }
    }

    const totals = summarise(results);
    lines.push(`${totals.files} file(s), ${totals.errors} error(s), ${totals.warnings} warning(s)`);
    return lines.join('\n');
}

function formatJson(results) {
    return JSON.stringify({
        files: results.map(result => ({
            file: result.file,
            findings: result.findings.map(finding => ({
                ...finding,
                ...positionOf(result.text, finding.offset),
            })),
        })),
        summary: summarise(results),
    }, null, 2);
}

/** Run the CLI; returns the process exit code. */
function main(argv = process.argv.slice(2)) {
    const json = argv.includes('--json');
    const paths = argv.filter(argument => !argument.startsWith('--'));
    const targets = paths.length > 0 ? paths : [process.cwd()];
    const roots = targets.map(target => path.resolve(target));

    const files = [...new Set(targets.flatMap(target => collectFiles(target)))].sort();
    const results = validateFiles(files, roots);

    console.log(json ? formatJson(results) : formatText(results));
    return summarise(results).errors > 0 ? 1 : 0;
}

if (require.main === module) {
    process.exitCode = main();
}

module.exports = { collectFiles, validateFiles, summarise, formatText, formatJson, main };
