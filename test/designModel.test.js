// test/designModel.test.js
// Unit tests for the pure Studio 7 JRXML design model.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const {
    buildDesignModel,
    findSelectionTarget,
    decodeXmlEntities,
    flattenMarkup,
    localName,
    MAX_ELEMENTS,
    MAX_TEXT,
    MAX_CONTENT,
} = require('../designModel');

function fixture(name) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function allElements(bands) {
    const out = [];
    const visit = (elements) => {
        for (const element of elements) {
            out.push(element);
            visit(element.children || []);
        }
    };
    for (const band of bands) visit(band.elements);
    return out;
}

function report(inner, attrs = '') {
    return `<jasperReport name="R" pageWidth="300" pageHeight="400" columnWidth="260" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20"${attrs}>${inner}</jasperReport>`;
}

test('reads a Studio 7 report: page, bands and elements', () => {
    const text  = fixture('Blank_A4_1.jrxml');
    const model = buildDesignModel(text);

    assert.strictEqual(model.format, 'studio7');
    assert.strictEqual(model.error, null);
    assert.strictEqual(model.unsupported, null);
    assert.strictEqual(model.report.name, 'Blank_A4_1');
    assert.strictEqual(model.report.pageWidth, 595);
    assert.strictEqual(model.report.pageHeight, 842);
    assert.strictEqual(model.report.columnWidth, 555);
    assert.strictEqual(model.report.leftMargin, 20);
    assert.strictEqual(model.report.rightMargin, 20);
    assert.strictEqual(model.report.topMargin, 20);
    assert.strictEqual(model.report.bottomMargin, 20);

    // Blank_A4_1 has two detail bands; both must be represented.
    assert.deepStrictEqual(
        model.bands.map(band => band.key),
        ['background', 'title', 'pageHeader', 'columnHeader', 'detail', 'detail', 'columnFooter', 'pageFooter', 'summary']
    );
    assert.deepStrictEqual(
        model.bands.filter(band => band.key === 'detail').map(band => band.label),
        ['Detail (1)', 'Detail (2)']
    );

    const title = model.bands.find(band => band.key === 'title');
    assert.strictEqual(title.height, 81);
    assert.deepStrictEqual(title.elements.map(element => element.kind), ['textField', 'staticText', 'break']);
    assert.match(title.elements[0].displayText, /^"Text Field"/);
    assert.strictEqual(title.elements[1].displayText, 'Static Text');

    const detail  = model.bands.find(band => band.key === 'detail');
    const frame   = detail.elements.find(element => element.kind === 'frame');
    assert.strictEqual(detail.height, 607);
    assert.ok(frame, 'the frame element should be parsed');
    assert.deepStrictEqual(frame.children.map(element => element.kind), ['textField', 'textField', 'subreport']);
    assert.strictEqual(frame.children[2].displayText, 'subreport');
    assert.strictEqual(model.counts.bands, model.bands.length);
    assert.ok(model.counts.elements > 0);
});

test('element offsets point at the source start tags', () => {
    const text   = fixture('Blank_A4_1.jrxml');
    const model  = buildDesignModel(text);
    const elements = allElements(model.bands);

    assert.ok(elements.length > 0);
    for (const element of elements) {
        assert.ok(element.end >= element.offset);
        assert.strictEqual(text.slice(element.offset, element.offset + '<element'.length).toLowerCase(), '<element');
        assert.ok(text.slice(element.offset, element.end).startsWith('<element'));
    }

    for (const band of model.bands) {
        assert.ok(band.end >= band.offset);
        assert.strictEqual(text[band.offset], '<');
    }
});

test('orders group headers before detail and footers in reverse group order', () => {
    const text = report(`
        <group name="A">
            <groupHeader><band height="10"/></groupHeader>
            <groupFooter><band height="11"/></groupFooter>
        </group>
        <group name="B">
            <groupHeader><band height="12"/></groupHeader>
            <groupFooter><band height="13"/></groupFooter>
        </group>
        <detail><band height="14"/></detail>
    `);
    const model = buildDesignModel(text);

    assert.deepStrictEqual(model.bands.map(band => band.label), [
        'Group A Header',
        'Group B Header',
        'Detail',
        'Group B Footer',
        'Group A Footer',
    ]);
    assert.deepStrictEqual(model.bands.map(band => band.group), ['A', 'B', '', 'B', 'A']);
});

