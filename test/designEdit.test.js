// test/designEdit.test.js
// Pure offset-edit tests for the design view geometry/property/content engine.

const test   = require('node:test');
const assert = require('node:assert');

const {
    buildElementPatch,
    escapeXmlAttr,
    escapeXmlText,
    splitCdata,
    MAX_CONTENT,
} = require('../designEdit');
const { buildDesignModel } = require('../designModel');
const { applyEdits } = require('../edits');
const { scanXml } = require('../xmlspan');

function report(inner) {
    return [
        '<jasperReport name="R" pageWidth="300" pageHeight="400"',
        ' leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20">',
        `<detail><band height="100">${inner}</band></detail>`,
        '</jasperReport>',
    ].join('');
}

function elementOffset(text, occurrence = 0) {
    let index = -1;
    for (let i = 0; i <= occurrence; i++) index = text.indexOf('<element', index + 1);
    assert.ok(index >= 0, 'element not found');
    return index;
}

function run(text, patch, offset = elementOffset(text)) {
    const result = buildElementPatch(text, offset, patch);
    assert.strictEqual(result.error, null, result.error || 'unexpected error');
    return applyEdits(text, result.edits);
}

function expectError(text, patch, pattern, offset = elementOffset(text)) {
    const result = buildElementPatch(text, offset, patch);
    assert.ok(result.error, 'expected an error');
    if (pattern) assert.match(result.error, pattern);
    assert.deepStrictEqual(result.edits, []);
}

test('replaces existing geometry values', () => {
    const text = report(
        '<element kind="textField" x="1" y="2" width="30" height="40">' +
        '<expression><![CDATA[$F{x}]]></expression></element>'
    );
    const out = run(text, { geometry: { x: 10, y: 20, width: 50, height: 60 } });

    assert.ok(out.includes('<element kind="textField" x="10" y="20" width="50" height="60">'));
});

test('preserves the existing quote style', () => {
    const text = report(
        "<element kind='textField' x='1' y='2' width='30' height='40'>" +
        "<expression><![CDATA[$F{x}]]></expression></element>"
    );
    const out = run(text, { geometry: { x: 10, width: 50 } });

    assert.ok(out.includes("x='10'"));
    assert.ok(out.includes("width='50'"));
    assert.ok(out.includes("y='2'"));
});

test('inserts missing geometry attributes on open and self-closing tags', () => {
    const open = report('<element kind="staticText" x="0"><text>Hi</text></element>');
    const openOut = run(open, { geometry: { x: 0, y: 5, width: 10, height: 15 } });
    assert.ok(openOut.includes('<element kind="staticText" x="0" y="5" width="10" height="15"><text>Hi</text></element>'));

    const self = report('<element kind="image"/>');
    const selfOut = run(self, { geometry: { x: 1, y: 2, width: 3, height: 4 } });
    assert.ok(selfOut.includes('<element kind="image" x="1" y="2" width="3" height="4"/>'));
    assert.strictEqual(scanXml(selfOut).error, null);
});

test('clamps geometry to non-negative coordinates and a minimum size', () => {
    const text = report('<element kind="rectangle" x="1" y="2" width="10" height="20"/>');
    const out = run(text, { geometry: { x: -5, y: -2, width: 0, height: -3 } });

    assert.ok(out.includes('x="0"'));
    assert.ok(out.includes('y="0"'));
    assert.ok(out.includes('width="1"'));
    assert.ok(out.includes('height="1"'));
});

test('changes only the frame child, not the frame', () => {
    const text = report(
        '<element kind="frame" x="10" y="10" width="100" height="100">' +
        '<element kind="textField" x="1" y="2" width="30" height="40">' +
        '<expression><![CDATA["x"]]></expression></element></element>'
    );
    const out = run(text, { geometry: { x: 5 } }, elementOffset(text, 1));

    assert.ok(out.includes('<element kind="frame" x="10" y="10" width="100" height="100">'));
    assert.ok(out.includes('<element kind="textField" x="5" y="2" width="30" height="40">'));
});

