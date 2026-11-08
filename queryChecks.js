// queryChecks.js
// Conservative static checks for <query> content.
//
// SQL and JSONQL are embedded languages: the editor highlights them and this
// module flags the two mistakes that make a query unparseable — an unclosed
// string literal and an unclosed block comment — without guessing at the rest.
// `$P!{}` / `$X{}` fragments are skipped wholesale: they are raw SQL injected at
// runtime and may legitimately contain quotes.

const { scanXml } = require('./xmlspan');

const SQL_LIKE = new Set(['', 'sql']);

/**
 * @param {string} text JRXML document
 * @returns {{code:string, message:string, offset:number, length:number}[]}
 */
function checkQueries(text) {
    const scan = scanXml(text);
    if (scan.error) return [];

    const findings = [];
    for (const node of scan.doc.walk()) {
        if (node.tag !== 'query') continue;

        const language = (node.attrValue('language') || '').toLowerCase();
        if (!SQL_LIKE.has(language) && language !== 'jsonql') continue;

        for (const span of node.textNodes) {
            const issues = language === 'jsonql'
                ? scanJsonql(span.text, span.start)
                : scanSql(span.text, span.start);
            findings.push(...issues);
        }
    }
    return findings;
}

function scanSql(text, base) {
    const findings = [];
    let index = 0;

    while (index < text.length) {
        const char = text[index];

        if (isFragmentStart(text, index)) {
            index = skipFragment(text, index);
            continue;
        }

        if (char === '-' && text[index + 1] === '-') {
            const newline = text.indexOf('\n', index + 2);
            index = newline === -1 ? text.length : newline + 1;
            continue;
        }

        if (char === '/' && text[index + 1] === '*') {
            const end = text.indexOf('*/', index + 2);
            if (end === -1) {
                findings.push(unclosedComment(base + index));
                break;
            }
            index = end + 2;
            continue;
        }

        if (char === "'" || char === '"') {
            const end = findStringEnd(text, index, char, true);
            if (end === -1) {
                findings.push(unclosedString(base + index));
                break;
            }
            index = end;
            continue;
        }

        index++;
    }

    return findings;
}

/** JSON strings cannot be single-quoted and comments are not part of JSON. */
function scanJsonql(text, base) {
    const findings = [];
    let index = 0;

    while (index < text.length) {
        if (isFragmentStart(text, index)) {
            index = skipFragment(text, index);
            continue;
        }

        if (text[index] === '"') {
            const end = findStringEnd(text, index, '"', false);
            if (end === -1) {
                findings.push(unclosedString(base + index));
                break;
            }
            index = end;
            continue;
        }

        index++;
    }

    return findings;
}

function isFragmentStart(text, index) {
    return fragmentBodyStart(text, index) !== -1;
}

function fragmentBodyStart(text, index) {
    if (text[index] !== '$' || !/[FPVRX]/.test(text[index + 1] || '')) return -1;
    if (text[index + 2] === '{') return index + 3;
    if (text[index + 2] === '!' && text[index + 3] === '{') return index + 4;
    return -1;
}

function skipFragment(text, index) {
    let cursor = fragmentBodyStart(text, index);
    while (cursor < text.length && text[cursor] !== '}') cursor++;
    return cursor + 1;
}

/**
 * Offset just past the closing quote, or -1 when the literal is unclosed.
 * In SQL a doubled quote is an escaped quote; JSON uses backslash escapes.
 */
function findStringEnd(text, start, quote, allowDoubled) {
    let index = start + 1;

    while (index < text.length) {
        if (text[index] === '\\') {
            index += 2;
            continue;
        }
        if (text[index] === quote) {
            if (allowDoubled && text[index + 1] === quote) {
                index += 2;
                continue;
            }
            return index + 1;
        }
        index++;
    }

    return -1;
}

function unclosedString(offset) {
    return {
        code: 'jrxml.query.unclosedString',
        message: 'Unclosed string literal in <query>.',
        offset,
        length: 1,
    };
}

function unclosedComment(offset) {
    return {
        code: 'jrxml.query.unclosedComment',
        message: 'Unclosed block comment in <query>.',
        offset,
        length: 2,
    };
}

module.exports = { checkQueries };
