// settingsSchema.js
// The settings shown in the JRXML settings panel, grouped for display.
//
// Defaults and types must match package.json's `contributes.configuration`;
// test/settingsSchema.test.js enforces that so the panel can never drift.
//
// Keys are relative to the `jrxml` section, so `format.expression` maps to
// `jrxml.format.expression`.

const SECTION = 'jrxml';

const SETTINGS_GROUPS = [
    {
        id: 'editor',
        title: 'Editor',
        description: 'Expression editor behaviour',
        settings: [
            {
                key: 'indentSize', type: 'number', default: 4,
                label: 'Indent size',
                description: 'Spaces per indent level when formatting expressions.',
            },
            {
                key: 'autoOpenEditor', type: 'boolean', default: false,
                label: 'Auto-open editor',
                description: 'Open the expression editor when the cursor enters an expression.',
            },
        ],
    },
    {
        id: 'diagnostics',
        title: 'Diagnostics',
        description: 'Inline warnings and errors on .jrxml files',
        settings: [
            {
                key: 'showUnusedWarnings', type: 'boolean', default: true,
                label: 'Unused declarations',
                description: 'Warn about declared fields, parameters or variables that are never used in any expression.',
            },
            {
                key: 'validateExpressions', type: 'boolean', default: true,
                label: 'Expression validation',
                description: 'Error on unbalanced parentheses, unclosed strings and undeclared $F/$P/$V references.',
            },
            {
                key: 'lint.constantPrintWhen', type: 'boolean', default: true,
                label: 'Constant printWhenExpression',
                description: 'Warn when a <printWhenExpression> is a constant \'true\' or \'false\'.',
            },
            {
                key: 'lint.removeLineWhenBlank', type: 'boolean', default: true,
                label: 'removeLineWhenBlank',
                description: 'Warn when a textField or subreport element is missing removeLineWhenBlank="true".',
            },
            {
                key: 'lint.markupTagWithoutMarkup', type: 'boolean', default: true,
                label: 'Markup without markup attribute',
                description: 'Warn when a textField expression contains markup tags but markup is not "styled", "html" or "rtf".',
            },
            {
                key: 'lint.nullDereference', type: 'boolean', default: true,
                label: 'Unchecked null dereference',
                description: 'Warn when a $F/$P/$V reference is used as a method-call receiver without a dominating null check.',
            },
        ],
    },
    {
        id: 'format',
        title: 'Formatting',
        description: 'The format and text-check steps',
        settings: [
            {
                key: 'format.reportName', type: 'boolean', default: true,
                label: 'Report name',
                description: 'Set jasperReport/@name to the file base name.',
            },
            {
                key: 'format.positionType', type: 'boolean', default: true,
                label: 'positionType',
                description: 'Add/set positionType="Float" on textField and subreport elements.',
            },
            {
                key: 'format.textAdjust', type: 'boolean', default: true,
                label: 'textAdjust',
                description: 'Add/set textAdjust="StretchHeight" on textField elements.',
            },
            {
                key: 'format.expression', type: 'boolean', default: true,
                label: 'Expression spacing',
                description: 'Normalise operator, ternary, comma and cast spacing inside expressions.',
            },
            {
                key: 'textcheck.enabled', type: 'boolean', default: true,
                label: 'Text check',
                description: 'Replace unrenderable characters, fix period spacing, collapse double spaces and normalize newlines.',
            },
            {
                key: 'formatOnSave', type: 'boolean', default: false,
                label: 'Format on save',
                description: 'Run the format + textcheck steps when saving a .jrxml file (never the clear or sort steps).',
            },
        ],
    },
    {
        id: 'clear',
        title: 'Clear and migration',
        description: 'Declaration cleanup and SQL query migration',
        settings: [
            {
                key: 'clear.preview', type: 'boolean', default: true,
                label: 'Preview clear fixes',
                description: 'Show a diff and ask for confirmation before applying clear fixes or a SQL migration.',
            },
            {
                key: 'migrate.targetLanguage', type: 'string', default: 'jsonql',
                label: 'Migration target language',
                description: 'Language written to <query language="..."> when migrating a SQL query.',
            },
        ],
    },
    {
        id: 'sort',
        title: 'Sort',
        description: 'Geometry reordering of band/frame elements',
        settings: [
            {
                key: 'sort.preview', type: 'boolean', default: true,
                label: 'Preview sort',
                description: 'Show a diff and ask for confirmation before applying the geometry sort.',
            },
        ],
    },
    {
        id: 'bestPractices',
        title: 'Best practices',
        description: 'Suppression list for the rules engine',
        settings: [
            {
                key: 'suppressedBestPractices', type: 'array', default: [],
                label: 'Suppressed rules',
                description: 'Best-practice rule IDs whose squiggles are hidden. Quick fixes remain available.',
            },
        ],
    },
];

/** Flat list of every setting in panel order. */
function allSettings() {
    return SETTINGS_GROUPS.flatMap(group => group.settings);
}

/** `{ key: default }` for every setting. */
function defaults() {
    const out = {};
    for (const setting of allSettings()) out[setting.key] = setting.default;
    return out;
}

module.exports = { SECTION, SETTINGS_GROUPS, allSettings, defaults };
