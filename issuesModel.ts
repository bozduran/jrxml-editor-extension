// issuesModel.ts
// Pure grouping layer for the "Issues (JRXML)" view.
//
// vscode-free so the bucketing/sorting rules can be unit-tested. The view maps
// vscode diagnostics and file-level actions into `Issue` records, then calls
// groupIssues().

export type IssueGroup = 'error' | 'warning' | 'action';

/** A VS Code command shape, kept structural so this module stays vscode-free. */
export interface IssueCommand {
    readonly command: string;
    readonly title?: string;
    readonly arguments?: readonly unknown[];
}

export interface Issue {
    readonly group: IssueGroup;
    readonly label: string;
    readonly message: string;
    readonly code?: string;
    readonly line: number;
    readonly character: number;
    readonly endLine?: number;
    readonly endCharacter?: number;
    readonly uri?: unknown;
    readonly command?: IssueCommand;
    readonly diagnostic?: unknown;
}

export interface IssueGroupDescriptor {
    readonly id: string;
    readonly title: string;
    readonly group: IssueGroup;
}

export interface IssueGroupView extends IssueGroupDescriptor {
    readonly items: Issue[];
}

export interface GroupInfo {
    readonly id: string;
    readonly title: string;
}

/** Groups in display order. */
export const GROUPS: readonly IssueGroupDescriptor[] = [
    { id: 'errors',   title: 'Errors',   group: 'error' },
    { id: 'warnings', title: 'Warnings', group: 'warning' },
    { id: 'actions',  title: 'Actions',  group: 'action' },
];

const GROUP_BY_ID = new Map<IssueGroup, GroupInfo>(
    GROUPS.map(({ group, id, title }) => [group, { id, title }])
);

function compareIssues(a: Issue, b: Issue): number {
    if (a.line !== b.line) return a.line - b.line;
    if (a.character !== b.character) return a.character - b.character;
    return String(a.label).localeCompare(String(b.label));
}

/**
 * Bucket issues into the fixed group order, sorted by position. Empty groups
 * are dropped.
 */
export function groupIssues(
    items: readonly Issue[] | null | undefined
): IssueGroupView[] {
    const buckets = new Map<IssueGroup, Issue[]>();
    for (const { group } of GROUPS) buckets.set(group, []);

    for (const item of items || []) {
        const bucket = buckets.get(item.group);
        if (bucket) bucket.push(item);
    }

    return GROUPS
        .map(({ id, title, group }) => ({
            id,
            title,
            group,
            items: (buckets.get(group) ?? []).sort(compareIssues),
        }))
        .filter(({ items: groupItems }) => groupItems.length > 0);
}

/** Total number of issues across groups. */
export function countIssues(
    groups: readonly IssueGroupView[] | null | undefined
): number {
    return (groups || []).reduce((total, group) => total + group.items.length, 0);
}

/** Display metadata for a group id, or null. */
export function groupInfo(group: string): GroupInfo | null {
    return GROUP_BY_ID.get(group as IssueGroup) || null;
}
