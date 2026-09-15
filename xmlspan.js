// xmlspan.js
// Offset-accurate, well-formedness-checking XML scanner for .jrxml documents.
//
// All offsets are CHARACTER offsets into the decoded string (never bytes).
// DOCTYPE declarations are rejected (XXE / SSRF / billion-laughs) and entities
// are never resolved — a .jrxml never needs them.
//
// The scan returns a tree whose nodes carry the spans the rules need:
//   startTag      offset of the '<' of the opening tag
//   startTagEnd   offset just past the '>' of the opening tag
//   endTag        offset of the '<' of the closing tag (or -1)
//   end           offset just past the closing tag / '/>' 
//   attrs         Map<name, XmlAttr> with value start/end offsets

class XmlAttr {
    constructor(name, value, nameStart, valueStart, valueEnd) {
        this.name       = name;
        this.value      = value;
        this.nameStart  = nameStart;
        this.valueStart = valueStart; // first char inside the quotes
        this.valueEnd   = valueEnd;   // just past the last char inside the quotes
    }
}

class XmlNode {
    constructor(tag, startTag, startTagEnd) {
        this.tag         = tag;
        this.startTag    = startTag;
        this.startTagEnd = startTagEnd;
        this.endTag      = -1;
        this.end         = startTagEnd;
        this.selfClosing = false;

        /** @type {Map<string, XmlAttr>} */
        this.attrs     = new Map();
        /** @type {XmlAttr[]} declaration order */
        this.attrList  = [];
        /** @type {XmlNode[]} */
        this.children  = [];
        /** @type {XmlNode|null} */
        this.parent    = null;
        /** @type {{text:string,start:number,end:number,cdata:boolean}[]} */
        this.textNodes = [];
    }

    /** The element's `kind` attribute, falling back to the tag name. */
    get kind() {
        const a = this.attrs.get('kind');
        return a ? a.value : this.tag;
    }

    attr(name)      { return this.attrs.get(name); }
    attrValue(name) { const a = this.attrs.get(name); return a ? a.value : undefined; }

    /** Concatenated text/CDATA content (CDATA markers are not included). */
    textContent() {
        return this.textNodes.map(t => t.text).join('');
    }

    /** True when this element has no non-whitespace content and no children. */
    isBlank() {
        return this.children.length === 0 && this.textContent().trim() === '';
    }

    /** @returns {XmlNode[]} parents, nearest first */
    ancestors() {
        const out = [];
        let p = this.parent;
        while (p) { out.push(p); p = p.parent; }
        return out;
    }

    /** Depth-first walk over this node and all descendants. */
    *walk() {
        yield this;
        for (const child of this.children) yield* child.walk();
    }
}

class XmlDocument {
    constructor(root) {
        this.root = root;
    }
    *walk() { yield* this.root.walk(); }
    /** All nodes with the given tag name. */
    findAll(tag) {
        const out = [];
        for (const n of this.walk()) if (n.tag === tag) out.push(n);
        return out;
    }
}

/**
 * Scan `text` into an offset-annotated tree.
 * @param {string} text
 * @returns {{ doc: XmlDocument|null, error: string|null }}
 */