test('rejects invalid geometry and stale element offsets', () => {
    const text = report('<element kind="textField" x="0" y="0" width="10" height="10"/>');

    expectError(text, { geometry: { x: 'abc' } }, /must be a number/);
    expectError(text, { geometry: { nope: 1 } }, /Unknown geometry field/);
    expectError(text, { geometry: { x: 1 } }, /moved|changed/i, 0);
    expectError(text, {} , /nothing to apply/i);
    expectError(text, { nope: {} }, /Unknown edit type/);
});

test('returns no edits when nothing changes', () => {
    const text = report('<element kind="textField" x="0" y="0" width="10" height="10"/>');
    const result = buildElementPatch(text, elementOffset(text), {
        geometry: { x: 0, y: 0, width: 10, height: 10 },
    });

    assert.strictEqual(result.error, null);
    assert.deepStrictEqual(result.edits, []);
});

test('writes and canonicalizes visual properties', () => {
    const text = report('<element kind="staticText" x="0" y="0" width="10" height="10"><text>Hi</text></element>');
    const out = run(text, {
        properties: {
            fontName:      'A & "B"',
            fontSize:      12.5,
            bold:          true,
            italic:        false,
            underline:     true,
            strikeThrough: false,
            forecolor:     '#aabbcc',
            backcolor:     '#112233',
            hTextAlign:    'center',
            vTextAlign:    'MIDDLE',
            rotation:      'upsideDown',
            markup:        'HTML',
            mode:          'opaque',
        },
    });

    assert.ok(out.includes('fontName="A &amp; &quot;B&quot;"'));
    assert.ok(out.includes('fontSize="12.5"'));
    assert.ok(out.includes('bold="true"'));
    assert.ok(out.includes('italic="false"'));
    assert.ok(out.includes('underline="true"'));
    assert.ok(out.includes('strikeThrough="false"'));
    assert.ok(out.includes('forecolor="#aabbcc"'));
    assert.ok(out.includes('backcolor="#112233"'));
    assert.ok(out.includes('hTextAlign="Center"'));
    assert.ok(out.includes('vTextAlign="Middle"'));
    assert.ok(out.includes('rotation="UpsideDown"'));
    assert.ok(out.includes('markup="html"'));
    assert.ok(out.includes('mode="Opaque"'));
    assert.strictEqual(scanXml(out).error, null);
});

test('rejects invalid property values', () => {
    const text = report('<element kind="textField" x="0" y="0" width="10" height="10"/>');

    expectError(text, { properties: { fontName: '   ' } }, /cannot be empty/);
    expectError(text, { properties: { fontSize: 0 } }, /Font size/);
    expectError(text, { properties: { forecolor: 'red' } }, /Colors/);
    expectError(text, { properties: { rotation: 'Sideways' } }, /Allowed values/);
    expectError(text, { properties: { bold: 'true' } }, /true or false/);
    expectError(text, { properties: { nope: 'x' } }, /Unknown property/);
});

test('leaves a property alone when it already has the canonical value', () => {
    const text = report('<element kind="textField" bold="false" x="0" y="0" width="10" height="10"/>');
    const result = buildElementPatch(text, elementOffset(text), { properties: { bold: false } });

    assert.strictEqual(result.error, null);
    assert.deepStrictEqual(result.edits, []);
});

test('replaces CDATA content without losing the CDATA wrapper', () => {
    const text = report(
        '<element kind="textField" x="0" y="0" width="10" height="10">' +
        '<expression><![CDATA[$F{x}]]></expression></element>'
    );
    const out = run(text, { content: { text: '$F{y} + "a["' } });

    assert.ok(out.includes('<expression><![CDATA[$F{y} + "a["]]></expression>'));
});

test('escapes plain text content and splits a CDATA terminator', () => {
    const plain = report(
        '<element kind="textField" x="0" y="0" width="10" height="10"><expression>old</expression></element>'
    );
    const plainOut = run(plain, { content: { text: 'a & b < c' } });
    assert.ok(plainOut.includes('<expression>a &amp; b &lt; c</expression>'));

    const cdata = report(
        '<element kind="staticText" x="0" y="0" width="10" height="10"><text><![CDATA[old]]></text></element>'
    );
    const cdataOut = run(cdata, { content: { text: 'a]]>b' } });
    assert.ok(cdataOut.includes('<![CDATA[a]]]]><![CDATA[>b]]>'));
    assert.strictEqual(scanXml(cdataOut).error, null);
});

