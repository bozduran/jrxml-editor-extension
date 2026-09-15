// test/xmlspan.test.js
// Unit tests for the offset-accurate XML scanner.

const test   = require('node:test');
const assert = require('node:assert');

const { scanXml, nodeAt, firstChild } = require('../xmlspan');

test('captures element spans for open/close tags', () => {
    const text = '<r><child>hi</child></r>';
    const { doc, error } = scanXml(text);
    assert.strictEqual(error, null);

    const child = doc.root.children[0];
    assert.strictEqual(child.tag, 'child');
    assert.strictEqual(text.slice(child.startTag, child.startTagEnd), '<child>');
    assert.strictEqual(text.slice(child.endTag, child.end), '</child>');
    assert.strictEqual(child.textContent(), 'hi');
});

test('captures self-closing spans', () => {
    const text = '<r><leaf a="1"/></r>';
    const { doc } = scanXml(text);
    const leaf = doc.root.children[0];
    assert.strictEqual(leaf.selfClosing, true);
    assert.strictEqual(text.slice(leaf.startTag, leaf.end), '<leaf a="1"/>');
});

test('reads attributes with either quote style and records value offsets', () => {
    const text = `<a x="1" y='two' z=""/>`;
    const { doc } = scanXml(text);
    const a = doc.root;

    assert.strictEqual(a.attrValue('x'), '1');
    assert.strictEqual(a.attrValue('y'), 'two');
    assert.strictEqual(a.attrValue('z'), '');
    assert.strictEqual(a.attrValue('missing'), undefined);

    assert.strictEqual(text.slice(a.attr('x').valueStart, a.attr('x').valueEnd), '1');
    assert.strictEqual(text.slice(a.attr('y').valueStart, a.attr('y').valueEnd), 'two');
    assert.deepStrictEqual(a.attrList.map(x => x.name), ['x', 'y', 'z']);
});

test('does not confuse an attribute name with a longer one', () => {
    const { doc } = scanXml('<field fullName="nope" name="real"/>');
    assert.strictEqual(doc.root.attrValue('name'), 'real');
});

test('kind falls back to the tag name', () => {
    const { doc } = scanXml('<r><element kind="textField"/><band/></r>');
    const [el, band] = doc.root.children;
    assert.strictEqual(el.kind, 'textField');
    assert.strictEqual(band.kind, 'band');
});

test('CDATA content is exposed without its markers', () => {
    const { doc } = scanXml('<r><e><![CDATA[a < b && c]]></e></r>');
    assert.strictEqual(doc.root.children[0].textContent(), 'a < b && c');
});

test('handles xml declaration, processing instructions and comments', () => {
    const text = '<?xml version="1.0"?><!-- hi --><?pi x?><r><!-- inner --><a/></r>';
    const { doc, error } = scanXml(text);
    assert.strictEqual(error, null);
    assert.strictEqual(doc.root.tag, 'r');
    assert.strictEqual(doc.root.children.length, 1);
});

test('rejects DOCTYPE declarations', () => {
    const { doc, error } = scanXml('<!DOCTYPE foo [<!ENTITY x "y">]><r/>');
    assert.strictEqual(doc, null);
    assert.match(error, /DOCTYPE/);
});

test('reports malformed documents instead of guessing', () => {
    assert.match(scanXml('<a><b></a>').error, /mismatched/);
    assert.match(scanXml('<a>').error, /unclosed/);
    assert.match(scanXml('').error, /exactly one root/);
    assert.match(scanXml('<a x=1/>').error, /unquoted/);
    assert.match(scanXml('<a x="1/>').error, /unterminated value/);
});

test('walks in document order and exposes ancestors', () => {
    const { doc } = scanXml('<r><a><b/><c/></a></r>');
    assert.deepStrictEqual([...doc.walk()].map(n => n.tag), ['r', 'a', 'b', 'c']);

    const c = doc.root.children[0].children[1];
    assert.deepStrictEqual(c.ancestors().map(n => n.tag), ['a', 'r']);
});

test('nodeAt finds the deepest node containing an offset', () => {
    const text = '<r><a x="1"><b>y</b></a></r>';
    const { doc } = scanXml(text);
    const b = doc.root.children[0].children[0];

    assert.strictEqual(nodeAt(doc.root, text.indexOf('y')), b);
    assert.strictEqual(nodeAt(doc.root, text.indexOf('<b>')), b);
});

test('firstChild returns a direct child only', () => {
    const { doc } = scanXml('<r><a><b/></a></r>');
    assert.strictEqual(firstChild(doc.root, 'a').tag, 'a');
    assert.strictEqual(firstChild(doc.root, 'b'), null);
});
