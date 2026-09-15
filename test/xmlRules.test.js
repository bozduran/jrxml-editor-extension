// test/xmlRules.test.js
// format + textcheck discovery, with the hook's own output as ground truth.

const test   = require('node:test');
const assert = require('node:assert');

const {
    discoverFormatFixes,
    discoverTextcheckFixes,
    combinedFormatterEdits,
} = require('../xmlRules');
const { applyEdits } = require('../edits');

const FMT = [
    '<jasperReport name="Fmt" uuid="11111111-1111-1111-1111-111111111111">',
    '\t<variable name="V" class="java.lang.Integer">',
    '\t\t<expression><![CDATA[$F{a}==null?1:($F{b}+2)]]></expression>',
    '\t</variable>',
    '\t<detail>',
    '\t\t<band height="20">',
    '\t\t\t<element kind="textField" uuid="22222222-2222-2222-2222-222222222222" x="0" y="0" width="100" height="20">',
    '\t\t\t\t<expression><![CDATA[$F{a}==null?"-":String.valueOf($F{b})+","]]></expression>',
    '\t\t\t</element>',
    '\t\t\t<element kind="subreport" x="0" y="20" width="100" height="20"/>',
    '\t\t</band>',
    '\t</detail>',
    '</jasperReport>',
].join('\n');

const FMT_FORMATTED = [
    '<jasperReport name="Fmt" uuid="11111111-1111-1111-1111-111111111111">',
    '\t<variable name="V" class="java.lang.Integer">',
    '\t\t<expression><![CDATA[$F{a} == null ? 1 : ($F{b}+2)]]></expression>',
    '\t</variable>',
    '\t<detail>',
    '\t\t<band height="20">',
    '\t\t\t<element kind="textField" uuid="22222222-2222-2222-2222-222222222222" positionType="Float" x="0" y="0" width="100" height="20" textAdjust="StretchHeight">',
    '\t\t\t\t<expression><![CDATA[$F{a} == null ? "-" : String.valueOf($F{b})+","]]></expression>',
    '\t\t\t</element>',
    '\t\t\t<element kind="subreport" positionType="Float" x="0" y="20" width="100" height="20"/>',
    '\t\t</band>',
    '\t</detail>',
    '</jasperReport>',
].join('\n');

function labels(groups) {
    return groups.map(g => g.label);
}

// ── format groups ─────────────────────────────────────────────────────────────

test('format groups appear in the hook order with the hook descriptions', () => {
    const groups = discoverFormatFixes(FMT, 'Fmt', {});

    assert.deepStrictEqual(labels(groups), ['positionType', 'textAdjust', 'expression formatting']);
    assert.deepStrictEqual(groups[0].fixes.map(f => f.description),
        ['add positionType="Float"', 'add positionType="Float"']);
    assert.deepStrictEqual(groups[1].fixes.map(f => f.description),
        ['add textAdjust="StretchHeight"']);
    assert.deepStrictEqual(groups[2].fixes.map(f => f.description),
        ['format expression', 'format expression']);
});

test('positionType anchors after uuid, else after kind', () => {
    const applied = applyEdits(FMT, combinedFormatterEdits(FMT, 'Fmt', {}));
    assert.match(applied, /kind="textField" uuid="22222222[^"]*" positionType="Float"/);
    assert.match(applied, /kind="subreport" positionType="Float"/);
});

test('textAdjust is inserted just before the tag close', () => {
    const applied = applyEdits(FMT, combinedFormatterEdits(FMT, 'Fmt', {}));
    assert.match(applied, /height="20" textAdjust="StretchHeight">/);
});

test('report name is set when it differs from the file base name', () => {
    const text = '<jasperReport name="Other"><detail/></jasperReport>';
    const groups = discoverFormatFixes(text, 'Expected', {});
    const nameGroup = groups.find(g => g.label === 'report name');

    assert.ok(nameGroup);
    assert.strictEqual(nameGroup.fixes[0].description, 'set name="Expected"');
    assert.ok(applyEdits(text, combinedFormatterEdits(text, 'Expected', {})).includes('name="Expected"'));
});

test('report name is inserted when the attribute is missing', () => {
    const text = '<jasperReport uuid="x"><detail/></jasperReport>';
    const applied = applyEdits(text, combinedFormatterEdits(text, 'Expected', {}));
    assert.match(applied, /^<jasperReport name="Expected" uuid="x">/);
});

test('report name is left alone when it already matches', () => {
    const text = '<jasperReport name="Fmt"><detail/></jasperReport>';
    assert.deepStrictEqual(discoverFormatFixes(text, 'Fmt', {}), []);
});