test('creates missing content on open and self-closing elements', () => {
    const open = report(
        '<element kind="textField" x="0" y="0" width="10" height="10">' +
        '<property name="p" value="v"/></element>'
    );
    const openOut = run(open, { content: { text: '$F{x}' } });
    assert.ok(openOut.includes(
        '<property name="p" value="v"/><expression><![CDATA[$F{x}]]></expression></element>'
    ));
    assert.strictEqual(scanXml(openOut).error, null);

    const self = report('<element kind="image" x="0" y="0" width="10" height="10"/>');
    const selfOut = run(self, { content: { text: 'logo.png' } });
    assert.ok(selfOut.includes(
        '<element kind="image" x="0" y="0" width="10" height="10">' +
        '<expression><![CDATA[logo.png]]></expression></element>'
    ));
    assert.strictEqual(scanXml(selfOut).error, null);
});

test('rewrites a self-closing content tag', () => {
    const text = report(
        '<element kind="textField" x="0" y="0" width="10" height="10"><expression/></element>'
    );
    const out = run(text, { content: { text: 'x' } });

    assert.ok(out.includes('<expression><![CDATA[x]]></expression>'));
    assert.strictEqual(scanXml(out).error, null);
});

test('refuses content that cannot be represented safely', () => {
    const text = report('<element kind="staticText" x="0" y="0" width="10" height="10"><text><b>n</b></text></element>');
    expectError(text, { content: { text: 'x' } }, /nested markup/);

    const mixed = report(
        '<element kind="staticText" x="0" y="0" width="10" height="10">' +
        '<text>plain<![CDATA[cdata]]></text></element>'
    );
    expectError(mixed, { content: { text: 'x' } }, /mixes CDATA/);

    const long = report('<element kind="staticText" x="0" y="0" width="10" height="10"><text>Hi</text></element>');
    expectError(long, { content: { text: 'x'.repeat(MAX_CONTENT + 1) } }, /longer/);

    const component = report('<element kind="component" x="0" y="0" width="10" height="10"/>');
    expectError(component, { content: { text: 'x' } }, /editable content/);
});

test('writes the extended element property set', () => {
    const text = report('<element kind="textField" x="0" y="0" width="10" height="10"/>');
    const out = run(text, {
        properties: {
            positionType:             'Float',
            stretchType:              'ElementGroupHeight',
            printRepeatedValues:      false,
            removeLineWhenBlank:      true,
            printInFirstWholeBand:    true,
            printWhenDetailOverflows: true,
            printWhenGroupChanges:    'Group1',
            evaluationTime:           'Report',
            evaluationGroup:          'Group1',
            bookmarkLevel:            2,
            key:                      'myKey',
            style:                    'myStyle',
            textAdjust:               'StretchHeight',
            pattern:                  '#,##0.00',
            blankWhenNull:            true,
            scaleImage:               'Clip',
            hImageAlign:              'Center',
            vImageAlign:              'Middle',
            onErrorType:              'Icon',
            usingCache:               false,
            lazy:                     true,
            linkType:                 'Reference',
            runToBottom:              true,
            direction:                'BottomUp',
            radius:                   12,
            type:                     'Page',
        },
    });

    for (const attr of [
        'positionType="Float"', 'stretchType="ElementGroupHeight"',
        'printRepeatedValues="false"', 'removeLineWhenBlank="true"',
        'printInFirstWholeBand="true"', 'printWhenDetailOverflows="true"',
        'printWhenGroupChanges="Group1"', 'evaluationTime="Report"',
        'evaluationGroup="Group1"', 'bookmarkLevel="2"', 'key="myKey"',
        'style="myStyle"', 'textAdjust="StretchHeight"',
        'pattern="#,##0.00"', 'blankWhenNull="true"', 'scaleImage="Clip"',
        'hImageAlign="Center"', 'vImageAlign="Middle"',
        'onErrorType="Icon"', 'usingCache="false"', 'lazy="true"',
        'linkType="Reference"', 'runToBottom="true"',
        'direction="BottomUp"', 'radius="12"', 'type="Page"',
    ]) {
        assert.ok(out.includes(attr), `missing ${attr}`);
    }
    assert.strictEqual(scanXml(out).error, null);
});

