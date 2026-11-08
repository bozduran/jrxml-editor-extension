// reportLanguage.js
// Which document expression language a report declares.
//
// JasperReports supports Java, Groovy and JavaScript. The extension's parser,
// formatter and member index are Java-only, so every consumer that applies
// Java semantics must first ask what the report actually declares.

const { scanXml } = require('./xmlspan');

const JAVA = 'java';

/**
 * @param {string} text JRXML document text
 * @returns {{language:string, declared:boolean, offset:number, length:number}}
 *   `declared` is false when the attribute is absent/empty or the document
 *   cannot be scanned; `language` is normalized to lower case.
 */
function reportLanguage(text) {
    const scan = scanXml(text);
    if (scan.error || scan.doc.root.tag !== 'jasperReport') {
        return { language: JAVA, declared: false, offset: -1, length: 0 };
    }

    const attr = scan.doc.root.attr('language');
    if (!attr || !attr.value.trim()) {
        return { language: JAVA, declared: false, offset: -1, length: 0 };
    }

    return {
        language: attr.value.trim().toLowerCase(),
        declared: true,
        offset:   attr.valueStart,
        length:   attr.value.length,
    };
}

/** True when the report declares Java or leaves the language at its default. */
function isJavaLanguage(text) {
    return reportLanguage(text).language === JAVA;
}

module.exports = { reportLanguage, isJavaLanguage, JAVA };
