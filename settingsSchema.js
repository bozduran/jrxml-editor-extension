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
            {
                key: 'expressionEditor.autoFormat', type: 'boolean', default: false,
                label: 'Auto-format expressions',
                description: 'Remember the Expression Editor\'s \u201cAuto-format on change\u201d checkbox.',
            },
            {
                key: 'typeCompletion.enabled', type: 'boolean', default: true,
                label: 'Typed member completion',
                description: "Suggest the Java members of a field, parameter or variable type after a '.' (for example $F{customer}.get).",
            },
            {
                key: 'typeCompletion.jdkBaseline', type: 'string', default: '8',
                label: 'Target Java version',
                description: 'Members added after this version (String.isBlank, List.getFirst, ...) are not suggested. 8 matches JasperReports 6.x, 11 matches 7.x.',
            },
        ],
    },
    {
        id: 'ifElse',
        title: 'If / Else builder',
        description: 'Defaults when the If / Else builder opens',
        settings: [
            {
                key: 'ifElse.nullSafe', type: 'boolean', default: true,
                label: 'Null-safe by default',
                description: 'Start with null guards around field, parameter and variable dereferences.',
            },
            {
                key: 'ifElse.multiline', type: 'boolean', default: true,
                label: 'Multi-line by default',
                description: 'Start with readable multi-line output instead of one long line.',
            },
            {
                key: 'ifElse.style', type: 'string', default: 'ternary',
                label: 'Output style',
                description: 'Ternary ( ? : ) or the Jaspersoft functions IF() / AND() / OR().',
                options: [
                    ['ternary', 'Ternary ( ? : )'],
                    ['functions', 'IF() / AND() / OR()'],
                ],
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
            {
                key: 'lint.variableOrder', type: 'boolean', default: true,
                label: 'Variable used before declaration',
                description: 'Warn when a variable references another variable declared later (JasperReports evaluates variables in declaration order).',
            },
            {
                key: 'lint.booleanEquals', type: 'boolean', default: true,
                label: 'Boolean comparisons',
                description: 'Warn when a Boolean field, parameter or variable is compared with == / != or Boolean.TRUE/FALSE.equals instead of EQUALS().',
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
                key: 'textcheck.diagnostics', type: 'boolean', default: true,
                label: 'Text check warnings',
                description: 'Show warnings with quick fixes for double spaces, a missing space after \'.\', unrenderable characters and newlines in text and string literals.',
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