test('reads group bands, default styles and alignment from TextReport', () => {
    const model = buildDesignModel(fixture('TextReport.jrxml'));

    assert.strictEqual(model.report.pageWidth, 798);
    assert.strictEqual(model.report.pageHeight, 1000);
    assert.strictEqual(model.report.leftMargin, 42);
    assert.strictEqual(model.report.topMargin, 70);

    const header = model.bands.find(band => band.label === 'Group CityGroup Header');
    const footer = model.bands.find(band => band.label === 'Group CityGroup Footer');
    assert.ok(header && footer);
    assert.strictEqual(header.height, 14);
    assert.strictEqual(footer.height, 14);

    const footerLabel = footer.elements.find(element => element.kind === 'staticText');
    assert.strictEqual(footerLabel.displayText, 'Count : ');
    assert.strictEqual(footerLabel.style.hAlign, 'right');

    const titleField = model.bands.find(band => band.key === 'title').elements[0];
    assert.strictEqual(titleField.style.hAlign, 'center');
    assert.strictEqual(titleField.style.vAlign, 'middle');

    // FixSizeFontStyle is the report's default style.
    assert.strictEqual(titleField.style.fontFamily, '"DejaVu Sans Mono", monospace');
    assert.strictEqual(titleField.style.fontSize, 12);

    assert.deepStrictEqual(model.warnings, []);
    assert.strictEqual(model.truncated, false);
});

test('resolves named styles and lets element attributes override them', () => {
    const text = report(`
        <style name="Big" fontName="Arial" fontSize="20" bold="true" forecolor="#ff0000"/>
        <detail>
            <band height="20">
                <element kind="textField" style="Big" x="0" y="0" width="10" height="10">
                    <expression><![CDATA[$F{x}]]></expression>
                </element>
                <element kind="textField" style="Big" fontSize="8" x="0" y="10" width="10" height="10">
                    <expression><![CDATA[$F{y}]]></expression>
                </element>
            </band>
        </detail>
    `);
    const [styled, overridden] = buildDesignModel(text).bands[0].elements;

    assert.strictEqual(styled.style.fontFamily, '"Arial", sans-serif');
    assert.strictEqual(styled.style.fontSize, 20);
    assert.strictEqual(styled.style.bold, true);
    assert.strictEqual(styled.style.forecolor, '#ff0000');
    assert.strictEqual(overridden.style.fontSize, 8);
    assert.strictEqual(overridden.style.bold, true);
});

test('flattens styled/highlighted markup and keeps markup="none" text literal', () => {
    const model  = buildDesignModel(fixture('MarkupReport.jrxml'));
    const title  = model.bands.find(band => band.key === 'title');
    const styled = title.elements.find(element => element.kind === 'staticText');

    assert.strictEqual(styled.style.markup, 'styled');
    assert.strictEqual(styled.style.mode, 'Opaque');
    assert.strictEqual(styled.style.backcolor, '#C0C0C0');
    assert.strictEqual(styled.style.fontSize, 16);
    assert.match(styled.displayText, /static text/);
    assert.match(styled.displayText, /hyperlinks/);
    assert.ok(!styled.displayText.includes('<style'), 'markup tags must be flattened');
    assert.ok(!styled.displayText.includes('<a '), 'links must be flattened');

    const text = report(`
        <detail>
            <band height="20">
                <element kind="staticText" markup="none" x="0" y="0" width="100" height="10">
                    <text><![CDATA[&lt;b&gt;literal&lt;/b&gt; &amp; more]]></text>
                </element>
            </band>
        </detail>
    `);
    const literal = buildDesignModel(text).bands[0].elements[0];
    assert.strictEqual(literal.displayText, '<b>literal</b> & more');
});

