// completionProvider.js
// Registers the JRXML editor completion provider.
//
// The suggestion engine itself lives in the vscode-free expressionSuggestions
// module, which is shared with the design-view inspector's expression editor so
// both surfaces offer exactly the same fields, parameters, variables, built-ins,
// Java types and typed-member completions.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { EXPRESSION_TAGS, findExpressionRegionAt } = require('./expressionUtils');
const { parseDeclarations } = require('./jrxmlParser');
const { buildExpressionSuggestions, suggestionOptions } = require('./expressionSuggestions');
const { reportLanguage } = require('./reportLanguage');
const { resourceEntriesForDocument } = require('./resourceIndex');
const { visibleDeclarations } = require('./reportSymbols');

// ── Custom Java Method Scanner & Cache ───────────────────────────────────────

let cachedCustomJavaMethods = null;

/** Drop the cached Java scan (call when .java files or workspace folders change). */
function clearCustomJavaCache() {
    cachedCustomJavaMethods = null;
}

function getCustomJavaMethods() {
    // Return cached results if we already scanned the project
    if (cachedCustomJavaMethods) return cachedCustomJavaMethods;

    cachedCustomJavaMethods = [];

    // Get the current workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return cachedCustomJavaMethods;

    for (const folder of workspaceFolders) {
        const javaSrcPath = path.join(folder.uri.fsPath, 'src', 'main', 'java');
        try {
            if (fs.existsSync(javaSrcPath)) {
                scanDirectoryForJavaMethods(javaSrcPath, cachedCustomJavaMethods);
            }
        } catch (err) {
            console.error(`Error scanning ${javaSrcPath}:`, err);
        }
    }

    return cachedCustomJavaMethods;
}

function scanDirectoryForJavaMethods(dir, results) {
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (_) {
        return; // unreadable/unavailable directory — skip silently
    }

    for (const file of files) {
        const fullPath = path.join(dir, file);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch (_) {
            continue; // entry disappeared mid-scan
        }
        if (stat.isDirectory()) {
            scanDirectoryForJavaMethods(fullPath, results); // Recursive call
        } else if (fullPath.endsWith('.java')) {
            extractStaticMethods(fullPath, results);
        }
    }
}

function extractStaticMethods(filePath, results) {

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Find class name
        const classMatch = content.match(/public\s+(?:final\s+)?class\s+(\w+)/);
        if (!classMatch) return; // Skip if no public class found
        const className = classMatch[1];

        // Find package name
        const packageMatch = content.match(/package\s+([\w.]+);/);
        const pkg = packageMatch ? packageMatch[1] : '';

        // Match public static methods
        const methodRegex = /public\s+static\s+([\w<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)/g;
        let match;

        while ((match = methodRegex.exec(content)) !== null) {
            const returnType = match[1];
            const methodName = match[2];
            const argsString = match[3].trim();

            // Convert arguments to VS Code snippet format: String name, int age -> ${1:name}, ${2:age}
            let snippetArgs = '';
            if (argsString) {
                const args = argsString.split(',').map(a => a.trim());
                snippetArgs = args.map((arg, index) => {
                    const varName = arg.split(/\s+/).pop();
                    return `\${${index + 1}:${varName}}`;
                }).join(', ');
            }

            results.push({
                label: `${className}.${methodName}`,
                detail: `${className}.${methodName}(${argsString}) : ${returnType}`,
                doc: `**Class:** \`${pkg}.${className}\`\n\nReturns: \`${returnType}\``,
                snippet: `${className}.${methodName}(${snippetArgs})`
            });
        }
    } catch (err) {
        console.error(`Error scanning Java file ${filePath}:`, err);
    }
}

// ── Expression tag check ──────────────────────────────────────────────────────
// <query> is not an expression element for formatting, but it carries $P!{}
// fragments, so completion must activate inside it too.
const COMPLETION_TAGS = [...EXPRESSION_TAGS, 'query'];

function isInsideExpressionTag(document, position) {
    return !!findExpressionRegionAt(
        document,
        document.offsetAt(position),
        COMPLETION_TAGS
    );
}

// ── Mapping suggestions to CompletionItems ──────────────────────────────────

const KIND_MAP = {
    field:     vscode.CompletionItemKind.Field,
    parameter: vscode.CompletionItemKind.TypeParameter,
    variable:  vscode.CompletionItemKind.Variable,
    function:  vscode.CompletionItemKind.Function,
    class:     vscode.CompletionItemKind.Class,
    method:    vscode.CompletionItemKind.Method,
    reference: vscode.CompletionItemKind.Reference,
    text:      vscode.CompletionItemKind.Text,
};

function toCompletionItem(suggestion) {
    const label = suggestion.labelDetail
        ? {
            label:       suggestion.label,
            detail:      suggestion.labelDetail,
            description: suggestion.labelDescription,
        }
        : suggestion.label;

    const item = new vscode.CompletionItem(
        label,
        KIND_MAP[suggestion.kind] ?? vscode.CompletionItemKind.Text
    );

    item.detail        = suggestion.detail || suggestion.label;
    item.documentation = new vscode.MarkdownString(suggestion.documentation || '');
    item.insertText    = new vscode.SnippetString(suggestion.insertTextSnippet || '');
    if (suggestion.filterText) item.filterText = suggestion.filterText;
    if (suggestion.sortText) item.sortText = suggestion.sortText;
    if (suggestion.deprecated) item.tags = [vscode.CompletionItemTag.Deprecated];

    return item;
}

// ── Provider ──────────────────────────────────────────────────────────────────
const provider = vscode.languages.registerCompletionItemProvider(
    { language: 'jrxml' },
    {
        provideCompletionItems(document, position) {
            if (!isInsideExpressionTag(document, position)) return [];

            const config = vscode.workspace.getConfiguration('jrxml');
            const text   = document.getText();

            let decls;
            try {
                decls = parseDeclarations(document);
            } catch (_) {
                decls = {
                    fields: [], parameters: [], variables: [],
                    allFields: [], allParameters: [], allVariables: [], groups: [],
                };
            }

            const options = suggestionOptions(config);
            // The member index models JDK/Java types; do not apply it to a
            // report that declares Groovy or JavaScript.
            if ((decls.language || reportLanguage(text)).language !== 'java') options.typedCompletion = false;

            const offset = document.offsetAt(position);
            const result = buildExpressionSuggestions({
                text,
                offset,
                // Only the declarations visible at the cursor: a subdataset
                // must not offer the master report's fields, and vice versa.
                declarations: visibleDeclarations(decls, offset),
                options,
                customMethods: getCustomJavaMethods(),
                resources: resourceEntriesForDocument(document, decls.resourceBundle),
            });

            return result.items.map(toCompletionItem);
        }
    },
    '$', '{', ' ', '.', '('
);

module.exports = {
    provider,
    clearCustomJavaCache,
    getCustomJavaMethods,
};
