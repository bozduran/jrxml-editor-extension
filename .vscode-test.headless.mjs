import { defineConfig } from '@vscode/test-cli';

// Same Extension Host suite as .vscode-test.mjs, but on Electron's headless
// Ozone platform. This runs in CI containers and sandboxes that have no X or
// Wayland display, without needing Xvfb.
export default defineConfig({
    files: 'integration/**/*.test.js',
    version: 'stable',
    workspaceFolder: './integration/workspace',
    launchArgs: [
        '--disable-extensions',
        '--disable-workspace-trust',
        '--no-sandbox',
        '--headless',
        '--disable-gpu',
        '--ozone-platform=headless',
    ],
    mocha: {
        ui: 'tdd',
        timeout: 60000,
    },
});
