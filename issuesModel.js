// issuesModel.js
// Pure grouping layer for the "Issues (JRXML)" view.
//
// vscode-free so the bucketing/sorting rules can be unit-tested. The view maps
// vscode diagnostics and file-level actions into `Issue` records, then calls
// groupIssues().
//
//   Issue = { group:'error'|'warning'|'action', label, message, code?, line,
//             character, endLine?, endCharacter?, command?, diagnostic? }

/** Groups in display order. */
const GROUPS = [
    { id: 'errors',   title: 'Errors',   group: 'error' },
    { id: 'warnings', title: 'Warnings', group: 'warning' },
    { id: 'actions',  title: 'Actions',  group: 'action' },
];

const GROUP_BY_ID = new Map(GROUPS.map(({ group, id, title }) => [group, { id, title }]));

function compareIssues(a, b) {
    if (a.line !== b.line) return a.line - b.line;
    if (a.character !== b.character) return a.character - b.character;
    return String(a.label).localeCompare(String(b.label));
}

/**
 * Bucket issues into the fixed group order, sorted by position. Empty groups
 * are dropped.
 *
 * @param {Issue[]} items
 * @returns {{ id:string, title:string, group:string, items:Issue[] }[]}
 */
function groupIssues(items) {
    const buckets = new Map(GROUPS.map(({ group }) => [group, []]));

    for (const item of items || []) {
        const bucket = buckets.get(item.group);
        if (bucket) bucket.push(item);
    }

    return GROUPS
        .map(({ id, title, group }) => ({
            id,
            title,
            group,
            items: buckets.get(group).sort(compareIssues),
        }))
        .filter(({ items: groupItems }) => groupItems.length > 0);
}

/** Total number of issues across groups. */
function countIssues(groups) {
    return (groups || []).reduce((total, group) => total + group.items.length, 0);
}

/** Display metadata for a group id, or null. */
function groupInfo(group) {
    return GROUP_BY_ID.get(group) || null;
}

module.exports = { GROUPS, groupIssues, countIssues, groupInfo };
