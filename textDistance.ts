// textDistance.ts
// Bounded edit distance and "did you mean" suggestions.
//
// Pure and vscode-free: the schema checks and the Java symbol checks use the
// same implementation, so a suggestion never depends on which rule asked.

/**
 * Levenshtein distance, cut off at `limit`. A return value greater than `limit`
 * means "too far apart" and is not a meaningful exact distance.
 */
export function editDistance(a: string, b: string, limit = 2): number {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > limit) return limit + 1;

    const previous = new Array<number>(b.length + 1);
    const current = new Array<number>(b.length + 1);
    for (let j = 0; j <= b.length; j++) previous[j] = j;

    for (let i = 1; i <= a.length; i++) {
        current[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost
            );
        }
        for (let j = 0; j <= b.length; j++) previous[j] = current[j];
    }
    return previous[b.length];
}

/** The closest candidate within `limit`, or null when none is close enough. */
export function suggestName(
    name: string,
    candidates: Iterable<string>,
    limit = 2
): string | null {
    let best: string | null = null;
    let bestDistance = limit + 1;

    for (const candidate of candidates) {
        const distance = editDistance(name, candidate, limit);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
            if (distance === 1) break; // cannot do better than one edit
        }
    }
    return bestDistance <= limit ? best : null;
}
