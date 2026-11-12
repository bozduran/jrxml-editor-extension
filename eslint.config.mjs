import globals from "globals";
import tseslint from "typescript-eslint";

// typescript-eslint's base and recommended blocks have no `files` filter, so
// scope them to TypeScript: the repository also carries CommonJS tests and
// scripts where `require()` is correct.
const typescriptRecommended = tseslint.configs.recommended.map(config => ({
    ...config,
    files: config.files ?? ["**/*.ts"],
}));

export default tseslint.config(
    {
        // The Extension Host suite downloads VS Code here; never lint it.
        ignores: [".vscode-test/**", "out/**", ".npm-cache/**"],
    },
    ...typescriptRecommended,
    {
        // Rules that need the compiler's project graph. Both projects are
        // listed so host sources and the DOM client each resolve to their own
        // tsconfig.
        files: ["**/*.ts"],
        languageOptions: {
            parserOptions: {
                project: ["./tsconfig.json", "./tsconfig.webview.json"],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/await-thenable": "error",
        },
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            globals: {
                ...globals.commonjs,
                ...globals.node,
            },

            ecmaVersion: 2022,
            // The extension sources are CommonJS (require/module.exports), not ESM.
            sourceType: "commonjs",
        },

        rules: {
            "no-const-assign": "warn",
            "no-this-before-super": "warn",
            "no-undef": "warn",
            "no-unreachable": "warn",
            "no-unused-vars": ["warn", {
                argsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
            }],
            "constructor-super": "warn",
            "valid-typeof": "warn",
        },
    },
    {
        files: ["**/*.mjs", "scripts/**/*.mjs"],
        languageOptions: {
            globals: { ...globals.node },
            ecmaVersion: 2022,
            sourceType: "module",
        },
        rules: {
            "no-undef": "warn",
            "no-unused-vars": ["warn", {
                argsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
            }],
        },
    },
    {
        // The design-view client is an inlined browser script, not a Node module.
        files: ["designViewClient.ts"],
        languageOptions: {
            globals: {
                ...globals.browser,
                acquireVsCodeApi: "readonly",
                INITIAL_MODEL: "readonly",
                INITIAL_FILE: "readonly",
                INITIAL_VERSION: "readonly",
            },
        },
    },
    {
        // Extension Host tests run under mocha (suite/test/suiteSetup/…).
        files: ["integration/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.mocha,
            },
        },
    },
);
