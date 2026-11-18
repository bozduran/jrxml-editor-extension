// test/fixtureGate.test.js
// Every real JRXML file in the repo must stay clean for every lint family that
// claims broad coverage. The fixtures are real Studio output (6.x and 7.x), so
// a finding here is either a genuine problem in the fixture or a false
// positive the rules must learn about.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { scanXml } from '../out/xmlspan.js';
import { parseReport } from '../out/jrxmlParser.js';
import { textSource } from '../out/reportSource.js';
import { checkSchema } from '../out/schemaChecks.js';
import { checkUnusedResources } from '../out/unusedResources.js';
import { checkJavaSymbols } from '../out/javaSymbols.js';
import { EMPTY_JAVA_PROJECT_INDEX } from '../out/javaProjectIndex.js';
import { TEST_DIR } from './support.ts';

const ROOT = path.join(TEST_DIR, '..');

function files() {
    const found = [];
    for (const dir of ['integration/workspace', 'test/fixtures']) {
        for (const file of fs.readdirSync(path.join(ROOT, dir))) {
            if (file.endsWith('.jrxml')) found.push(path.join(ROOT, dir, file));
        }
    }
    return found;
}

test('every repo fixture is clean for schema, unused resources and Java symbols', () => {
    for (const file of files()) {
        const relative = path.relative(ROOT, file).split(path.sep).join('/');
        const text = fs.readFileSync(file, 'utf8');
        const scan = scanXml(text);
        const parsed = parseReport(textSource(text, relative, 1), scan);

        assert.deepStrictEqual(checkSchema(scan), [], `${relative}: schema findings`);

        assert.deepStrictEqual(
            checkUnusedResources({ scan, parsed, includeStyles: true, includeSubDatasets: true }),
            [],
            `${relative}: unused-resource findings`
        );

        assert.deepStrictEqual(
            checkJavaSymbols({ text, scan, parsed, index: EMPTY_JAVA_PROJECT_INDEX }),
            [],
            `${relative}: Java symbol findings`
        );
    }
});
