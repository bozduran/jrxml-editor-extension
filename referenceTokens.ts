// referenceTokens.ts
// One grammar for `$F{}` / `$P{}` / `$V{}` / `$R{}` tokens.
//
// The same token text is read by the parser, hover/definition/references and
// the unused-declaration collector. Keeping the grammar here stops a name that
// hovers (`my-field`) from being invisible to Find All References.

export type ReferenceSigil = 'F' | 'P' | 'V' | 'R';

export interface ReferenceToken {
    sigil: ReferenceSigil;
    name: string;
    bang: boolean;
    start: number;
    end: number;
}

const TOKEN_SOURCE = '\\$(F|P|V|R)(!?)\\{([^}]+)\\}';

function tokenRegExp(): RegExp {
    return new RegExp(TOKEN_SOURCE, 'g');
}

/** The token under a cursor column, or null. Pure: works on one line. */
export function findReferenceToken(lineText: string, character: number): ReferenceToken | null {
    const re = tokenRegExp();
    let match: RegExpExecArray | null;
    while ((match = re.exec(lineText)) !== null) {
        if (match.index <= character && character <= match.index + match[0].length) {
            return {
                sigil: match[1] as ReferenceSigil,
                name: match[3].trim(),
                bang: match[2] === '!',
                start: match.index,
                end: match.index + match[0].length,
            };
        }
    }
    return null;
}

/** Every token in `text`, in order. */
export function forEachReferenceToken(
    text: string,
    callback: (token: ReferenceToken) => void
): void {
    const re = tokenRegExp();
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        callback({
            sigil: match[1] as ReferenceSigil,
            name: match[3].trim(),
            bang: match[2] === '!',
            start: match.index,
            end: match.index + match[0].length,
        });
    }
}
