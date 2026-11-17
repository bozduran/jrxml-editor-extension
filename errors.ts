// errors.ts
// Stable message extraction from an `unknown` catch value.
//
// Pure and vscode-free: the panels, the analysis pipeline and the tests all
// report errors through this one function instead of four copies.

/** The message a thrown value carries, or its string form. */
export function errorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
        const message = (err as { message?: unknown }).message;
        if (message) return String(message);
    }
    return String(err);
}
