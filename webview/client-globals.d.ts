// Ambient globals injected by designViewHtml into the webview document.
// Kept in the webview project so the DOM client can be checked without Node
// types leaking into it.

declare function acquireVsCodeApi<TState = unknown>(): {
    postMessage(message: unknown): void;
    getState(): TState | undefined;
    setState(state: TState): void;
};

declare const INITIAL_MODEL: unknown;
declare const INITIAL_FILE: string;
declare const INITIAL_VERSION: number | null;
