// expressionMask.ts
// Length-preserving masking of JasperReports references so a report expression
//
// This module is vscode-free: null-deref lint and the Java symbol checks share it.
// can be parsed as Java without shifting its character offsets.
//
// `$F{name}` / `$P{name}` / `$V{name}` become `$F_name_` — same length, and a
// legal identifier. Literals are copied unchanged, so a reference inside a
// string or char literal is never touched. Checks that need AST spans (the
// null-dereference rule and the Java symbol lint) share this implementation.

import { literalEnd } from './javaExpr';

const KINDS: ReadonlySet<string> = new Set(['F', 'P', 'V']);

/** True when `name` can be used as a Java identifier. */
export function isIdentifier(name: string): boolean {
    if (!name || !/[A-Za-z_]/.test(name[0])) return false;
    for (let i = 1; i < name.length; i++) {
        if (!/[A-Za-z0-9_]/.test(name[i])) return false;
    }
    return true;
}

/**
 * Replace `$F{name}` / `$P{name}` / `$V{name}` with `$F_name_` (same length) so
 * the text parses as Java. Literals are copied unchanged, so a reference inside
 * a string or char literal is never masked.
 */
export function maskReferences(code: string): string {
    let out = '';
    let i = 0;
    const n = code.length;

    while (i < n) {
        const end = literalEnd(code, i);
        if (end > i) {
            out += code.slice(i, end);
            i = end;
            continue;
        }

        const c = code[i];
        if (c === '$' && i + 2 < n) {
            const kind = code[i + 1];
            if (KINDS.has(kind) && code[i + 2] === '{') {
                const close = code.indexOf('}', i + 3);
                if (close > i + 3) {
                    const name = code.slice(i + 3, close);
                    const masked = `$${kind}_${name}_`;
                    if (masked.length === close + 1 - i && isIdentifier(name)) {
                        out += masked;
                        i = close + 1;
                        continue;
                    }
                }
            }
        }

        out += c;
        i++;
    }

    return out;
}
