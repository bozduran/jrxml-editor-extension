// escaping.ts
// The escaping helpers for the contexts the extension writes into: regular
// expressions, markdown code spans and editor snippets.
//
// Each helper escapes the escape character before the characters it protects.
// That order is the whole bug in CodeQL's "incomplete string escaping or
// encoding": a value ending in `\` followed by an escaped `$` would otherwise
// turn `\` + `\$` into one literal backslash-dollar, and an escaped backtick
// after a literal backslash would lose its escape. Pure and vscode-free.

/** Escape text so it can be interpolated into a RegExp source. */
export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape text for a markdown code span. The backslash comes first so a value
 * that already ends in one cannot swallow the escaped backtick.
 */
export function escapeMarkdownCode(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

/**
 * Escape text for a VS Code snippet ("insertText"). `\` and `$` are the two
 * characters the snippet grammar treats as special, so `\` is doubled first.
 */
export function escapeSnippet(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
}
