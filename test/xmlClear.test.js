// test/xmlClear.test.js

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const {
    discoverClearFixes,
    queryMigrationEdits,
    collectUsedNames,
    removalSpan,
    BUILTIN_PARAMETERS,
} = require('../xmlClear');
const { applyEdits } = require('../edits');

function fixture() {
    return fs.readFileSync(path.join(__dirname, 'fixtures', 'ClearEdgeReport.jrxml'), 'utf8');
}

function group(text, label) {
    return discoverClearFixes(text).find(g => g.label === label);
}

function descriptions(text, label) {
    const g = group(text, label);
    return g ? g.fixes.map(f => f.description) : [];
}

function report(body) {
    return `<jasperReport name="R">\n${body}\n</jasperReport>`;
}

// ── golden fixture ────────────────────────────────────────────────────────────

test('golden: ClearEdgeReport groups and descriptions match the hook', () => {
    assert.deepStrictEqual(descriptions(fixture(), 'unused declarations'), [
        "delete unused parameter 'UnusedParam'",
        "delete unused field 'UnusedField'",
        "delete unused variable 'UnusedVar'",
    ]);
    assert.deepStrictEqual(descriptions(fixture(), 'jsonql fixes'), [
        'add net.sf.jasperreports.jsonql.field.expression = "a & b"',
    ]);
    assert.strictEqual(group(fixture(), 'description sync'), undefined);
});

test('golden: ClearEdgeReport applied result deletes lines and adds the property', () => {
    const text = fixture();
    const edits = discoverClearFixes(text).flatMap(g => g.fixes.filter(f => f.edit).map(f => f.edit));
    const applied = applyEdits(text, edits);

    assert.ok(!applied.includes('UnusedParam'));
    assert.ok(!applied.includes('UnusedField'));
    assert.ok(!applied.includes('UnusedVar'));
    assert.ok(applied.includes('name="ReportTitle"'));
    assert.ok(applied.includes('name="Total&amp;Tax"'));
    assert.ok(applied.includes('\t\t<property name="net.sf.jasperreports.jsonql.field.expression" value="a &amp; b"/>'));
});

// ── unused detection ──────────────────────────────────────────────────────────

test('references are only collected from expressions, not the whole document', () => {
    const text = report([
        '  <field name="onlyInComment" class="java.lang.String"/>',
        '  <field name="onlyInDescription" class="java.lang.String">',
        '    <description>$F{onlyInDescription}</description>',
        '  </field>',
        '  <!-- $F{onlyInComment} -->',
    ].join('\n'));

    const used = collectUsedNames(text);
    assert.ok(!used.has('FIELD:onlyInComment'));
    assert.ok(!used.has('FIELD:onlyInDescription'));

    assert.deepStrictEqual(descriptions(text, 'unused declarations'), [
        "delete unused field 'onlyInComment'",
        "delete unused field 'onlyInDescription'",
    ]);
});

test('$P!{} references inside a query count as used', () => {
    const text = report([
        '  <parameter name="Clause" class="java.lang.String"/>',
        '  <query language="sql"><![CDATA[SELECT * FROM t WHERE $P!{Clause}]]></query>',
    ].join('\n'));

    assert.ok(collectUsedNames(text).has('PARAMETER:Clause'));
    assert.deepStrictEqual(descriptions(text, 'unused declarations'), []);
});

test('subreport pass-throughs and return values count as used', () => {
    const text = report([
        '  <parameter name="Passed" class="java.lang.String"/>',
        '  <variable name="Returned" class="java.lang.Integer"/>',
        '  <subreportParameter name="Passed"/>',
        '  <returnValue toVariable="Returned"/>',
    ].join('\n'));

    const used = collectUsedNames(text);
    assert.ok(used.has('PARAMETER:Passed'));
    assert.ok(used.has('VARIABLE:Returned'));
    assert.deepStrictEqual(descriptions(text, 'unused declarations'), []);
});

test('nested subreport parameters count as used', () => {
    const text = report([
        '  <parameter name="Nested" class="java.lang.String"/>',
        '  <element kind="subreport"><parameter name="Nested" class="java.lang.String"/></element>',
    ].join('\n'));
    assert.deepStrictEqual(descriptions(text, 'unused declarations'), []);
});

