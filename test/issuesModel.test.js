// test/issuesModel.test.js
// Unit tests for the pure grouping layer behind the Issues (JRXML) view.

const test   = require('node:test');
const assert = require('node:assert');

const { groupIssues, countIssues, groupInfo } = require('../issuesModel');

const issue = (group, line, character, label) => ({
    group, line, character, label: label || `${group}-${line}-${character}`, message: label || '',
});

test('empty input yields no groups', () => {
    assert.deepStrictEqual(groupIssues([]), []);
    assert.deepStrictEqual(groupIssues(undefined), []);
});

test('groups appear in Errors, Warnings, Actions order regardless of input order', () => {
    const groups = groupIssues([
        issue('action', 0, 0),
        issue('warning', 1, 0),
        issue('error', 2, 0),
    ]);

    assert.deepStrictEqual(groups.map(g => g.id), ['errors', 'warnings', 'actions']);
    assert.deepStrictEqual(groups.map(g => g.title), ['Errors', 'Warnings', 'Actions']);
});

test('empty groups are dropped', () => {
    const groups = groupIssues([issue('warning', 1, 0)]);
    assert.deepStrictEqual(groups.map(g => g.id), ['warnings']);
});

test('items within a group are sorted by line then character', () => {
    const groups = groupIssues([
        issue('warning', 9, 4),
        issue('warning', 2, 10),
        issue('warning', 2, 1),
    ]);

    assert.deepStrictEqual(
        groups[0].items.map(i => [i.line, i.character]),
        [[2, 1], [2, 10], [9, 4]]
    );
});

test('unknown groups are ignored', () => {
    const groups = groupIssues([issue('error', 0, 0), issue('nonsense', 0, 0)]);
    assert.strictEqual(countIssues(groups), 1);
});

test('countIssues sums every group', () => {
    const groups = groupIssues([
        issue('error', 0, 0), issue('error', 1, 0),
        issue('warning', 2, 0),
        issue('action', 0, 0),
    ]);
    assert.strictEqual(countIssues(groups), 4);
    assert.strictEqual(countIssues([]), 0);
});

test('groupInfo returns display metadata', () => {
    assert.deepStrictEqual(groupInfo('action'), { id: 'actions', title: 'Actions' });
    assert.strictEqual(groupInfo('missing'), null);
});
