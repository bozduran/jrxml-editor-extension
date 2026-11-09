// jasperTokens.ts
// Shared scanning of JasperReports `$F{}` / `$P{}` / `$V{}` / `$R{}` / `$X{}`
// (and the `$P!{}` query form), used by the expression and query checkers.

/** Offset just past the opening `{`, or -1 when no fragment starts here. */
function fragmentBodyStart(text: string, index: number): number {
    if (text[index] !== '$' || !/[FPVRXfpvrx]/.test(text[index + 1] || '')) return -1;
    if (text[index + 2] === '{') return index + 3;
    if (text[index + 2] === '!' && text[index + 3] === '{') return index + 4;
    return -1;
}

export function isFragmentStart(text: string, index: number): boolean {
    return fragmentBodyStart(text, index) !== -1;
}

/** Offset just past the closing `}` (or the end of the text). */
export function skipFragment(text: string, index: number): number {
    let cursor = fragmentBodyStart(text, index);
    if (cursor === -1) return index;
    while (cursor < text.length && text[cursor] !== '}') cursor++;
    return cursor + 1;
}
