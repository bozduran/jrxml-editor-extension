// Locate the repository root from a tool script.
//
// Tools are compiled into out/tools, so a fixed `__dirname/..` would point at
// out/ instead of the repository root. Walk up until the package manifest is
// found: the same code works from tools/ (source) and out/tools/ (compiled).

const fs = require('node:fs');
const path = require('node:path');

function repositoryRoot(start = __dirname) {
    let dir = path.resolve(start);
    for (;;) {
        if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`package.json not found above ${start}`);
        }
        dir = parent;
    }
}

module.exports = { repositoryRoot };
