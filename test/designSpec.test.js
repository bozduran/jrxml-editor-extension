// test/designSpec.test.js
// Contract test for the vocabulary shared by the design model and edit engine.

const test   = require('node:test');
const assert = require('node:assert');

const {
    MAX_CONTENT,
    CONTENT_TAG_BY_KIND,
} = require('../designSpec');
const {
    buildDesignModel,
    MAX_CONTENT: MODEL_MAX_CONTENT,
} = require('../designModel');
const {
    buildElementPatch,
    MAX_CONTENT: EDIT_MAX_CONTENT,
} = require('../designEdit');
const { applyEdits } = require('../edits');

function report(inner) {
    return '<jasperReport name="R" pageWidth="300" pageHeight="400" columnWidth="260"' +
        ' leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20">' +
        `<detail><band height="20">${inner}</band></detail></jasperReport>`;
}

test('the model and editor share the content limit', () => {
    assert.strictEqual(MODEL_MAX_CONTENT, MAX_CONTENT);
    assert.strictEqual(EDIT_MAX_CONTENT, MAX_CONTENT);
    assert.strictEqual(MAX_CONTENT, 8000);
});

test('the model and editor agree on every editable content kind', () => {
    for (const [kind, tag] of Object.entries(CONTENT_TAG_BY_KIND)) {
        const text = report(
            `<element kind="${kind}" x="0" y="0" width="10" height="10">` +
            `<${tag}><![CDATA[old]]></${tag}></element>`
        );
        const model = buildDesignModel(text);
        const element = model.bands[0].elements[0];

        assert.ok(element.content, `${kind} should expose editable content`);
        assert.strictEqual(element.content.tag, tag, `${kind} content tag`);
        assert.strictEqual(element.content.editable, true, `${kind} should be editable`);

        const result = buildElementPatch(text, text.indexOf('<element'), {
            content: { text: 'new' },
        });
        assert.strictEqual(result.error, null, `${kind}: ${result.error}`);
        const updated = applyEdits(text, result.edits);
        assert.ok(
            updated.includes(`<${tag}><![CDATA[new]]></${tag}>`),
            `${kind} edit did not update <${tag}>`
        );
    }
});
