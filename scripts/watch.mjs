// Development watcher: both TypeScript projects plus a one-shot data copy.
// Assets are static, so a restart (or a rebuild) is enough when data/ changes.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

const dataDir = path.join(root, 'data');
if (existsSync(dataDir)) {
    const outData = path.join(root, 'out', 'data');
    mkdirSync(outData, { recursive: true });
    cpSync(dataDir, outData, { recursive: true });
}

const children = [
    spawn(process.execPath, [tsc, '-w', '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' }),
    spawn(process.execPath, [tsc, '-w', '-p', 'tsconfig.webview.json'], { cwd: root, stdio: 'inherit' }),
];

let stopping = false;
function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill();
    process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const child of children) {
    child.on('exit', code => {
        if (code !== 0 && code !== null) stop(code);
    });
}
