// fileIssues.js
// File-level issues that belong in the Best Practices view but are not
// per-expression rule hits:
//
//   sort  — the document's band/frame elements are not ordered by position
//   query — the document has a SQL <query> that can be migrated
//
// Pure and vscode-free: callers turn each issue into a tree item whose command
// runs the matching action.

const { discoverSortFix } = require('./xmlSort');
const { discoverClearFixes } = require('./xmlClear');

const SORT_KIND  = 'sort';
const QUERY_KIND = 'query';

/**
 * @param {string} text
 * @param {{ targetLanguage?:string }} [options]
 * @returns {{ kind:string, title:string, detail:string, command:string }[]}
 */
function collectFileIssues(text, options = {}) {
    const targetLanguage = options.targetLanguage || 'jsonql';
    const issues = [];

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

module.exports = { collectFileIssues, SORT_KIND, QUERY_KIND };
