// reportSource.js
// The parser's input seam. A report source is text plus a stable identity and a
// version, so one adapter serves a VS Code document and one serves headless
// callers (diagnostics, subreport resolution, tests).

/** @returns {{text:string, id:string, version:*}} */
function textSource(text, id, version = 0) {
    return {
        text: typeof text === 'string' ? text : '',
        id: String(id ?? ''),
        version,
    };
}

/** Adapt a VS Code TextDocument without leaking its protocol into the parser. */
function documentSource(document) {
    return {
        text: document.getText(),
        id: document.uri.toString(),
        version: document.version,
    };
}

module.exports = { textSource, documentSource };