test('reads component placeholders without emitting their contents', () => {
    const model = buildDesignModel(fixture('DatasetScopeReport.jrxml'));
    const detail = model.bands.find(band => band.key === 'detail');

    assert.strictEqual(detail.elements.length, 1);
    assert.strictEqual(detail.elements[0].kind, 'component');
    assert.strictEqual(detail.elements[0].displayText, 'list');
    assert.strictEqual(detail.elements[0].children.length, 0);
});

test('reads shapes and placeholder elements', () => {
    const text = report(`
        <detail>
            <band height="100">
                <element kind="image" x="0" y="0" width="20" height="20">
                    <expression><![CDATA["logo.png"]]></expression>
                </element>
                <element kind="line" x="0" y="25" width="100" height="40" direction="BottomUp" forecolor="#00ff00">
                    <pen lineWidth="2.0" lineStyle="Dashed"/>
                </element>
                <element kind="rectangle" x="0" y="30" width="50" height="20" mode="Opaque" backcolor="#abcdef">
                    <box><pen lineWidth="1.0" lineStyle="Dashed" lineColor="#ff0000"/></box>
                </element>
                <element kind="ellipse" x="60" y="30" width="20" height="20"/>
                <element kind="break" x="0" y="60" width="100" height="1"/>
                <element kind="mystery" x="0" y="70" width="10" height="10"/>
            </band>
        </detail>
    `);
    const [image, line, rectangle, ellipse, pageBreak, mystery] = buildDesignModel(text).bands[0].elements;

    assert.strictEqual(image.displayText, 'logo.png');
    assert.strictEqual(line.kind, 'line');
    assert.strictEqual(line.line.direction, 'BottomUp');
    assert.strictEqual(line.line.width, 2);
    assert.strictEqual(line.line.style, 'dashed');
    assert.strictEqual(line.line.color, '#00ff00');
    assert.strictEqual(rectangle.kind, 'rectangle');
    assert.strictEqual(rectangle.style.mode, 'Opaque');
    assert.strictEqual(rectangle.style.backcolor, '#abcdef');
    assert.deepStrictEqual(rectangle.box, {
        top: true, right: true, bottom: true, left: true,
        border: true, width: 1, padding: 0,
        color: '#ff0000', lineStyle: 'dashed',
    });
    assert.strictEqual(ellipse.kind, 'ellipse');
    assert.strictEqual(pageBreak.kind, 'break');
    assert.strictEqual(mystery.displayText, 'mystery');
});

test('reports classic JRXML as unsupported instead of half-rendering it', () => {
    const classic = [
        '<jasperReport name="Classic">',
        '  <title><band height="20">',
        '    <staticText><reportElement x="0" y="0" width="10" height="10"/><text>Hi</text></staticText>',
        '  </band></title>',
        '</jasperReport>',
    ].join('\n');
    const model = buildDesignModel(classic);

    assert.strictEqual(model.format, 'classic');
    assert.strictEqual(model.unsupported, 'classic');
    assert.strictEqual(model.error, null);
    assert.deepStrictEqual(model.bands, []);

    const wrapperOnly = '<jasperReport name="C"><detail><band><staticText><text>x</text></staticText></band></detail></jasperReport>';
    assert.strictEqual(buildDesignModel(wrapperOnly).unsupported, 'classic');
});

test('reports malformed and unsupported documents without throwing', () => {
    assert.match(buildDesignModel('<jasperReport name="R"><detail></jasperReport>').error, /mismatched|unclosed/);
    assert.ok(buildDesignModel('').error);
    assert.match(buildDesignModel('<report name="R"/>').error, /jasperReport/);

    const empty = buildDesignModel('<jasperReport name="R"/>');
    assert.strictEqual(empty.error, null);
    assert.strictEqual(empty.format, 'studio7');
    assert.deepStrictEqual(empty.bands, []);
});