test('accepts an empty pattern and rejects invalid extended values', () => {
    const text = report('<element kind="textField" x="0" y="0" width="10" height="10"/>');

    const out = run(text, { properties: { pattern: '' } });
    assert.ok(out.includes('pattern=""'));

    expectError(text, { properties: { bookmarkLevel: -1 } }, /between/);
    expectError(text, { properties: { radius: 'wide' } }, /number/);
    expectError(text, { properties: { style: '  ' } }, /cannot be empty/);
    expectError(text, { properties: { key: '' } }, /cannot be empty/);
    expectError(text, { properties: { evaluationTime: 'Later' } }, /Allowed values/);
});

test('sets and removes arbitrary attributes', () => {
    const text = report('<element kind="staticText" id="a" x="0" y="0" width="10" height="10"><text>Hi</text></element>');
    const out = run(text, {
        attributes: {
            set:    { 'data-custom': 'a & "b"', x: '5' },
            remove: ['id'],
        },
    });

    assert.ok(out.includes(' data-custom="a &amp; &quot;b&quot;"'), 'new attribute was not escaped');
    assert.ok(out.includes(' x="5"'), 'existing attribute was not set');
    assert.ok(!out.includes(' id="a"'), 'attribute was not removed');
    assert.strictEqual(scanXml(out).error, null);
});

test('round-trips entity-bearing attributes without re-encoding them', () => {
    const text = report(
        '<element kind="textField" key="a &amp; b &lt;c&gt; &quot;d&quot;" x="0" y="0" width="10" height="10">' +
        '<expression><![CDATA["x"]]></expression></element>'
    );
    const element = buildDesignModel(text).bands[0].elements[0];
    assert.strictEqual(element.attrs.key, 'a & b <c> "d"');

    const unchanged = buildElementPatch(text, elementOffset(text), {
        attributes: { set: { key: element.attrs.key } },
    });
    assert.strictEqual(unchanged.error, null);
    assert.deepStrictEqual(unchanged.edits, [], 'resubmitting a decoded value must not rewrite the source');

    const out = run(text, { attributes: { set: { key: 'a & <b> "c"' } } });
    assert.ok(out.includes('key="a &amp; &lt;b&gt; &quot;c&quot;"'), 'changed values must be escaped exactly once');
    assert.strictEqual(buildDesignModel(out).bands[0].elements[0].attrs.key, 'a & <b> "c"');
    assert.strictEqual(scanXml(out).error, null);
});

test('encodes a literal source ampersand once when an attribute is edited', () => {
    const text = report(
        '<element kind="textField" key="a & b" x="0" y="0" width="10" height="10">' +
        '<expression><![CDATA["x"]]></expression></element>'
    );
    const element = buildDesignModel(text).bands[0].elements[0];
    assert.strictEqual(element.attrs.key, 'a & b');

    const out = run(text, { attributes: { set: { key: element.attrs.key } } });
    assert.ok(out.includes('key="a &amp; b"'), 'the literal ampersand must be encoded once');
    assert.ok(!out.includes('&amp;amp;'));
});

test('round-trips inspector text properties with entities', () => {
    const text = report(
        '<element kind="textField" key="a &amp; b" printWhenGroupChanges="G &amp; H"' +
        ' x="0" y="0" width="10" height="10">' +
        '<expression><![CDATA["x"]]></expression></element>'
    );
    const element = buildDesignModel(text).bands[0].elements[0];
    assert.strictEqual(element.attrs.key, 'a & b');
    assert.strictEqual(element.attrs.printWhenGroupChanges, 'G & H');

    const unchanged = buildElementPatch(text, elementOffset(text), {
        properties: { key: element.attrs.key, printWhenGroupChanges: element.attrs.printWhenGroupChanges },
    });
    assert.strictEqual(unchanged.error, null);
    assert.deepStrictEqual(unchanged.edits, []);

    const out = run(text, {
        properties: { key: 'x & y', printWhenGroupChanges: 'G < H' },
    });
    assert.ok(out.includes('key="x &amp; y"'));
    assert.ok(out.includes('printWhenGroupChanges="G &lt; H"'));
    assert.ok(!out.includes('&amp;amp;'));
    assert.strictEqual(scanXml(out).error, null);
});

