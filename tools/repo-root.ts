// tools/repo-root.ts
// Locate the repository root from a tool script.
//
// Tools are compiled into out/tools, so a fixed `__dirname/..` would point at
// out/ instead of the repository root. Walk up until the package manifest is
// found: the same code works from tools/ (source) and out/tools/ (compiled).

import fs from 'node:fs';
import path from 'node:path';

function repositoryRoot(start: string = __dirname): string {
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

export { repositoryRoot };