test('built-in parameters are never deleted', () => {
    for (const name of ['REPORT_LOCALE', 'JSON_TIME_ZONE', 'REPORT_SCRIPTLET']) {
        assert.ok(BUILTIN_PARAMETERS.has(name));
        const text = report(`  <parameter name="${name}" class="java.lang.Object"/>`);
        assert.deepStrictEqual(descriptions(text, 'unused declarations'), []);
    }
});

test('an entity-encoded declaration name matches its decoded reference', () => {
    const text = report([
        '  <field name="Total&amp;Tax" class="java.lang.String"/>',
        '  <expression><![CDATA[$F{Total&Tax}]]></expression>',
    ].join('\n'));
    assert.deepStrictEqual(descriptions(text, 'unused declarations'), []);
});

test('only direct root children are treated as declarations', () => {
    const text = report([
        '  <detail><band height="10">',
        '    <variable name="Inner" class="java.lang.Integer"/>',
        '  </band></detail>',
    ].join('\n'));
    assert.deepStrictEqual(descriptions(text, 'unused declarations'), []);
});

test('removal is line-aware and keeps a same-line comment', () => {
    const text = report('  <field name="A" class="java.lang.String"/><!-- keep -->');
    const span = removalSpan(text, text.indexOf('<field'), text.indexOf('/>') + 2);

    assert.strictEqual(text.slice(span.start, span.end), '<field name="A" class="java.lang.String"/>');
    assert.ok(text.includes('<!-- keep -->'));
});

// ── description sync ──────────────────────────────────────────────────────────

test('description sync uses the jsonql value, preserving CDATA', () => {
    const text = report([
        '  <field name="F" class="java.lang.String">',
        '    <description><![CDATA[old text]]></description>',
        '    <property name="net.sf.jasperreports.jsonql.field.expression" value="new text"/>',
        '  </field>',
        '  <expression><![CDATA[$F{F}]]></expression>',
    ].join('\n'));

    const g = group(text, 'description sync');
    assert.strictEqual(g.fixes[0].description, `change description for field 'F' from "old text" to "new text"`);
    assert.strictEqual(g.fixes[0].edit.replacement, 'new text');
    assert.ok(applyEdits(text, [g.fixes[0].edit]).includes('<![CDATA[new text]]>'));
});

test('description sync XML-encodes when the description has no CDATA', () => {
    const text = report([
        '  <field name="F" class="java.lang.String">',
        '    <description>old &amp; text</description>',
        '    <property name="net.sf.jasperreports.jsonql.field.expression" value="new &amp; value"/>',
        '  </field>',
        '  <expression><![CDATA[$F{F}]]></expression>',
    ].join('\n'));

    const g = group(text, 'description sync');
    assert.strictEqual(g.fixes[0].description, `change description for field 'F' from "old & text" to "new & value"`);
    assert.strictEqual(g.fixes[0].edit.replacement, 'new &amp; value');
});

test('description sync skips unused fields and unchanged values', () => {
    const unchanged = report([
        '  <field name="F" class="java.lang.String">',
        '    <description><![CDATA[same]]></description>',
        '    <property name="net.sf.jasperreports.jsonql.field.expression" value="same"/>',
        '  </field>',
        '  <expression><![CDATA[$F{F}]]></expression>',
    ].join('\n'));
    assert.strictEqual(group(unchanged, 'description sync'), undefined);

    const unused = report([
        '  <field name="F" class="java.lang.String">',
        '    <description><![CDATA[old]]></description>',
        '    <property name="net.sf.jasperreports.jsonql.field.expression" value="new"/>',
        '  </field>',
    ].join('\n'));
    const labels = discoverClearFixes(unused).map(g => g.label);
    assert.ok(labels.includes('unused declarations'));
    assert.ok(!labels.includes('description sync'));
    assert.ok(!labels.includes('jsonql fixes'));
});

// ── jsonql fixes ──────────────────────────────────────────────────────────────

