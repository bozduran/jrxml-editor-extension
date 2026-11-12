// jrxmlSections.ts
// The report's band-bearing top-level sections, shared by the outline builder
// and the layout checker.

export const REPORT_SECTIONS = [
    'background', 'title', 'pageHeader', 'columnHeader', 'detail',
    'columnFooter', 'pageFooter', 'lastPageFooter', 'summary', 'noData',
] as const;

export type ReportSection = typeof REPORT_SECTIONS[number];

export const BAND_TAGS: ReadonlySet<string> = new Set(['band', ...REPORT_SECTIONS]);
