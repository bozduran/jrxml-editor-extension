// staleGuard.js
// The destructive commands (sort, clear, SQL migration) discover their edits,
// then open a diff preview and wait for the user to confirm before applying.
//
// A WorkspaceEdit applies its ranges against the document **as it is now**, not
// as it was when the edits were computed, so edits built before the wait would
// overwrite anything typed (or saved by another tool) in the meantime. This is
// the single, testable definition of that check.

const STALE_MESSAGE =
    'The file changed while this was being prepared, so nothing was applied. Run the command again.';

/** True when the document has moved on from the version the edits were built for. */
function isStale(discoveredVersion, currentVersion) {
    return discoveredVersion !== currentVersion;
}

module.exports = { isStale, STALE_MESSAGE };
