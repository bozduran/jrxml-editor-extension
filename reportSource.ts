// reportSource.ts
// The parser's input seam. A report source is text plus a stable identity and a
// version, so one adapter serves a VS Code document and one serves headless
// callers (diagnostics, subreport resolution, tests).

export interface ReportSource {
    text: string;
    id: string;
    version: number;
}

/** The slice of a VS Code TextDocument this adapter needs. */
export interface TextDocumentLike {
    getText(): string;
    readonly uri: { toString(): string };
    readonly version: number;
}

export function textSource(
    text: string,
    id: string,
    version: number = 0
): ReportSource {
    return {
        text: typeof text === 'string' ? text : '',
        id: String(id ?? ''),
        version,
    };
}

/** Adapt a VS Code TextDocument without leaking its protocol into the parser. */
export function documentSource(document: TextDocumentLike): ReportSource {
    return {
        text: document.getText(),
        id: document.uri.toString(),
        version: document.version,
    };
}