function scanXml(text) {
    if (/<!\s*DOCTYPE/i.test(text)) {
        return { doc: null, error: 'DOCTYPE declarations are not allowed' };
    }

    const documentNode = new XmlNode('#document', 0, 0);
    documentNode.end = text.length;
    const stack = [documentNode];
    const len = text.length;
    let i = 0;

    while (i < len) {
        const lt = text.indexOf('<', i);
        if (lt === -1) break;

        // Plain text between tags
        if (lt > i) {
            const raw = text.slice(i, lt);
            if (raw.trim() !== '') {
                stack[stack.length - 1].textNodes.push({ text: raw, start: i, end: lt, cdata: false });
            }
        }

        // Comment
        if (text.startsWith('<!--', lt)) {
            const end = text.indexOf('-->', lt + 4);
            if (end === -1) return { doc: null, error: 'unterminated comment' };
            i = end + 3;
            continue;
        }

        // CDATA section
        if (text.startsWith('<![CDATA[', lt)) {
            const end = text.indexOf(']]>', lt + 9);
            if (end === -1) return { doc: null, error: 'unterminated CDATA section' };
            stack[stack.length - 1].textNodes.push({
                text: text.slice(lt + 9, end), start: lt + 9, end, cdata: true,
            });
            i = end + 3;
            continue;
        }

        // Processing instruction
        if (text.startsWith('<?', lt)) {
            const end = text.indexOf('?>', lt + 2);
            if (end === -1) return { doc: null, error: 'unterminated processing instruction' };
            i = end + 2;
            continue;
        }

        // Any other declaration (<!ENTITY …> etc.) — skipped, never resolved
        if (text.startsWith('<!', lt)) {
            const end = text.indexOf('>', lt + 2);
            if (end === -1) return { doc: null, error: 'unterminated declaration' };
            i = end + 1;
            continue;
        }

        // Closing tag
        if (text.startsWith('</', lt)) {
            const gt = text.indexOf('>', lt + 2);
            if (gt === -1) return { doc: null, error: 'unterminated closing tag' };
            const name = text.slice(lt + 2, gt).trim();
            const node = stack[stack.length - 1];
            if (node === documentNode) return { doc: null, error: `unexpected </${name}>` };
            if (node.tag !== name) return { doc: null, error: `mismatched </${name}> for <${node.tag}>` };
            stack.pop();
            node.endTag = lt;
            node.end    = gt + 1;
            i = gt + 1;
            continue;
        }

        // Opening tag
        const parsed = parseStartTag(text, lt);
        if (parsed.error) return { doc: null, error: parsed.error };

        const node = new XmlNode(parsed.tag, lt, parsed.startTagEnd);
        node.selfClosing = parsed.selfClosing;
        node.attrs       = parsed.attrs;
        node.attrList    = parsed.attrList;
        node.end         = parsed.startTagEnd;

        const parent = stack[stack.length - 1];
        // The synthetic #document holder is not part of the element tree.
        node.parent = parent === documentNode ? null : parent;
        parent.children.push(node);
        if (!parsed.selfClosing) stack.push(node);

        i = parsed.startTagEnd;
    }

    if (stack.length !== 1) {
        return { doc: null, error: `unclosed <${stack[stack.length - 1].tag}>` };
    }
    if (documentNode.children.length !== 1) {
        return { doc: null, error: 'expected exactly one root element' };
    }
    documentNode.end = text.length;
    return { doc: new XmlDocument(documentNode.children[0]), error: null };
}

/** Parse a start tag beginning at `lt`. */
function parseStartTag(text, lt) {
    const len = text.length;
    let i = lt + 1;

    const nameStart = i;
    while (i < len && !/[\s/>]/.test(text[i])) i++;
    const tag = text.slice(nameStart, i);
    if (!tag) return { error: 'empty element name' };

    const attrs = new Map();
    const attrList = [];

    while (i < len) {
        while (i < len && /\s/.test(text[i])) i++;
        if (i >= len) return { error: `unterminated <${tag}>` };

        if (text[i] === '/') {
            if (text[i + 1] === '>') {
                return { tag, attrs, attrList, selfClosing: true, startTagEnd: i + 2 };
            }
            return { error: `malformed tag <${tag}>` };
        }
        if (text[i] === '>') {
            return { tag, attrs, attrList, selfClosing: false, startTagEnd: i + 1 };
        }

        const attrNameStart = i;
        while (i < len && !/[\s=/>]/.test(text[i])) i++;
        const name = text.slice(attrNameStart, i);
        if (!name) return { error: `malformed attribute in <${tag}>` };

        while (i < len && /\s/.test(text[i])) i++;

        let value = '', valueStart = i, valueEnd = i;
        if (text[i] === '=') {
            i++;
            while (i < len && /\s/.test(text[i])) i++;
            const quote = text[i];
            if (quote !== '"' && quote !== "'") {
                return { error: `unquoted value for attribute ${name} in <${tag}>` };
            }
            i++;
            valueStart = i;
            const close = text.indexOf(quote, i);
            if (close === -1) return { error: `unterminated value for attribute ${name} in <${tag}>` };
            value    = text.slice(i, close);
            valueEnd = close;
            i        = close + 1;
        }

        const attr = new XmlAttr(name, value, attrNameStart, valueStart, valueEnd);
        if (!attrs.has(name)) attrs.set(name, attr);
        attrList.push(attr);
    }

    return { error: `unterminated <${tag}>` };
}

/** Deepest node whose span contains `offset`. Returns null when none does. */
function nodeAt(root, offset) {
    let best = null;
    for (const node of root.walk()) {
        if (node.startTag <= offset && offset < node.end) {
            if (!best || node.startTag >= best.startTag) best = node;
        }
    }
    return best;
}

/** First element whose start tag begins exactly at `offset`. */
function nodeStartingAt(root, offset) {
    for (const node of root.walk()) {
        if (node.startTag === offset) return node;
    }
    return null;
}

/** Offset just before the `>` / `/>` that closes a start tag. */
function attrInsertOffset(node) {
    return node.startTagEnd - (node.selfClosing ? 2 : 1);
}

/** First descendant (or self) with the given tag. */
function firstChild(node, tag) {
    for (const child of node.children) {
        if (child.tag === tag) return child;
    }
    return null;
}

module.exports = {
    scanXml, nodeAt, nodeStartingAt, attrInsertOffset, firstChild,
    XmlNode, XmlAttr, XmlDocument,
};