test('falls back on missing page attributes and invalid geometry', () => {
    const model = buildDesignModel('<jasperReport name="R" pageWidth="oops" pageHeight="-1" columnWidth="abc"><detail><band height="10"/></detail></jasperReport>');
    assert.strictEqual(model.report.pageWidth, 595);
    assert.strictEqual(model.report.pageHeight, 842);
    assert.strictEqual(model.report.columnWidth, 555);

    const text = report(`
        <detail>
            <band height="20">
                <element kind="textField" x="oops" y="1" width="10" height="10">
                    <expression><![CDATA[$F{x}]]></expression>
                </element>
            </band>
        </detail>
    `);
    const element = buildDesignModel(text).bands[0].elements[0];
    assert.strictEqual(element.x, 0);
    assert.strictEqual(element.y, 1);
    assert.ok(buildDesignModel(text).warnings.some(warning => /geometry/.test(warning)));
});

test('caps the rendered element count and marks truncation', () => {
    const elements = Array.from({ length: MAX_ELEMENTS + 5 }, (_, index) =>
        `<element kind="staticText" x="${index}" y="0" width="1" height="1"><text>t${index}</text></element>`
    ).join('');
    const model = buildDesignModel(report(`<detail><band height="10">${elements}</band></detail>`));

    assert.strictEqual(model.truncated, true);
    assert.strictEqual(allElements(model.bands).length, MAX_ELEMENTS);
    assert.ok(model.warnings.some(warning => /first 4000 elements/.test(warning)));
});

test('caps long text and tooltips', () => {
    const longText = 'x'.repeat(1200);
    const model = buildDesignModel(report(
        `<detail><band height="10"><element kind="staticText" x="0" y="0" width="10" height="10"><text>${longText}</text></element></band></detail>`
    ));
    const element = model.bands[0].elements[0];

    assert.strictEqual(element.displayText.length, MAX_TEXT + 1);
    assert.ok(element.displayText.endsWith('…'));
    assert.ok(element.tooltip.length <= 1500);
});

test('text helpers decode entities, flatten markup and strip tag prefixes', () => {
    assert.strictEqual(decodeXmlEntities('a &amp; b &lt;c&gt; &#65; &#x42; &unknown;'), 'a & b <c> A B &unknown;');
    assert.strictEqual(flattenMarkup('one<br/>two<BR>three<b>four</b>'), 'one\ntwo\nthreefour');
    assert.strictEqual(localName('jr:jasperReport'), 'jasperreport');
});

test('exposes editable content separate from the flattened display text', () => {
    const model = buildDesignModel(fixture('Blank_A4_1.jrxml'));
    const title = model.bands.find(band => band.key === 'title');
    const field = title.elements[0];
    const text  = title.elements[1];

    assert.strictEqual(field.content.tag, 'expression');
    assert.strictEqual(field.content.cdata, true);
    assert.strictEqual(field.content.missing, false);
    assert.strictEqual(field.content.editable, true);
    assert.match(field.content.raw, /^"Text Field"/);
    assert.strictEqual(text.content.tag, 'text');
    assert.strictEqual(text.content.raw, 'Static Text');

    const image = buildDesignModel(report(
        '<detail><band height="10"><element kind="image" x="0" y="0" width="10" height="10"/></band></detail>'
    )).bands[0].elements[0];
    assert.strictEqual(image.content.missing, true);
    assert.strictEqual(image.content.tag, 'expression');
    assert.strictEqual(image.content.raw, '');
    assert.strictEqual(image.content.editable, true);

    const line = buildDesignModel(report(
        '<detail><band height="10"><element kind="line" x="0" y="0" width="10" height="1"/></band></detail>'
    )).bands[0].elements[0];
    assert.strictEqual(line.content, null);
});

