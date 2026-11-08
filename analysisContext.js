// analysisContext.js
// One scan per analysis pass. The tree is shared with the parser and every
// rule so offsets and malformed-XML behaviour come from a single place.

const { scanXml } = require('./xmlspan');

/**
 * @param {string} text
 * @returns {{text:string, scan:object}}
 */
function analyse(text) {
    const value = typeof text === 'string' ? text : '';
    return { text: value, scan: scanXml(value) };
}

module.exports = { analyse };
