// test/snippets.test.js
// The expression snippet library is contributed and internally consistent.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const contribution = (pkg.contributes.snippets || [])
    .find(entry => entry.language === 'jrxml');
const snippetFile = contribution ? path.join(ROOT, contribution.path) : null;

test('contributes the JRXML expression snippet library', () => {
    assert.ok(contribution, 'missing the jrxml snippets contribution');
    assert.ok(!path.isAbsolute(contribution.path), 'the snippet path must be extension-relative');
    assert.ok(snippetFile && fs.existsSync(snippetFile), 'the snippet file is missing');
});

test('every snippet has a prefix, body and description', () => {
    const snippets = JSON.parse(fs.readFileSync(snippetFile, 'utf8'));
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
    const snippets = JSON.parse(fs.readFileSync(snippetFile, 'utf8'));
    const seen = new Map();

    for (const [name, snippet] of Object.entries(snippets)) {
        const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
        for (const prefix of prefixes) {
            assert.ok(!seen.has(prefix), `prefix "${prefix}" is used by ${seen.get(prefix)} and ${name}`);
            seen.set(prefix, name);
        }
    }
});

test('ships the common date helpers', () => {
    const snippets = JSON.parse(fs.readFileSync(snippetFile, 'utf8'));
    const byPrefix = new Map();

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

    assert.match(byPrefix.get('jdatetoday').body, /TODAY\(\)/);
    assert.match(byPrefix.get('jparsedate').body, /\.parse\(/);
    assert.match(byPrefix.get('jdatecompare').body, /\.before\(/);
    assert.match(byPrefix.get('jdatetodaytz').body, /REPORT_TIME_ZONE/);
    assert.match(byPrefix.get('jdatetodaylocale').body, /REPORT_LOCALE/);
});
