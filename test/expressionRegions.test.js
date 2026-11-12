// test/expressionRegions.test.js
// Expression regions are derived from the XML tree, not from a regex over the
// raw text. These tests lock the spans and the comment/CDATA behaviour.

const test   = require('node:test');
const assert = require('node:assert');

const { scanXml }           = require('../out/xmlspan');
const { regions, regionAt, forEachRegion } = require('../out/expressionRegions');

test('derives an expression region with its content span from the XML tree', () => {
    const text = `<jasperReport name="R">
  <detail><band height="20"><textField>
    <reportElement x="0" y="0" width="10" height="10"/>
    <textFieldExpression><![CDATA[$F{shared}]]></textFieldExpression>
  </textField></band></detail>
</jasperReport>`;

    const found = regions(scanXml(text), text);

    assert.strictEqual(found.length, 1);
    const region = found[0];
    assert.strictEqual(region.tag, 'textFieldExpression');
    assert.strictEqual(region.expression, '$F{shared}');
    assert.strictEqual(region.start, text.indexOf('<textFieldExpression>'));
    assert.strictEqual(region.end, text.indexOf('</textFieldExpression>') + '</textFieldExpression>'.length);
    assert.strictEqual(text.slice(region.contentStart, region.contentStart + region.expression.length), '$F{shared}');
    assert.strictEqual(region.cdata, true);
});

test('ignores expression-like text in comments and exposes a query region', () => {
    const text = `<jasperReport name="R">
  <!-- <textFieldExpression>$F{commentOnly}</textFieldExpression> -->
  <query language="sql"><![CDATA[SELECT * FROM t WHERE $P!{Clause}]]></query>
  <detail><band height="20"><textField><reportElement x="0" y="0" width="10" height="10"/><textFieldExpression><![CDATA[$F{real}]]></textFieldExpression></textField></band></detail>
</jasperReport>`;

    const found = regions(scanXml(text), text);
    assert.deepStrictEqual(found.map(region => region.tag), ['query', 'textFieldExpression']);
    assert.strictEqual(regions(scanXml(text), text).length, 2);

    const visited = [];
    forEachRegion(found, region => visited.push(region.tag));
    assert.deepStrictEqual(visited, ['query', 'textFieldExpression']);

    const comment = regionAt(found, text.indexOf('$F{commentOnly}'));
    assert.strictEqual(comment, null);

    const inside = regionAt(found, text.indexOf('$F{real}'));
    assert.strictEqual(inside.tag, 'textFieldExpression');
});
