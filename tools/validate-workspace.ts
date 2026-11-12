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

import fs from 'node:fs';
import path from 'node:path';

import { collectFindings } from '../diagnostics';
import type { Finding } from '../diagnostics';
import { EXCLUDED_DIRS } from '../workspaceFiles';

interface ValidationResult {
    file: string;
    text: string;
    findings: Finding[];
}

interface Totals {
    files: number;
    errors: number;
    warnings: number;
}

/** Recursively collect .jrxml files under a file or directory. */
function collectFiles(target: string): string[] {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(target);
    } catch {
        return [];
    }

    if (stat.isFile()) {
        return target.toLowerCase().endsWith('.jrxml') ? [path.resolve(target)] : [];
    }
    if (!stat.isDirectory()) return [];

    const files: string[] = [];
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
function validateFiles(files: readonly string[], workspaceRoots: readonly string[] = []): ValidationResult[] {
    return files.map(file => {
        const text = fs.readFileSync(file, 'utf8');
        return {
            file,
            text,
            findings: collectFindings({ text, fileName: file, workspaceRoots }),
        };
    });
}

function summarise(results: readonly ValidationResult[]): Totals {
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

function positionOf(text: string, offset: number): { line: number; column: number } {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length, column: before[before.length - 1].length + 1 };
}

function formatText(results: readonly ValidationResult[]): string {
    const lines: string[] = [];

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

function formatJson(results: readonly ValidationResult[]): string {
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
function main(argv: string[] = process.argv.slice(2)): number {
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

export { collectFiles, validateFiles, summarise, formatText, formatJson, main };
export type { ValidationResult };
