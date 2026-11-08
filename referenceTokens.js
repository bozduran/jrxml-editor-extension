// referenceTokens.js
// One grammar for `$F{}` / `$P{}` / `$V{}` / `$R{}` tokens.
//
// The same token text is read by the parser, hover/definition/references and
// the unused-declaration collector. Keeping the grammar here stops a name that
// hovers (`my-field`) from being invisible to Find All References.

const TOKEN_SOURCE = '\\$(F|P|V|R)(!?)\\{([^}]+)\\}';

function tokenRegExp() {
    return new RegExp(TOKEN_SOURCE, 'g');
}

/** The token under a cursor column, or null. Pure: works on one line. */
function findReferenceToken(lineText, character) {
    const re = tokenRegExp();
    let match;
    while ((match = re.exec(lineText)) !== null) {
        if (match.index <= character && character <= match.index + match[0].length) {
            return {
                sigil: match[1],
                name: match[3].trim(),
                bang: match[2] === '!',
                start: match.index,
                end: match.index + match[0].length,
            };
        }
    }
    return null;
}

/** Every token in `text`, in order. */
function forEachReferenceToken(text, callback) {
    const re = tokenRegExp();
    let match;
    while ((match = re.exec(text)) !== null) {
        callback({
            sigil: match[1],
            name: match[3].trim(),
            bang: match[2] === '!',
            start: match.index,
            end: match.index + match[0].length,
        });
    }
}

module.exports = { findReferenceToken, forEachReferenceToken };
