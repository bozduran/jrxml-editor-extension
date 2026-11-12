// test/queryChecks.test.js
// Conservative <query> literal/comment checks.

const test   = require('node:test');
const assert = require('node:assert');

const { checkQueries } = require('../out/queryChecks');

function sqlQuery(body, language = 'sql') {
    return `<jasperReport name="R"><query language="${language}"><![CDATA[${body}]]></query></jasperReport>`;
}

test('a valid SQL query has no findings', () => {
    const text = sqlQuery("SELECT * FROM t WHERE name = 'x' AND id IN ($P!{Ids}) /* ok */ -- done");

    assert.deepStrictEqual(checkQueries(text), []);
});

test('an unclosed SQL string is reported at the quote', () => {
    const text = sqlQuery("SELECT * FROM t WHERE name = 'oops");
    const findings = checkQueries(text);

    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].code, 'jrxml.query.unclosedString');
    assert.strictEqual(text.slice(findings[0].offset, findings[0].offset + 1), "'");
});

test('an unclosed block comment is reported', () => {
    const text = sqlQuery("SELECT * FROM t /* never closed");
    const findings = checkQueries(text);

    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].code, 'jrxml.query.unclosedComment');
    assert.strictEqual(text.slice(findings[0].offset, findings[0].offset + 2), '/*');
});

test('quotes inside $P!{} and $X{} fragments are ignored', () => {
    const text = sqlQuery("SELECT * FROM t WHERE x = $P!{broken'fragment} AND y IN ($X{IN, col, list})");

    assert.deepStrictEqual(checkQueries(text), []);
});

test('a doubled SQL quote is an escape, not a closing quote', () => {
    const text = sqlQuery("SELECT * FROM t WHERE name = 'O''Brien'");

    assert.deepStrictEqual(checkQueries(text), []);
});

test('JSONQL checks double-quoted strings but not SQL single quotes', () => {
    const broken = sqlQuery('{ "name: "x" }', 'jsonql');
    assert.deepStrictEqual(
        checkQueries(broken).map(finding => finding.code),
        ['jrxml.query.unclosedString']
    );

    const apostrophe = sqlQuery("{ \"note\": \"it's fine\" }", 'jsonql');
    assert.deepStrictEqual(checkQueries(apostrophe), []);
});

test('queries in other languages are left alone', () => {
    const text = sqlQuery("SELECT 'unclosed", 'json');
    assert.deepStrictEqual(checkQueries(text), []);
});
