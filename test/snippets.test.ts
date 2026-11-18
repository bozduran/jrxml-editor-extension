// test/snippets.test.js
// The expression snippet library is contributed and internally consistent.

import test from 'node:test';
import assert from 'node:assert';
import { TEST_DIR } from './support.ts';
import fs from 'node:fs';
import path from 'node:path';

import pkg from '../package.json' with { type: 'json' };

interface SnippetContribution {
    language: string;
    path: string;
}

/** The subset of a VS Code snippet definition these tests read. */
interface SnippetDefinition {
    prefix: string | string[];
    body: string | string[];
    description: string;
}

const ROOT = path.join(TEST_DIR, '..');
const contribution = (pkg.contributes.snippets || [])
    .find((entry: SnippetContribution) => entry.language === 'jrxml');
const snippetFile = contribution ? path.join(ROOT, contribution.path) : null;

/** Parse the contributed snippet library. */
function readSnippets(): Record<string, SnippetDefinition> {
    assert.ok(snippetFile, 'the jrxml snippets contribution is missing');
    return JSON.parse(fs.readFileSync(snippetFile, 'utf8'));
}

/** The body registered under `prefix`, failing when the snippet is missing. */
function snippetBody(byPrefix: Map<string, { body: string }>, prefix: string): string {
    const snippet = byPrefix.get(prefix);
    assert.ok(snippet, `missing snippet ${prefix}`);
    return snippet.body;
}

test('contributes the JRXML expression snippet library', () => {
    assert.ok(contribution, 'missing the jrxml snippets contribution');
    assert.ok(!path.isAbsolute(contribution.path), 'the snippet path must be extension-relative');
    assert.ok(snippetFile && fs.existsSync(snippetFile), 'the snippet file is missing');
});

test('every snippet has a prefix, body and description', () => {
    const snippets = readSnippets();
    const names = Object.keys(snippets);

    assert.ok(names.length >= 8, `expected at least 8 snippets, got ${names.length}`);
    for (const name of names) {
        const snippet = snippets[name];
        assert.ok(snippet.prefix, `${name} has no prefix`);
        assert.ok(snippet.body, `${name} has no body`);
        assert.ok(snippet.description, `${name} has no description`);

        const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : String(snippet.body);
        assert.ok(body.trim().length > 0, `${name} has an empty body`);
    }
});

test('snippet prefixes are unique', () => {
    const snippets = readSnippets();
    const seen = new Map<string, string>();

    for (const [name, snippet] of Object.entries(snippets)) {
        const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
        for (const prefix of prefixes) {
            assert.ok(!seen.has(prefix), `prefix "${prefix}" is used by ${seen.get(prefix)} and ${name}`);
            seen.set(prefix, name);
        }
    }
});

test('the equals snippets use the JasperReports EQUALS function', () => {
    const snippets = readSnippets();
    const byPrefix = new Map<string, { body: string }>();

    for (const snippet of Object.values(snippets)) {
        const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : String(snippet.body);
        const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
        for (const prefix of prefixes) byPrefix.set(prefix, { body });
    }

    for (const prefix of ['jequals', 'jrequals', 'jr-equals']) {
        assert.ok(byPrefix.has(prefix), `missing equals snippet ${prefix}`);
        const body = snippetBody(byPrefix, prefix);
        assert.match(body, /^EQUALS\(/, `${prefix} must use the JasperReports EQUALS function`);
        assert.ok(!body.includes('.equals('), `${prefix} must not use a Java .equals() call`);
    }
});

test('ships the common date helpers', () => {
    const snippets = readSnippets();
    const byPrefix = new Map<string, { body: string }>();

    for (const snippet of Object.values(snippets)) {
        const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : String(snippet.body);
        const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
        for (const prefix of prefixes) byPrefix.set(prefix, { body });
    }

    for (const prefix of [
        'jdatetoday', 'jdateadd', 'jdateadddate', 'jdatetodaybefore', 'jdatetodayafter',
        'jparsedate', 'jdatecompare', 'jnow', 'jdatediff', 'jdatetodaytz', 'jdatetodaylocale',
    ]) {
        assert.ok(byPrefix.has(prefix), `missing date snippet ${prefix}`);
    }

    assert.match(snippetBody(byPrefix, 'jdatetoday'), /TODAY\(\)/);
    assert.match(snippetBody(byPrefix, 'jparsedate'), /\.parse\(/);
    assert.match(snippetBody(byPrefix, 'jdatecompare'), /\.before\(/);
    assert.match(snippetBody(byPrefix, 'jdatetodaytz'), /REPORT_TIME_ZONE/);
    assert.match(snippetBody(byPrefix, 'jdatetodaylocale'), /REPORT_LOCALE/);
});
