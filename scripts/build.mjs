// Build the extension: clean out/, compile the host project and the webview
// client project, then copy the data assets the host reads at runtime.
//
// Both projects emit into out/ so the compiled module graph keeps the same
// relative paths it had at the repository root. `npm test` depends on `build`
// (pretest), and vsce runs `vscode:prepublish` before packaging.

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

function compile(project) {
    const result = spawnSync(process.execPath, [tsc, '-p', project], {
        cwd: root,
        stdio: 'inherit',
    });
    if (result.error) {
        console.error(result.error.message);
        process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(path.join(root, 'out'), { recursive: true, force: true });
compile(path.join('tsconfig.json'));
compile(path.join('tsconfig.webview.json'));

const dataDir = path.join(root, 'data');
if (existsSync(dataDir)) {
    const outData = path.join(root, 'out', 'data');
    mkdirSync(outData, { recursive: true });
    cpSync(dataDir, outData, { recursive: true });
}

console.log('Built out/ (extension, webview client, data).');
