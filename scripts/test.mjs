// scripts/test.mjs
// Run the unit tests in test/.
//
// The tests are TypeScript, and `node --test test/` is not portable for them:
// the runner only walks a directory with its default test-file patterns, and
// those do not include `.ts` on every Node version (Node 24's do not, so it
// found nothing and tried to load `test/` itself: MODULE_NOT_FOUND). Listing
// the files explicitly is the interface every version supports, and it keeps
// `test/support.ts` (a helper, not a test) out of the run.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testDir = path.join(root, 'test');

const files = readdirSync(testDir)
    .filter(name => name.endsWith('.test.ts'))
    .sort()
    .map(name => path.join('test', name));

if (files.length === 0) {
    console.error('No *.test.ts files found in test/.');
    process.exit(1);
}

const result = spawnSync(
    process.execPath,
    ['--enable-source-maps', '--test', ...files],
    { cwd: root, stdio: 'inherit' }
);

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}
process.exit(result.status ?? 1);
