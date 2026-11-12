// test/resourceBundle.test.js
// Resource-bundle discovery and indexing. Uses real files in a temporary
// directory so path resolution, locale variants and caching are exercised.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const {
    bundleAttribute,
    loadResourceBundle,
    clearResourceBundleCache,
} = require('../out/resourceBundle');

function tempDir() {
    clearResourceBundleCache();
    return fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-bundle-'));
}

test('reads the resourceBundle attribute and its value span', () => {
    const xml = '<jasperReport name="R" resourceBundle="i18n.messages"/>';
    const attr = bundleAttribute(xml);

    assert.ok(attr);
    assert.strictEqual(attr.name, 'i18n.messages');
    assert.strictEqual(xml.slice(attr.offset, attr.offset + attr.length), 'i18n.messages');
});

test('returns null when the report declares no bundle', () => {
    assert.strictEqual(bundleAttribute('<jasperReport name="R"/>'), null);
    assert.strictEqual(bundleAttribute('not xml'), null);
});

test('finds the base bundle and its locale variants next to the report', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'i18n'));
    fs.writeFileSync(path.join(dir, 'i18n', 'messages.properties'), 'title=Welcome\nbody=Body\n');
    fs.writeFileSync(path.join(dir, 'i18n', 'messages_en.properties'), 'title=Welcome EN\n');

    const index = loadResourceBundle(path.join(dir, 'report.jrxml'), 'i18n.messages');

    assert.ok(index, 'expected a bundle index');
    assert.deepStrictEqual([...index.entries.keys()].sort(), ['body', 'title']);
    assert.strictEqual(index.entries.get('title').defaultValue, 'Welcome');
    assert.strictEqual(index.entries.get('title').locales.get('en').value, 'Welcome EN');
    assert.strictEqual(index.files.length, 2);
});

test('accepts a dotted bundle name stored as a flat file', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'messages.properties'), 'title=Welcome\n');

    const index = loadResourceBundle(path.join(dir, 'report.jrxml'), 'messages');

    assert.ok(index);
    assert.strictEqual(index.entries.get('title').defaultValue, 'Welcome');
});

test('the last duplicate key in a file wins, like java.util.Properties', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'messages.properties'), 'title=first\ntitle=second\n');

    const index = loadResourceBundle(path.join(dir, 'report.jrxml'), 'messages');

    assert.strictEqual(index.entries.get('title').defaultValue, 'second');
});

test('keys that only exist in a locale variant are still index entries', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'messages.properties'), 'title=Welcome\n');
    fs.writeFileSync(path.join(dir, 'messages_fr.properties'), 'only_fr=Bonjour\n');

    const index = loadResourceBundle(path.join(dir, 'report.jrxml'), 'messages');

    assert.strictEqual(index.entries.get('only_fr').defaultValue, null);
    assert.strictEqual(index.entries.get('only_fr').locales.get('fr').value, 'Bonjour');
});

test('returns null when no properties file exists', () => {
    const dir = tempDir();
    assert.strictEqual(loadResourceBundle(path.join(dir, 'report.jrxml'), 'missing'), null);
});

test('rebuilds the index when a properties file changes', () => {
    const dir = tempDir();
    const file = path.join(dir, 'messages.properties');
    fs.writeFileSync(file, 'title=Welcome\n');

    const first = loadResourceBundle(path.join(dir, 'report.jrxml'), 'messages');
    assert.strictEqual(first.entries.get('title').defaultValue, 'Welcome');

    fs.writeFileSync(file, 'title=Changed\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);

    const second = loadResourceBundle(path.join(dir, 'report.jrxml'), 'messages');
    assert.strictEqual(second.entries.get('title').defaultValue, 'Changed');
});