test('keeps markup raw for editing and disables unsupported content', () => {
    const markup = buildDesignModel(fixture('MarkupReport.jrxml'));
    const styled = markup.bands[0].elements.find(element => element.kind === 'staticText');
    assert.strictEqual(styled.content.tag, 'text');
    assert.ok(styled.content.raw.includes('<style'));
    assert.ok(!styled.displayText.includes('<style'));

    const nested = buildDesignModel(report(
        '<detail><band height="10"><element kind="staticText" x="0" y="0" width="10" height="10">' +
        '<text><b>nested</b></text></element></band></detail>'
    )).bands[0].elements[0].content;
    assert.strictEqual(nested.nested, true);
    assert.strictEqual(nested.editable, false);

    const mixed = buildDesignModel(report(
        '<detail><band height="10"><element kind="staticText" x="0" y="0" width="10" height="10">' +
        '<text>plain<![CDATA[cdata]]></text></element></band></detail>'
    )).bands[0].elements[0].content;
    assert.strictEqual(mixed.mixed, true);
    assert.strictEqual(mixed.editable, false);

    const long = buildDesignModel(report(
        '<detail><band height="10"><element kind="staticText" x="0" y="0" width="10" height="10">' +
        `<text>${'x'.repeat(MAX_CONTENT + 1)}</text></element></band></detail>`
    )).bands[0].elements[0].content;
    assert.strictEqual(long.truncated, true);
    assert.strictEqual(long.editable, false);
});

test('exposes raw attributes, report styles and box metadata', () => {
    const styled = buildDesignModel(report(`
        <style name="Big" fontName="Arial" fontSize="20" bold="true"/>
        <detail>
            <band height="40">
                <element kind="textField" style="Big" data-custom="v" x="0" y="0" width="10" height="10">
                    <expression><![CDATA[$F{x}]]></expression>
                </element>
            </band>
        </detail>
    `));
    const element = styled.bands.find(band => band.key === 'detail').elements[0];
    assert.deepStrictEqual(styled.styles, [{ name: 'Big', default: false }]);
    assert.strictEqual(element.attrs.kind, 'textField');
    assert.strictEqual(element.attrs.style, 'Big');
    assert.strictEqual(element.attrs['data-custom'], 'v');
    assert.strictEqual(element.style.fontSize, 20);

    assert.deepStrictEqual(
        buildDesignModel(fixture('TextReport.jrxml')).styles,
        [{ name: 'FixSizeFontStyle', default: true }]
    );

    const boxed = buildDesignModel(report(`
        <detail><band height="40">
            <element kind="staticText" x="0" y="0" width="10" height="10">
                <box padding="5">
                    <pen lineWidth="2.0" lineStyle="Dashed" lineColor="#ff0000"/>
                </box>
                <text>Hi</text>
            </element>
        </band></detail>
    `)).bands[0].elements[0];
    assert.strictEqual(boxed.box.border, true);
    assert.strictEqual(boxed.box.width, 2);
    assert.strictEqual(boxed.box.padding, 5);
    assert.strictEqual(boxed.box.lineStyle, 'dashed');
    assert.strictEqual(boxed.box.color, '#ff0000');

    const group = buildDesignModel(report(`
        <detail><band height="40">
            <element kind="elementGroup">
                <element kind="staticText" x="0" y="0" width="10" height="10"><text>Inside</text></element>
            </element>
        </band></detail>
    `)).bands[0].elements[0];
    assert.strictEqual(group.kind, 'elementGroup');
    assert.strictEqual(group.children.length, 1);
    assert.strictEqual(group.children[0].displayText, 'Inside');
});

test('findSelectionTarget resolves elements, frame children and bands', () => {
    const model = buildDesignModel(fixture('Blank_A4_1.jrxml'));
    const title = model.bands.find(band => band.key === 'title');
    const field = title.elements[0];

    assert.deepStrictEqual(
        findSelectionTarget(model, field.offset + 5),
        { kind: 'element', offset: field.offset, end: field.end }
    );

    const gap = title.elements[1].offset - 1;
    assert.strictEqual(findSelectionTarget(model, gap).kind, 'band');
    assert.strictEqual(findSelectionTarget(model, title.offset + 2).kind, 'band');

    const frame = model.bands
        .filter(band => band.key === 'detail')[0]
        .elements.find(element => element.kind === 'frame');
    assert.strictEqual(
        findSelectionTarget(model, frame.children[1].offset + 5).offset,
        frame.children[1].offset
    );

    assert.strictEqual(findSelectionTarget(model, 0), null);
    assert.strictEqual(findSelectionTarget(buildDesignModel('<jasperReport name="R"/>'), 0), null);
    assert.strictEqual(findSelectionTarget({ error: 'broken' }, 0), null);
});
