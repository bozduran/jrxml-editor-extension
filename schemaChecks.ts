// schemaChecks.ts
// Structural JRXML checks driven by the curated vocabulary in jrxmlSchema.
//
// This module is vscode-free: diagnostics and the CI validator share it.
//
// Conservative by construction:
//   * unknown children are reported only under parents whose vocabulary is
//     fully known, and an unknown element's subtree is not checked further;
//   * unknown attributes are reported only on elements with a closed attribute
//     set (7.x `<element>`, styles and boxes opt out with `openAttributes`);
//   * namespaced tags are never reported, so `jr:`/`c:` extensions are safe;
//   * malformed XML yields no findings.

import { localName } from './xmlName';
import { suggestName } from './textDistance';
import { ELEMENT_RULES, REPORT_LEVEL_ORDER, TAG_ALIASES, UNIVERSAL_ATTRIBUTES } from './jrxmlSchema';
import type { AttributeRule, ElementRule } from './jrxmlSchema';
import type { XmlNode, XmlScanResult } from './xmlspan';

export interface SchemaFinding {
    offset: number;
    length: number;
    message: string;
    code: string;
}

function canonical(tag: string): string {
    const local = localName(tag);
    return TAG_ALIASES[local] ?? local;
}

function isNamespaced(tag: string): boolean {
    return tag.includes(':');
}

function ruleFor(tag: string): ElementRule | undefined {
    return ELEMENT_RULES[canonical(tag)];
}

function findAttributeRule(rule: ElementRule, name: string): AttributeRule | undefined {
    return rule.attrs ? rule.attrs[name] : undefined;
}

function checkAttributes(node: XmlNode, rule: ElementRule, push: (finding: SchemaFinding) => void): void {
    if (!rule.attrs) return;

    if (!rule.openAttributes) {
        const known = Object.keys(rule.attrs);
        for (const attr of node.attrList) {
            if (UNIVERSAL_ATTRIBUTES.has(attr.name) || isNamespaced(attr.name)) continue;
            if (findAttributeRule(rule, attr.name)) continue;

            const hint = suggestName(attr.name, [...known, ...UNIVERSAL_ATTRIBUTES]);
            push({
                offset: attr.nameStart,
                length: attr.name.length,
                message: `Unknown attribute "${attr.name}" on <${canonical(node.tag)}>${hint ? `. Did you mean "${hint}"?` : '.'}`,
                code: 'jrxml.schema.unknownAttribute',
            });
        }
    }

    for (const [name, spec] of Object.entries(rule.attrs)) {
        const attr = node.attrs.get(name);
        if (!attr) {
            if (spec.required) {
                push({
                    offset: node.startTag + 1,
                    length: localName(node.tag).length,
                    message: `Element <${canonical(node.tag)}> requires the "${name}" attribute.`,
                    code: 'jrxml.schema.missingAttribute',
                });
            }
            continue;
        }

        if (spec.enum && !spec.enum.includes(attr.value)) {
            push({
                offset: attr.valueStart,
                length: attr.valueEnd - attr.valueStart,
                message: `Invalid value "${attr.value}" for <${canonical(node.tag)}> attribute "${name}"; expected ${spec.enum.join(', ')}.`,
                code: 'jrxml.schema.invalidValue',
            });
        }

        if (spec.deprecatedBy) {
            push({
                offset: attr.nameStart,
                length: attr.name.length,
                message: `Attribute "${name}" on <${canonical(node.tag)}> is deprecated; use ${spec.deprecatedBy} instead.`,
                code: 'jrxml.schema.deprecatedAttribute',
            });
        }
    }
}

function checkReportOrder(node: XmlNode, push: (finding: SchemaFinding) => void): void {
    const rank = new Map(REPORT_LEVEL_ORDER.map((tag, index) => [tag, index]));
    let previousRank = -1;
    let previousTag = '';

    for (const child of node.children) {
        const tag = canonical(child.tag);
        const childRank = rank.get(tag);
        if (childRank === undefined) continue; // unknown/unmodelled: already handled

        if (childRank < previousRank) {
            push({
                offset: child.startTag + 1,
                length: tag.length,
                message: `<${tag}> must appear before <${previousTag}> in <jasperReport>.`,
                code: 'jrxml.schema.elementOrder',
            });
        } else {
            previousRank = childRank;
            previousTag = tag;
        }
    }
}

/** Every structural schema finding for one document. */
export function checkSchema(scan: XmlScanResult | null): SchemaFinding[] {
    if (!scan || scan.error || !scan.doc) return [];

    const findings: SchemaFinding[] = [];
    const push = (finding: SchemaFinding): void => { findings.push(finding); };

    const visit = (node: XmlNode): void => {
        const namespaced = isNamespaced(node.tag);
        const tag = canonical(node.tag);
        const rule = namespaced ? undefined : ruleFor(node.tag);
        const parent = node.parent;
        const parentRule = parent && !isNamespaced(parent.tag) ? ruleFor(parent.tag) : undefined;
        const parentTag = parent ? canonical(parent.tag) : '';

        // Unknown child under a parent whose vocabulary is fully known.
        if (!namespaced && parent && parentRule && parentRule.children
            && !parentRule.children.includes(tag)) {
            const hint = suggestName(tag, parentRule.children);
            push({
                offset: node.startTag + 1,
                length: tag.length,
                message: `Unknown element <${tag}> inside <${parentTag}>${hint ? `. Did you mean <${hint}>?` : '.'}`,
                code: 'jrxml.schema.unknownElement',
            });
            return; // do not cascade through a typo
        }

        if (rule) checkAttributes(node, rule, push);
        if (!namespaced && tag === 'jasperReport') checkReportOrder(node, push);

        for (const child of node.children) visit(child);
    };

    visit(scan.doc.root);
    findings.sort((a, b) => a.offset - b.offset || a.code.localeCompare(b.code));
    return findings;
}
