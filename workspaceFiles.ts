// workspaceFiles.js
// The workspace scan contract shared by the editor command, the CI validator
// and the include-chain view: which directories and files are out of scope.

const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', 'out', 'target', 'bin', 'dist',
    '.vscode-test', '.dsh', 'coverage',
]);

const EXCLUDE_GLOB = '**/{node_modules,.git,out,target,bin,dist,.vscode-test,.dsh,coverage}/**';

module.exports = { EXCLUDED_DIRS, EXCLUDE_GLOB };
