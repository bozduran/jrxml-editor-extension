import globals from "globals";

export default [{
    // The Extension Host suite downloads VS Code here; never lint it.
    ignores: [".vscode-test/**"],
}, {
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
}, {
    // Extension Host tests run under mocha (suite/test/suiteSetup/…).
    files: ["integration/**/*.js"],
    languageOptions: {
        globals: {
            ...globals.mocha,
        },
    },
}];
