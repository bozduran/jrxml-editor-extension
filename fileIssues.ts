// fileIssues.ts
// File-level issues that belong in the Issues view but are not
// per-expression rule hits:
//
//   sort  — the document's band/frame elements are not ordered by position
//   query — the document has a SQL <query> that can be migrated
//
// Pure and vscode-free: callers turn each issue into a tree item whose command
// runs the matching action.

import { discoverSortFix } from './xmlSort';
import { discoverClearFixes } from './xmlClear';

const SORT_KIND  = 'sort';
const QUERY_KIND = 'query';

/** One file-level action offered by the Issues view and the JRXML menu. */
export interface FileIssue {
    kind: string;
    title: string;
    detail: string;
    command: string;
}

export interface FileIssueOptions {
    targetLanguage?: string;
}

function collectFileIssues(text: string, options: FileIssueOptions = {}): FileIssue[] {
    const targetLanguage = options.targetLanguage || 'jsonql';
    const issues: FileIssue[] = [];

    const sort = discoverSortFix(text);
    if (sort) {
        issues.push({
            kind:    SORT_KIND,
            title:   'Elements are not sorted by position',
            detail:  sort.description,
            command: 'jrxml.sortElements',
        });
    }

    const migration = discoverClearFixes(text).find(group => group.label === 'query migration');
    if (migration) {
        issues.push({
            kind:    QUERY_KIND,
            title:   `SQL query can be migrated to ${targetLanguage}`,
            detail:  migration.fixes[0].description,
            command: 'jrxml.migrateSqlQuery',
        });
    }

    return issues;
}

export { collectFileIssues, SORT_KIND, QUERY_KIND };
