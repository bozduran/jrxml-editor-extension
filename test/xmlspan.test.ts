// test/xmlspan.test.js
// Unit tests for the offset-accurate XML scanner.

import test from 'node:test';
import assert from 'node:assert';

import { scanXml, nodeAt, firstChild } from '../out/xmlspan.js';
import type { XmlAttr, XmlDocument, XmlNode } from '../out/xmlspan.js';

/** Scan a document the tests expect to be well formed and narrow its root. */
function scan(text: string): { doc: XmlDocument; error: string | null } {
    const result = scanXml(text);
    assert.ok(result.doc, 'expected a scannable document');
    return { doc: result.doc, error: result.error };
}

/** The scan error the tests expect; asserts it was reported. */
function scanError(text: string): string {
    const result = scanXml(text);
    assert.ok(result.error, `expected a scan error for ${JSON.stringify(text)}`);
    return result.error;
}

/** An attribute the fixture declares; asserts it exists. */
function attribute(node: XmlNode, name: string): XmlAttr {
    const found = node.attr(name);
    assert.ok(found, `expected attribute ${name}`);
    return found;
}

test('captures element spans for open/close tags', () => {
    const text = '<r><child>hi</child></r>';
    const { doc, error } = scan(text);
    assert.strictEqual(error, null);

    const child = doc.root.children[0];
    assert.strictEqual(child.tag, 'child');
    assert.strictEqual(text.slice(child.startTag, child.startTagEnd), '<child>');
    assert.strictEqual(text.slice(child.endTag, child.end), '</child>');
    assert.strictEqual(child.textContent(), 'hi');
});

test('captures self-closing spans', () => {
    const text = '<r><leaf a="1"/></r>';
    const { doc } = scan(text);
    const leaf = doc.root.children[0];
    assert.strictEqual(leaf.selfClosing, true);
    assert.strictEqual(text.slice(leaf.startTag, leaf.end), '<leaf a="1"/>');
});

test('reads attributes with either quote style and records value offsets', () => {
    const text = `<a x="1" y='two' z=""/>`;
    const { doc } = scan(text);
    const a = doc.root;

    assert.strictEqual(a.attrValue('x'), '1');
    assert.strictEqual(a.attrValue('y'), 'two');
    assert.strictEqual(a.attrValue('z'), '');
    assert.strictEqual(a.attrValue('missing'), undefined);

    assert.strictEqual(text.slice(attribute(a, 'x').valueStart, attribute(a, 'x').valueEnd), '1');
    assert.strictEqual(text.slice(attribute(a, 'y').valueStart, attribute(a, 'y').valueEnd), 'two');
    assert.deepStrictEqual(a.attrList.map(x => x.name), ['x', 'y', 'z']);
});

test('does not confuse an attribute name with a longer one', () => {
    const { doc } = scan('<field fullName="nope" name="real"/>');
    assert.strictEqual(doc.root.attrValue('name'), 'real');
});

test('kind falls back to the tag name', () => {
    const { doc } = scan('<r><element kind="textField"/><band/></r>');
    const [el, band] = doc.root.children;
    assert.strictEqual(el.kind, 'textField');
    assert.strictEqual(band.kind, 'band');
});

test('CDATA content is exposed without its markers', () => {
    const { doc } = scan('<r><e><![CDATA[a < b && c]]></e></r>');
    assert.strictEqual(doc.root.children[0].textContent(), 'a < b && c');
});

test('handles xml declaration, processing instructions and comments', () => {
    const text = '<?xml version="1.0"?><!-- hi --><?pi x?><r><!-- inner --><a/></r>';
    const { doc, error } = scan(text);
    assert.strictEqual(error, null);
    assert.strictEqual(doc.root.tag, 'r');
    assert.strictEqual(doc.root.children.length, 1);
});

test('skips DOCTYPE declarations and never resolves entities', () => {
    const text = '<!DOCTYPE foo [<!ENTITY x "y">]><r>&x;</r>';
    const { doc, error } = scan(text);
    assert.strictEqual(error, null);
    assert.strictEqual(doc.root.tag, 'r');
    // The entity is left as literal text — never expanded.
    assert.strictEqual(doc.root.textContent(), '&x;');
});

test('skips a DOCTYPE whose internal subset contains > and quotes', () => {
    const text = '<!DOCTYPE r [<!ENTITY a "x > y">]><r/>';
    const { doc, error } = scan(text);
    assert.strictEqual(error, null);
    assert.strictEqual(doc.root.tag, 'r');
});

test('an unterminated DOCTYPE is reported', () => {
    assert.match(scanError('<!DOCTYPE r [<r/>'), /DOCTYPE/);
});

test('reports malformed documents instead of guessing', () => {
    assert.match(scanError('<a><b></a>'), /mismatched/);
    assert.match(scanError('<a>'), /unclosed/);
    assert.match(scanError(''), /exactly one root/);
    assert.match(scanError('<a x=1/>'), /unquoted/);
    assert.match(scanError('<a x="1/>'), /unterminated value/);
});

test('walks in document order and exposes ancestors', () => {
    const { doc } = scan('<r><a><b/><c/></a></r>');
    assert.deepStrictEqual([...doc.walk()].map(n => n.tag), ['r', 'a', 'b', 'c']);

    const c = doc.root.children[0].children[1];
    assert.deepStrictEqual(c.ancestors().map(n => n.tag), ['a', 'r']);
});

test('nodeAt finds the deepest node containing an offset', () => {
    const text = '<r><a x="1"><b>y</b></a></r>';
    const { doc } = scan(text);
    const b = doc.root.children[0].children[0];

    assert.strictEqual(nodeAt(doc.root, text.indexOf('y')), b);
    assert.strictEqual(nodeAt(doc.root, text.indexOf('<b>')), b);
});

test('firstChild returns a direct child only', () => {
    const { doc } = scan('<r><a><b/></a></r>');
    const a = firstChild(doc.root, 'a');
    assert.ok(a, 'a must be a direct child');
    assert.strictEqual(a.tag, 'a');
    assert.strictEqual(firstChild(doc.root, 'b'), null);
});