test('rejects unsafe attribute edits', () => {
    const text = report('<element kind="textField" x="0" y="0" width="10" height="10"/>');

    expectError(text, { attributes: { set: { kind: 'staticText' } } }, /kind/);
    expectError(text, { attributes: { set: { xmlns: 'x' } } }, /Namespace/);
    expectError(text, { attributes: { set: { 'bad name': 'x' } } }, /not valid/);
    expectError(text, { attributes: { set: { key: 1 } } }, /string/);
    expectError(text, { attributes: { set: { key: 'x' }, remove: ['key'] } }, /cannot be set and removed/);
});

test('creates and updates a box border and padding', () => {
    const open = report('<element kind="staticText" x="0" y="0" width="10" height="10"><text>Hi</text></element>');
    const out = run(open, {
        box: { border: true, padding: 3, width: 1, style: 'Solid', color: '#ff0000' },
    });
    assert.ok(out.includes(
        '<box padding="3"><pen lineWidth="1" lineStyle="Solid" lineColor="#ff0000"/></box>'
    ));
    assert.strictEqual(scanXml(out).error, null);

    const existing = report(
        '<element kind="staticText" x="0" y="0" width="10" height="10">' +
        '<box style="Styled"><bottomPen lineWidth="2.0" lineStyle="Dashed"/></box>' +
        '<text>Hi</text></element>'
    );
    const updated = run(existing, { box: { border: false, padding: 5 } });
    assert.ok(updated.includes('<box style="Styled" padding="5"/>'));
    assert.ok(!updated.includes('bottomPen'));
});

test('opens a self-closing element when adding a box and removes an empty box', () => {
    const self = report('<element kind="image" x="0" y="0" width="10" height="10"/>');
    const out = run(self, { box: { border: true, width: 2, style: 'Dashed', color: '#00ff00' } });
    assert.ok(out.includes(
        '<element kind="image" x="0" y="0" width="10" height="10">' +
        '<box><pen lineWidth="2" lineStyle="Dashed" lineColor="#00ff00"/></box></element>'
    ));
    assert.strictEqual(scanXml(out).error, null);

    const boxed = report(
        '<element kind="staticText" x="0" y="0" width="10" height="10">' +
        '<box><pen lineWidth="1.0"/></box><text>Hi</text></element>'
    );
    const removed = run(boxed, { box: { border: false, padding: 0 } });
    assert.ok(!removed.includes('<box'));
    assert.strictEqual(scanXml(removed).error, null);
});

test('rejects a box with unsupported nested elements', () => {
    const text = report(
        '<element kind="staticText" x="0" y="0" width="10" height="10">' +
        '<box><paragraph/></box><text>Hi</text></element>'
    );
    expectError(text, { box: { border: true, padding: 1 } }, /nested elements/);
});

test('creates and updates a line pen', () => {
    const self = report('<element kind="line" x="0" y="10" width="100" height="1"/>');
    const out = run(self, { line: { width: 2, style: 'Dashed', color: '#ff0000' } });
    assert.ok(out.includes(
        '<element kind="line" x="0" y="10" width="100" height="1">' +
        '<pen lineWidth="2" lineStyle="Dashed" lineColor="#ff0000"/></element>'
    ));

    const existing = report(
        '<element kind="line" x="0" y="10" width="100" height="1"><pen lineWidth="1.0"/></element>'
    );
    const updated = run(existing, { line: { width: 4, style: 'Solid' } });
    assert.ok(updated.includes('<pen lineWidth="4" lineStyle="Solid"/>'));
    assert.strictEqual(scanXml(updated).error, null);
    expectError(self, { line: { style: 'Wavy' } }, /Line style/);
});

test('combines geometry and properties in one patch', () => {
    const text = report('<element kind="textField" x="0" y="0" width="10" height="10"/>');
    const out = run(text, {
        geometry:   { x: 5, width: 20 },
        properties: { bold: true },
    });

    assert.ok(out.includes('x="5"'));
    assert.ok(out.includes('width="20"'));
    assert.ok(out.includes('bold="true"'));
});

test('exports safe escaping helpers', () => {
    assert.strictEqual(escapeXmlAttr('a&<>"'), 'a&amp;&lt;&gt;&quot;');
    assert.strictEqual(escapeXmlText('a&<>'), 'a&amp;&lt;&gt;');
    assert.strictEqual(splitCdata('a]]>b'), 'a]]]]><![CDATA[>b');
});
