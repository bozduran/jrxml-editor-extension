// test/support.ts
// Shared helpers for the unit tests.
//
// The tests run as ES modules (see test/package.json), so `__dirname` is not
// available; `TEST_DIR` is the test directory itself, which is where the
// fixtures live.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory holding the test files and their fixtures. */
export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
