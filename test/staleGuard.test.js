// test/staleGuard.test.js
// The guard that stops destructive commands applying edits discovered before
// the preview/confirmation wait.

const test   = require('node:test');
const assert = require('node:assert');

const { isStale, STALE_MESSAGE } = require('../staleGuard');

test('isStale is false only for an unchanged version', () => {
    assert.strictEqual(isStale(1, 1), false);
    assert.strictEqual(isStale(0, 0), false);
    assert.strictEqual(isStale(1, 2), true);
    assert.strictEqual(isStale(7, 6), true);
});

test('the stale message tells the user nothing was applied', () => {
    assert.match(STALE_MESSAGE, /nothing was applied/i);
    assert.match(STALE_MESSAGE, /run the command again/i);
});
