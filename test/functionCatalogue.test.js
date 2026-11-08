// test/functionCatalogue.test.js
// Guard the completion catalogue against the checked-in official reference.

const test   = require('node:test');
const assert = require('node:assert');

const { JASPER_FUNCTIONS } = require('../expressionSuggestions');
const reference = require('./fixtures/jasper-functions.json');

const labels = new Set(JASPER_FUNCTIONS.map(fn => fn.label));

test('every official date/time function is offered', () => {
    const missing = reference.dateTime.filter(name => !labels.has(name));
    assert.deepStrictEqual(missing, [], `missing functions: ${missing.join(', ')}`);
});

test('the catalogue has no duplicate labels and DATERANGE keeps its contract', () => {
    assert.strictEqual(labels.size, JASPER_FUNCTIONS.length);

    const daterange = JASPER_FUNCTIONS.find(fn => fn.label === 'DATERANGE');
    assert.strictEqual(daterange.detail, 'DATERANGE(value)');
    assert.match(daterange.doc, /DateRange/);
});
