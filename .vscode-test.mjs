import { defineConfig } from '@vscode/test-cli';

// Extension Host smoke suite. Unit tests live in test/ and run with
// `npm test` (plain Node); this suite needs a real VS Code instance.
export default defineConfig({
    files: 'integration/**/*.test.js',
    version: 'stable',
    launchArgs: [
        '--disable-extensions',
        '--disable-workspace-trust',
        // Chromium's sandbox is unavailable in most CI containers.
        '--no-sandbox',
    ],
    mocha: {
        ui: 'tdd',
        timeout: 60000,
    },
});