test('legacy property is removed when jsonql is present', () => {
    const text = report([
        '  <field name="F" class="java.lang.String">',
        '    <property name="net.sf.jasperreports.json.field.expression" value="x"/>',
        '    <property name="net.sf.jasperreports.jsonql.field.expression" value="y"/>',
        '  </field>',
        '  <expression><![CDATA[$F{F}]]></expression>',
    ].join('\n'));

    assert.deepStrictEqual(descriptions(text, 'jsonql fixes'), [
        'remove legacy net.sf.jasperreports.json.field.expression from field \'F\'',
    ]);
    const applied = applyEdits(text, [group(text, 'jsonql fixes').fixes[0].edit]);
    assert.ok(!applied.includes('net.sf.jasperreports.json.field.expression'));
    assert.ok(applied.includes('net.sf.jasperreports.jsonql.field.expression'));
});

test('legacy property is renamed when jsonql is absent', () => {
    const text = report([
        '  <field name="F" class="java.lang.String">',
        "    <property name='net.sf.jasperreports.json.field.expression' value='x'/>",
        '  </field>',
        '  <expression><![CDATA[$F{F}]]></expression>',
    ].join('\n'));

    assert.deepStrictEqual(descriptions(text, 'jsonql fixes'), [
        'rename net.sf.jasperreports.json.field.expression to net.sf.jasperreports.jsonql.field.expression',
    ]);
    const applied = applyEdits(text, [group(text, 'jsonql fixes').fixes[0].edit]);
    assert.ok(applied.includes("name='net.sf.jasperreports.jsonql.field.expression'"));
});

test('propertyExpression counts as jsonql for the add rule', () => {
    const text = report([
        '  <field name="F" class="java.lang.String">',
        '    <description>text</description>',
        '    <propertyExpression name="net.sf.jasperreports.jsonql.field.expression"><![CDATA[$P{x}]]></propertyExpression>',
        '  </field>',
        '  <expression><![CDATA[$F{F}]]></expression>',
    ].join('\n'));

    assert.strictEqual(group(text, 'jsonql fixes'), undefined);
    assert.strictEqual(group(text, 'description sync'), undefined);
});

test('a blank description produces no jsonql property', () => {
    const text = report([
        '  <field name="F" class="java.lang.String">',
        '    <description>   </description>',
        '  </field>',
        '  <expression><![CDATA[$F{F}]]></expression>',
    ].join('\n'));
    assert.strictEqual(group(text, 'jsonql fixes'), undefined);
});

// ── query migration ───────────────────────────────────────────────────────────

test('SQL query migration is discovered and needs input', () => {
    const text = report('  <query language="sql"><![CDATA[SELECT 1]]></query>');
    const g = group(text, 'query migration');

    assert.ok(g);
    assert.strictEqual(g.fixes[0].description, 'migrate SQL query to jsonql');
    assert.strictEqual(g.fixes[0].kind, 'queryMigration');

    // An empty answer applies nothing.
    assert.deepStrictEqual(queryMigrationEdits(g.fixes[0].query, ''), []);

    const applied = applyEdits(text, queryMigrationEdits(g.fixes[0].query, 'SELECT 2'));
    assert.ok(applied.includes('language="jsonql"'));
    assert.ok(applied.includes('SELECT 2'));
});

test('query migration handles single quotes and an empty body', () => {
    const text = report("  <query language='SQL'><![CDATA[]]></query>");
    const g = group(text, 'query migration');
    const applied = applyEdits(text, queryMigrationEdits(g.fixes[0].query, 'expr'));

    assert.ok(applied.includes("language='jsonql'"));
    assert.ok(applied.includes('<![CDATA[expr]]>'));
});

test('a non-SQL query is not reported', () => {
    const text = report('  <query language="jsonql"><![CDATA[x]]></query>');
    assert.strictEqual(group(text, 'query migration'), undefined);
});

test('query migration writes the configured target language', () => {
    const text = report('  <query language="sql"><![CDATA[SELECT 1]]></query>');
    const g = group(text, 'query migration');
    const applied = applyEdits(text, queryMigrationEdits(g.fixes[0].query, 'expr', 'jsonql2'));

    assert.ok(applied.includes('language="jsonql2"'));
    assert.ok(!applied.includes('language="sql"'));
});

test('malformed XML yields no clear fixes', () => {
    assert.deepStrictEqual(discoverClearFixes('<r><a></b></r>'), []);
});
