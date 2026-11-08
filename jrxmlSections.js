// jrxmlSections.js
// The report's band-bearing top-level sections, shared by the outline builder
// and the layout checker.

const REPORT_SECTIONS = [
    'background', 'title', 'pageHeader', 'columnHeader', 'detail',
    'columnFooter', 'pageFooter', 'lastPageFooter', 'summary', 'noData',
];

const BAND_TAGS = new Set(['band', ...REPORT_SECTIONS]);

module.exports = { REPORT_SECTIONS, BAND_TAGS };
