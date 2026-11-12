// analysisContext.ts
// One scan per analysis pass. The tree is shared with the parser and every
// rule so offsets and malformed-XML behaviour come from a single place.

import { scanXml } from './xmlspan';
import type { XmlScanResult } from './xmlspan';

/** A document's text and the single scan every rule shares. */
export interface AnalysisContext {
    text: string;
    scan: XmlScanResult;
}

export function analyse(text: string): AnalysisContext {
    const value = typeof text === 'string' ? text : '';
    return { text: value, scan: scanXml(value) };
}
