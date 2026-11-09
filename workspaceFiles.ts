// workspaceFiles.ts
// The workspace scan contract shared by the editor command, the CI validator
// and the include-chain view: which directories and files are out of scope.

export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
    'node_modules', '.git', 'out', 'target', 'bin', 'dist',
    '.vscode-test', '.dsh', 'coverage',
]);

export const EXCLUDE_GLOB = '**/{node_modules,.git,out,target,bin,dist,.vscode-test,.dsh,coverage}/**';
