// test/subreports.test.js
// Pure subreport-link extraction and path resolution.

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('node:path');

const {
    findSubreportLinks,
    resolveSubreportCandidates,
} = require('../subreports');

const MASTER = `<jasperReport name="M">
  <subreport>
    <subreportExpression class="java.lang.String"><![CDATA["detail.jrxml"]]></subreportExpression>
    <subreportParameter name="P1">
      <subreportParameterExpression><![CDATA[$F{x}]]></subreportParameterExpression>
    </subreportParameter>
    <subreportParameter name="BAD"/>
  </subreport>
  <element kind="subreport" uuid="s1">
    <expression><![CDATA["/reports/detail.jrxml"]]></expression>
    <parameter name="P2"><expression><![CDATA[$F{y}]]></expression></parameter>
  </element>
  <subreport>
    <subreportExpression><![CDATA[$P{SUBREPORT_DIR} + "dyn.jrxml"]]></subreportExpression>
  </subreport>
  <!-- <subreportExpression>"commented.jrxml"</subreportExpression> -->
</jasperReport>`;

test('finds classic and element subreport literals with their spans', () => {
    const links = findSubreportLinks(MASTER);

    assert.strictEqual(links.length, 3);
    assert.strictEqual(links[0].path, 'detail.jrxml');
    assert.strictEqual(links[0].offset, MASTER.indexOf('detail.jrxml'));
    assert.strictEqual(links[0].length, 'detail.jrxml'.length);
    assert.strictEqual(links[1].path, '/reports/detail.jrxml');
});

test('collects the parameter mappings of each subreport', () => {
    const [classic, element] = findSubreportLinks(MASTER);

    assert.deepStrictEqual(classic.mappings.map(mapping => mapping.name), ['P1', 'BAD']);
    assert.deepStrictEqual(element.mappings.map(mapping => mapping.name), ['P2']);
});

test('marks expressions that are not a plain string literal as dynamic', () => {
    const dynamic = findSubreportLinks(MASTER)[2];

    assert.strictEqual(dynamic.dynamic, true);
    assert.strictEqual(dynamic.path, null);
});

test('ignores subreport expressions inside comments', () => {
    const paths = findSubreportLinks(MASTER).map(link => link.path);
    assert.ok(!paths.includes('commented.jrxml'));
});

test('unwraps escaped quotes and backslashes in the path literal', () => {
    const text = '<jasperReport><subreport><subreportExpression><![CDATA["a\\\\b\\\\detail.jrxml"]]></subreportExpression></subreport></jasperReport>';
    const link = findSubreportLinks(text)[0];

    assert.strictEqual(link.path, 'a\\b\\detail.jrxml');
});

test('resolves relative paths against the report directory first', () => {
    const candidates = resolveSubreportCandidates('/proj/reports/master.jrxml', 'detail.jrxml', ['/proj']);

    assert.strictEqual(candidates[0], path.join('/proj', 'reports', 'detail.jrxml'));
});

test('treats a leading slash as workspace-relative, never filesystem-absolute', () => {
    const candidates = resolveSubreportCandidates('/proj/reports/master.jrxml', '/reports/detail.jrxml', ['/proj']);

    assert.strictEqual(candidates[0], path.join('/proj', 'reports', 'detail.jrxml'));
    assert.ok(!candidates.includes('/reports/detail.jrxml'));
});

test('prefers the .jrxml source when the expression points at a .jasper', () => {
    const candidates = resolveSubreportCandidates('/proj/reports/master.jrxml', 'detail.jasper', ['/proj']);

    assert.strictEqual(candidates[0], path.join('/proj', 'reports', 'detail.jrxml'));
    assert.ok(candidates.includes(path.join('/proj', 'reports', 'detail.jasper')));
});

test('tries both extensions when the expression has none', () => {
    const candidates = resolveSubreportCandidates('/proj/reports/master.jrxml', 'detail', ['/proj']);

    assert.strictEqual(candidates[0], path.join('/proj', 'reports', 'detail.jrxml'));
    assert.ok(candidates.includes(path.join('/proj', 'reports', 'detail.jasper')));
});
