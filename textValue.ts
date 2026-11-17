// textValue.ts
// One implementation of "untrusted value → text".
//
// The callers here write into HTML, into a MarkdownString, into an XML
// attribute, into a completion item or into a banner. The values arrive from
// webview messages, JSON data files and file content, so they are typed
// `unknown`: `String(value)` would render an object as '[object Object]', text
// that reads as real content to every one of those targets. Only scalars have a
// text form, so the conversion is explicit instead.
//
// Pure and vscode-free. The design-view client cannot import it (that file stays
// a script), which is why it keeps its own scalar check.

/** Text form of a scalar value; `null`, `undefined` and objects give `''`. */
export function textOf(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    return '';
}
