// jasperBuiltins.ts
// Single source of truth for JasperReports built-in system variables and
// parameters. Previously these tables were duplicated (and had drifted) across
// the completion, hover and diagnostics providers.

export interface Builtin {
    readonly name: string;
    readonly type: string;
    readonly description: string;
}

/** Built-in system variables ($V{...}). */
export const BUILTIN_VARIABLES: readonly Builtin[] = [
    { name: 'PAGE_NUMBER',         type: 'Integer', description: 'Current page number' },
    { name: 'PAGE_COUNT',          type: 'Integer', description: 'Total number of pages' },
    { name: 'REPORT_COUNT',        type: 'Integer', description: 'Total records processed' },
    { name: 'COLUMN_NUMBER',       type: 'Integer', description: 'Current column number' },
    { name: 'COLUMN_COUNT',        type: 'Integer', description: 'Total number of columns' },
    { name: 'PAGE_VARIABLE_COUNT', type: 'Integer', description: 'Number of variables reset per page' },
    { name: 'MASTER_CURRENT_PAGE', type: 'Integer', description: 'Current page in the master report' },
    { name: 'MASTER_TOTAL_PAGES',  type: 'Integer', description: 'Total pages in the master report' },
];

/** Built-in system parameters ($P{...}). */
export const BUILTIN_PARAMETERS: readonly Builtin[] = [
    { name: 'REPORT_CONNECTION',          type: 'java.sql.Connection',              description: 'JDBC database connection' },
    { name: 'REPORT_DATA_SOURCE',         type: 'JRDataSource',                     description: 'The JRDataSource object' },
    { name: 'REPORT_PARAMETERS_MAP',      type: 'java.util.Map',                    description: 'Map of all report parameters' },
    { name: 'IS_IGNORE_PAGINATION',       type: 'Boolean',                          description: 'Disable pagination when true' },
    { name: 'REPORT_LOCALE',              type: 'java.util.Locale',                 description: 'Report locale' },
    { name: 'REPORT_TIME_ZONE',           type: 'java.util.TimeZone',               description: 'Report time zone' },
    { name: 'REPORT_FORMAT_FACTORY',      type: 'JRFormatFactory',                  description: 'Format factory for dates/numbers' },
    { name: 'REPORT_CLASS_LOADER',        type: 'ClassLoader',                      description: 'Class loader for the report' },
    { name: 'REPORT_URL_HANDLER_FACTORY', type: 'java.net.URLStreamHandlerFactory', description: 'URL handler factory' },
    { name: 'REPORT_VIRTUALIZER',         type: 'JRVirtualizer',                    description: 'Virtualizer for large reports' },
    { name: 'REPORT_MAX_COUNT',           type: 'Integer',                          description: 'Maximum number of records to process' },
    { name: 'REPORT_TEMPLATES',           type: 'java.util.Collection',             description: 'Additional report templates' },
];

export const BUILTIN_VARIABLE_NAMES: ReadonlySet<string> =
    new Set(BUILTIN_VARIABLES.map(v => v.name));
export const BUILTIN_PARAMETER_NAMES: ReadonlySet<string> =
    new Set(BUILTIN_PARAMETERS.map(p => p.name));
