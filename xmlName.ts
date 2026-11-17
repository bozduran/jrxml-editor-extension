// xmlName.ts
// Local XML element names for JRXML: strip a namespace prefix but keep the
// camelCase spelling (`subDataset` is not `subdataset`).
//
// Pure and vscode-free: the parser, the schema checks and the unused-resource
// checks share it. designSpec has its own lower-casing helper because the
// design vocabulary is case-insensitive; JRXML tags are not.

/** The name after any namespace prefix, with its case preserved. */
export function localName(tag: string): string {
    const text = tag;
    const colon = text.indexOf(':');
    return colon === -1 ? text : text.slice(colon + 1);
}