test('handles single-quoted attributes', () => {
    const text = "<jasperReport name='Fmt'><detail><element kind='textField' uuid='u' x='0'/></detail></jasperReport>";
    const applied = applyEdits(text, combinedFormatterEdits(text, 'Fmt', {}));
    assert.match(applied, /uuid='u' positionType="Float"/);
});

test('an empty attribute value is filled in rather than duplicated', () => {
    const text = '<jasperReport name="Fmt"><detail><element kind="textField" positionType="" textAdjust=""/></detail></jasperReport>';
    const applied = applyEdits(text, combinedFormatterEdits(text, 'Fmt', {}));

    assert.match(applied, /positionType="Float"/);
    assert.match(applied, /textAdjust="StretchHeight"/);
});

test('both attribute fixes on one self-closing textField do not overlap', () => {
    const text = '<jasperReport name="Fmt"><element kind="textField"/></jasperReport>';
    const edits = combinedFormatterEdits(text, 'Fmt', {});

    for (let i = 1; i < edits.length; i++) {
        assert.ok(edits[i].start >= edits[i - 1].end, 'edits must not overlap');
    }

    const applied = applyEdits(text, edits);
    assert.match(applied, /positionType="Float"/);
    assert.match(applied, /textAdjust="StretchHeight"/);
    assert.match(applied, /<element [^>]*\/>/);
});

test('each format rule can be switched off', () => {
    assert.deepStrictEqual(labels(discoverFormatFixes(FMT, 'Fmt', { positionType: false })),
        ['textAdjust', 'expression formatting']);
    assert.deepStrictEqual(labels(discoverFormatFixes(FMT, 'Fmt', { textAdjust: false })),
        ['positionType', 'expression formatting']);
    assert.deepStrictEqual(labels(discoverFormatFixes(FMT, 'Fmt', { expression: false })),
        ['positionType', 'textAdjust']);
    assert.deepStrictEqual(labels(discoverFormatFixes('<jasperReport name="Other"/>', 'Fmt', { reportName: false })), []);
});

// ── textcheck group ───────────────────────────────────────────────────────────

test('textcheck reports the hook descriptions', () => {
    const text = [
        '<jasperReport name="Tc">',
        '  <title>',
        '    <band height="40">',
        '      <element kind="staticText" markup="styled" x="0" y="0" width="100" height="20">',
        '        <text><![CDATA[A\u00A0B  C.Today<br/>D]]></text>',
        '      </element>',
        '      <element kind="textField" x="0" y="20" width="100" height="20">',
        '        <expression><![CDATA["x  y.Z" + $F{a}]]></expression>',
        '      </element>',
        '    </band>',
        '  </title>',
        '</jasperReport>',
    ].join('\n');

    const groups = discoverTextcheckFixes(text, {});
    assert.deepStrictEqual(labels(groups), ['textcheck']);
    assert.deepStrictEqual(groups[0].fixes.map(f => f.description), [
        'replace non-breaking space (U+00A0) with " ", add space after \'.\' (1 occurrence), remove double space (1 occurrence)',
        'add space after \'.\' (1 occurrence), remove double space (1 occurrence)',
    ]);

    const applied = applyEdits(text, combinedFormatterEdits(text, 'Tc', {}));
    assert.ok(applied.includes('A B C. Today<br/>D'));
    assert.ok(applied.includes('"x y. Z" + $F{a}'));
});

test('textcheck can be switched off', () => {
    const text = '<jasperReport name="T"><text><![CDATA[a  b]]></text></jasperReport>';
    assert.deepStrictEqual(discoverTextcheckFixes(text, { textcheck: false }), []);
    assert.ok(discoverTextcheckFixes(text, {}).length === 1);
});

// ── combined provider edits ───────────────────────────────────────────────────

test('combined edits reproduce the hook format output exactly', () => {
    assert.strictEqual(applyEdits(FMT, combinedFormatterEdits(FMT, 'Fmt', {})), FMT_FORMATTED);
});

test('combined edits are sorted and non-overlapping', () => {
    const edits = combinedFormatterEdits(FMT, 'Fmt', {});
    for (let i = 1; i < edits.length; i++) {
        assert.ok(edits[i].start >= edits[i - 1].end);
    }
});

test('formatting is idempotent', () => {
    const once = applyEdits(FMT, combinedFormatterEdits(FMT, 'Fmt', {}));
    assert.deepStrictEqual(combinedFormatterEdits(once, 'Fmt', {}), []);
});

test('malformed XML produces no edits', () => {
    assert.deepStrictEqual(combinedFormatterEdits('<r><a></b></r>', 'r', {}), []);
    assert.deepStrictEqual(discoverFormatFixes('<r><a></b></r>', 'r', {}), []);
    assert.deepStrictEqual(discoverTextcheckFixes('<r><a></b></r>', {}), []);
});
