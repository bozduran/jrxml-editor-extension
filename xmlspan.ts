// xmlspan.ts
// Offset-accurate, well-formedness-checking XML scanner for .jrxml documents.
//
// All offsets are CHARACTER offsets into the decoded string (never bytes).
// DOCTYPE declarations are skipped, never fetched and never resolved: entities
// are left as literal text, so a DTD (internal or external) can cause neither
// XXE/SSRF nor entity-expansion blowups, while real JasperReports files that
// carry a DOCTYPE still scan.
//
// The scan returns a tree whose nodes carry the spans the rules need:
//   startTag      offset of the '<' of the opening tag
//   startTagEnd   offset just past the '>' of the opening tag
//   endTag        offset of the '<' of the closing tag (or -1)
//   end           offset just past the closing tag / '/>'
//   attrs         Map<name, XmlAttr> with value start/end offsets

export class XmlAttr {
    name: string;
    value: string;
    nameStart: number;
    valueStart: number;
    valueEnd: number;

    constructor(name: string, value: string, nameStart: number, valueStart: number, valueEnd: number) {
        this.name       = name;
        this.value      = value;
        this.nameStart  = nameStart;
        this.valueStart = valueStart; // first char inside the quotes
        this.valueEnd   = valueEnd;   // just past the last char inside the quotes
    }
}

export interface XmlTextNode {
    text: string;
    start: number;
    end: number;
    cdata: boolean;
}

export class XmlNode {
    tag: string;
    startTag: number;
    startTagEnd: number;
    endTag: number;
    end: number;
    selfClosing: boolean;

    /** Declaration-order attributes, by name. */
    attrs: Map<string, XmlAttr>;
    /** Declaration-order attributes, including duplicates skipped by `attrs`. */
    attrList: XmlAttr[];
    children: XmlNode[];
    parent: XmlNode | null;
    textNodes: XmlTextNode[];

    constructor(tag: string, startTag: number, startTagEnd: number) {
        this.tag         = tag;
        this.startTag    = startTag;
        this.startTagEnd = startTagEnd;
        this.endTag      = -1;
        this.end         = startTagEnd;
        this.selfClosing = false;

        this.attrs     = new Map();
        this.attrList  = [];
        this.children  = [];
        this.parent    = null;
        this.textNodes = [];
    }

    /** The element's `kind` attribute, falling back to the tag name. */
    get kind(): string {
        const a = this.attrs.get('kind');
        return a ? a.value : this.tag;
    }

    attr(name: string): XmlAttr | undefined {
        return this.attrs.get(name);
    }

    attrValue(name: string): string | undefined {
        const a = this.attrs.get(name);
        return a ? a.value : undefined;
    }

    /** Concatenated text/CDATA content (CDATA markers are not included). */
    textContent(): string {
        return this.textNodes.map(t => t.text).join('');
    }

    /** True when this element has no non-whitespace content and no children. */
    isBlank(): boolean {
        return this.children.length === 0 && this.textContent().trim() === '';
    }

    /** Parents, nearest first. */
    ancestors(): XmlNode[] {
        const out: XmlNode[] = [];
        let p = this.parent;
        while (p) { out.push(p); p = p.parent; }
        return out;
    }

    /**
     * Document-order walk over this node and all descendants. Iterative, so
     * deeply nested input cannot overflow the call stack.
     */
    *walk(): Generator<XmlNode> {
        const stack: XmlNode[] = [this];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node) break;
            yield node;
            for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
        }
    }
}

export class XmlDocument {
    root: XmlNode;

    constructor(root: XmlNode) {
        this.root = root;
    }

    *walk(): Generator<XmlNode> {
        yield* this.root.walk();
    }

    /** All nodes with the given tag name. */
    findAll(tag: string): XmlNode[] {
        const out: XmlNode[] = [];
        for (const n of this.walk()) if (n.tag === tag) out.push(n);
        return out;
    }
}

export interface XmlScanResult {
    doc: XmlDocument | null;
    error: string | null;
}

/** Scan `text` into an offset-annotated tree. */
export function scanXml(text: string): XmlScanResult {
    const documentNode = new XmlNode('#document', 0, 0);
    documentNode.end = text.length;
    const stack: XmlNode[] = [documentNode];
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

        // DOCTYPE declaration — skipped, never fetched or resolved. Handled
        // before the generic `<!` branch because an internal subset may contain
        // `>` inside `[...]` and inside quoted entity values.
        if (/^<!\s*DOCTYPE/i.test(text.slice(lt, lt + 64))) {
            const end = skipDoctype(text, lt);
            if (end === -1) return { doc: null, error: 'unterminated DOCTYPE declaration' };
            i = end;
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
        if ('error' in parsed) return { doc: null, error: parsed.error };

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

/**
 * Offset just past the `>` that closes a DOCTYPE declaration beginning at
 * `lt`, or -1 when it is unterminated. Bracketed internal subsets and quoted
 * values are skipped so a `>` inside them does not end the declaration early.
 */
function skipDoctype(text: string, lt: number): number {
    let i = lt + 2; // past '<!'
    let bracket = 0;

    while (i < text.length) {
        const ch = text[i];
        if (ch === '"' || ch === "'") {
            const close = text.indexOf(ch, i + 1);
            if (close === -1) return -1;
            i = close + 1;
            continue;
        }
        if (ch === '[') {
            bracket++;
        } else if (ch === ']') {
            if (bracket > 0) bracket--;
        } else if (ch === '>' && bracket === 0) {
            return i + 1;
        }
        i++;
    }
    return -1;
}

interface ParsedStartTag {
    tag: string;
    attrs: Map<string, XmlAttr>;
    attrList: XmlAttr[];
    selfClosing: boolean;
    startTagEnd: number;
}

interface StartTagError {
    error: string;
}

/** Parse a start tag beginning at `lt`. */
function parseStartTag(text: string, lt: number): ParsedStartTag | StartTagError {
    const len = text.length;
    let i = lt + 1;

    const nameStart = i;
    while (i < len && !/[\s/>]/.test(text[i])) i++;
    const tag = text.slice(nameStart, i);
    if (!tag) return { error: 'empty element name' };

    const attrs = new Map<string, XmlAttr>();
    const attrList: XmlAttr[] = [];

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
export function nodeAt(root: XmlNode, offset: number): XmlNode | null {
    let best: XmlNode | null = null;
    for (const node of root.walk()) {
        if (node.startTag <= offset && offset < node.end) {
            if (!best || node.startTag >= best.startTag) best = node;
        }
    }
    return best;
}

/** First element whose start tag begins exactly at `offset`. */
export function nodeStartingAt(root: XmlNode, offset: number): XmlNode | null {
    for (const node of root.walk()) {
        if (node.startTag === offset) return node;
    }
    return null;
}

/** Offset just before the `>` / `/>` that closes a start tag. */
export function attrInsertOffset(node: XmlNode): number {
    return node.startTagEnd - (node.selfClosing ? 2 : 1);
}

/** First descendant (or self) with the given tag. */
export function firstChild(node: XmlNode, tag: string): XmlNode | null {
    for (const child of node.children) {
        if (child.tag === tag) return child;
    }
    return null;
}
