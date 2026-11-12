// properties.ts
// A small, dependency-free reader for Java .properties files.
//
// Resource bundles are plain properties files, so the extension only needs
// enough of the format to index keys and show values: separators (=, : or
// whitespace), comments (#, !), continuation lines, and the standard escapes.
// Duplicate keys are returned in file order; the caller decides precedence
// (java.util.Properties keeps the last value).

export interface PropertyEntry {
    key: string;
    value: string;
    /** Character offset of the key in the source text. */
    offset: number;
    /** 0-based line of the key. */
    line: number;
    /** 0-based column of the key. */
    character: number;
}

interface SourceLine {
    text: string;
    offset: number;
}

export function parseProperties(text: string): PropertyEntry[] {
    const entries: PropertyEntry[] = [];
    const lines: SourceLine[] = [];
    let offset = 0;

    for (const raw of text.split('\n')) {
        const lineText = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        lines.push({ text: lineText, offset });
        offset += raw.length + 1;
    }

    let index = 0;
    while (index < lines.length) {
        const first = lines[index];
        const lead  = first.text.length - first.text.replace(/^\s+/, '').length;
        const head  = first.text.slice(lead);

        if (!head || head[0] === '#' || head[0] === '!') {
            index++;
            continue;
        }

        const startLine = index;
        let logical = head;
        while (hasContinuation(logical) && index + 1 < lines.length) {
            logical = logical.slice(0, -1) + lines[index + 1].text.replace(/^\s+/, '');
            index++;
        }

        const keyOffset = first.offset + lead;
        const { rawKey, rawValue } = splitKeyValue(logical);
        const key = decodeEscapes(rawKey.replace(/\s+$/, ''));
        index++;

        if (!key) continue;
        entries.push({
            key,
            value: decodeEscapes(rawValue),
            offset: keyOffset,
            line: startLine,
            character: lead,
        });
    }

    return entries;
}

/** Odd number of trailing backslashes means the value continues next line. */
function hasContinuation(text: string): boolean {
    let backslashes = 0;
    for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i--) backslashes++;
    return backslashes % 2 === 1;
}

interface KeyValue {
    rawKey: string;
    rawValue: string;
}

/** Split `key = value` on the first unescaped separator. */
function splitKeyValue(logical: string): KeyValue {
    let escaped = false;

    for (let i = 0; i < logical.length; i++) {
        const ch = logical[i];

        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '=' || ch === ':' || /\s/.test(ch)) {
            let valueStart = i;
            while (valueStart < logical.length && /\s/.test(logical[valueStart])) valueStart++;
            if (logical[valueStart] === '=' || logical[valueStart] === ':') valueStart++;
            while (valueStart < logical.length && /\s/.test(logical[valueStart])) valueStart++;

            return { rawKey: logical.slice(0, i), rawValue: logical.slice(valueStart) };
        }
    }

    return { rawKey: logical, rawValue: '' };
}

/** Decode the escapes Java properties files use. */
export function decodeEscapes(raw: string): string {
    const simple: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' };

    return raw.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (_match, group: string) => {
        if (group.length === 5 && group[0] === 'u') {
            return String.fromCharCode(parseInt(group.slice(1), 16));
        }
        return simple[group] ?? group;
    });
}
