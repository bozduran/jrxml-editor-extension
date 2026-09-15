// test/fileIssues.test.js

const test   = require('node:test');
const assert = require('node:assert');

const { collectFileIssues } = require('../fileIssues');

function report(body) {
    return `<jasperReport name="R">\n${body}\n</jasperReport>`;
}

const SORTED = report([
    '  <detail><band height="20">',
    '    <element kind="a" x="0" y="0" width="1" height="1"/>',
    '    <element kind="b" x="0" y="10" width="1" height="1"/>',
    '  </band></detail>',
].join('\n'));

const UNSORTED = report([
    '  <detail><band height="20">',
    '    <element kind="a" x="0" y="10" width="1" height="1"/>',
    '    <element kind="b" x="0" y="0" width="1" height="1"/>',
    '  </band></detail>',
].join('\n'));

test('no issues for a sorted document without a SQL query', () => {
    assert.deepStrictEqual(collectFileIssues(SORTED), []);
});

test('reports a sort issue with the sort command', () => {
    const issues = collectFileIssues(UNSORTED);
    assert.strictEqual(issues.length, 1);

    const [issue] = issues;
    assert.strictEqual(issue.kind, 'sort');
    assert.strictEqual(issue.title, 'Elements are not sorted by position');
    assert.strictEqual(issue.command, 'jrxml.sortElements');
    assert.match(issue.detail, /reorder \[/);
});

test('reports a query issue using the configured target language', () => {
    const text = report('  <query language="sql"><![CDATA[SELECT 1]]></query>');

    const [issue] = collectFileIssues(text, { targetLanguage: 'jsonql' });
    assert.strictEqual(issue.kind, 'query');
    assert.strictEqual(issue.title, 'SQL query can be migrated to jsonql');
    assert.strictEqual(issue.command, 'jrxml.migrateSqlQuery');

    const [other] = collectFileIssues(text, { targetLanguage: 'jsonql2' });
    assert.strictEqual(other.title, 'SQL query can be migrated to jsonql2');
});

test('both issues can be reported together', () => {
    const text = UNSORTED.replace('</jasperReport>', '  <query language=\'sql\'><![CDATA[SELECT 1]]></query>\n</jasperReport>');
    assert.deepStrictEqual(collectFileIssues(text).map(i => i.kind), ['sort', 'query']);
});

test('a non-SQL query is not reported', () => {
    const text = report('  <query language="jsonql"><![CDATA[x]]></query>');
    assert.deepStrictEqual(collectFileIssues(text), []);
});

test('malformed XML yields no issues', () => {
    assert.deepStrictEqual(collectFileIssues('<r><a></b></r>'), []);
});
