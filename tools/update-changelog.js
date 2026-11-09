// tools/update-changelog.js
// Inserts the released version's heading into CHANGELOG.md.
//
// The npm "version" lifecycle script calls this after npm has written the new
// version, so `npm version patch` (locally or in the Build VSIX workflow) leaves
// the changelog ready for the release commit. The existing [Unreleased] entries
// end up under the new version heading and Unreleased is left empty for the next
// release.
//
// Usage: node tools/update-changelog.js [version] [YYYY-MM-DD]

const fs   = require('fs');
const path = require('path');

const { repositoryRoot } = require('./repo-root');

const ROOT = repositoryRoot();
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const UNRELEASED = '## [Unreleased]';

function assertVersion(version) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error(`invalid version "${version}" (expected semver, e.g. 1.2.3)`);
    }
}

function assertDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`invalid date "${date}" (expected YYYY-MM-DD)`);
    }
}

function insertVersionHeading(text, version, date) {
    assertVersion(version);
    assertDate(date);

    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const unreleased = [];

    lines.forEach((line, index) => {
        if (line.trim() === UNRELEASED) unreleased.push(index);
    });
    if (unreleased.length !== 1) {
        throw new Error(`CHANGELOG.md must contain exactly one "${UNRELEASED}" heading (found ${unreleased.length})`);
    }

    const existing = `## [${version}]`;
    if (lines.some(line => line.trim() === existing || line.trim().startsWith(`${existing} `))) {
        throw new Error(`CHANGELOG.md already has a "${existing}" section`);
    }

    lines.splice(unreleased[0] + 1, 0, '', `${existing} - ${date}`);
    return lines.join(eol);
}

function main() {
    const version = process.argv[2]
        || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const date = process.argv[3] || new Date().toISOString().slice(0, 10);
    const text = fs.readFileSync(CHANGELOG, 'utf8');

    fs.writeFileSync(CHANGELOG, insertVersionHeading(text, version, date));
    console.log(`CHANGELOG.md: added ${version} (${date})`);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error(`update-changelog: ${err.message}`);
        process.exitCode = 1;
    }
}

module.exports = { insertVersionHeading };
