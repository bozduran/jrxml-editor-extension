// test/updateChangelog.test.js
// Unit tests for the release helper in tools/update-changelog.js, plus a
// contract check on the repository changelog so the npm "version" script always
// has exactly one [Unreleased] section to move the new version under.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { insertVersionHeading } = require('../out/tools/update-changelog');

const SAMPLE = [
    '# Change Log',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '- a new thing',
    '',
    '## [0.1.0] - 2026-09-16',
    '',
    '### Fixed',
    '- an old thing',
    '',
].join('\n');

function expected(version, date) {
    return [
        '# Change Log',
        '',
        '## [Unreleased]',
        '',
        `## [${version}] - ${date}`,
        '',
        '### Added',
        '- a new thing',
        '',
        '## [0.1.0] - 2026-09-16',
        '',
        '### Fixed',
        '- an old thing',
        '',
    ].join('\n');
}

test('inserts the version heading after Unreleased and leaves it empty', () => {
    assert.strictEqual(insertVersionHeading(SAMPLE, '0.1.1', '2026-11-03'), expected('0.1.1', '2026-11-03'));
});

test('keeps the sections that were already in the file untouched', () => {
    const out = insertVersionHeading(SAMPLE, '0.2.0', '2027-01-15');
    assert.ok(out.includes('### Added\n- a new thing\n'));
    assert.ok(out.includes('## [0.1.0] - 2026-09-16\n\n### Fixed\n- an old thing\n'));
});

test('preserves CRLF line endings', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    const out = insertVersionHeading(crlf, '0.1.1', '2026-11-03');
    assert.strictEqual(out, expected('0.1.1', '2026-11-03').replace(/\n/g, '\r\n'));
    assert.ok(!/(?<!\r)\n/.test(out), 'every newline should be CRLF');
});

test('rejects a changelog without an Unreleased heading', () => {
    assert.throws(
        () => insertVersionHeading('## [0.1.0] - 2026-09-16\n', '0.1.1', '2026-11-03'),
        /exactly one "## \[Unreleased\]"/,
    );
});

test('rejects duplicate Unreleased headings', () => {
    const text = '## [Unreleased]\n\n## [Unreleased]\n\n## [0.1.0] - 2026-09-16\n';
    assert.throws(() => insertVersionHeading(text, '0.1.1', '2026-11-03'), /exactly one/);
});

test('rejects a version that is already in the changelog', () => {
    const text = '## [Unreleased]\n\n## [0.1.1] - 2026-01-01\n';
    assert.throws(() => insertVersionHeading(text, '0.1.1', '2026-11-03'), /already has/);
    const plain = '## [Unreleased]\n\n## [0.1.1]\n';
    assert.throws(() => insertVersionHeading(plain, '0.1.1', '2026-11-03'), /already has/);
});

test('rejects invalid versions and dates', () => {
    assert.throws(() => insertVersionHeading(SAMPLE, 'v0.1.1', '2026-11-03'), /invalid version/);
    assert.throws(() => insertVersionHeading(SAMPLE, '0.1', '2026-11-03'), /invalid version/);
    assert.throws(() => insertVersionHeading(SAMPLE, '0.1.1', '03/11/2026'), /invalid date/);
});

// ── Repository contract ───────────────────────────────────────────────────────

const CHANGELOG = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');

test('the repository changelog has exactly one Unreleased heading', () => {
    const headings = CHANGELOG
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line === '## [Unreleased]');
    assert.strictEqual(headings.length, 1);
});

test('the repository changelog lists released versions newest first, without duplicates', () => {
    const versions = [...CHANGELOG.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(match => match[1]);
    assert.ok(versions.length >= 2, 'expected at least two released versions');
    assert.strictEqual(new Set(versions).size, versions.length, 'duplicate version headings');

    for (let i = 1; i < versions.length; i++) {
        assert.ok(
            compareVersions(versions[i - 1], versions[i]) > 0,
            `${versions[i - 1]} should be listed before ${versions[i]}`,
        );
    }
});

function compareVersions(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
    }
    return 0;
}
