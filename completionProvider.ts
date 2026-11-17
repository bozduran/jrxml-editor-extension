// completionProvider.ts
// Registers the JRXML editor completion provider.
//
// The suggestion engine itself lives in the vscode-free expressionSuggestions
// module, which is shared with the design-view inspector's expression editor so
// both surfaces offer exactly the same fields, parameters, variables, built-ins,
// Java types and typed-member completions.

import * as vscode from 'vscode';
import { EXPRESSION_TAGS, findExpressionRegionAt } from './expressionUtils';
import { parseDeclarations } from './jrxmlParser';
import type { ParseResult } from './jrxmlParser';
import { buildExpressionSuggestions, suggestionOptions } from './expressionSuggestions';
import type { CustomMethod, ExpressionSuggestion, SuggestionKind } from './expressionSuggestions';
import { getJavaProjectIndex } from './javaProjectIndex';
import { javaSourcePaths } from './javaSettings';
import { reportLanguage } from './reportLanguage';
import { resourceEntriesForDocument } from './resourceIndex';
import { visibleDeclarations } from './reportSymbols';

// ── Custom Java Method Scanner & Cache ───────────────────────────────────────
// The scan itself and its cache live in javaProjectIndex so lint reads exactly
// the same class table as completion.

function getCustomJavaMethods(): CustomMethod[] {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return [];

    return getJavaProjectIndex(
        workspaceFolders.map(folder => folder.uri.fsPath),
        { extraPaths: javaSourcePaths(vscode.workspace.getConfiguration('jrxml')) }
    ).methods;
}

// ── Expression tag check ──────────────────────────────────────────────────────
// <query> is not an expression element for formatting, but it carries $P!{}
// fragments, so completion must activate inside it too.
const COMPLETION_TAGS: readonly string[] = [...EXPRESSION_TAGS, 'query'];

function isInsideExpressionTag(document: vscode.TextDocument, position: vscode.Position): boolean {
    return !!findExpressionRegionAt(
        document,
        document.offsetAt(position),
        COMPLETION_TAGS
    );
}

// ── Mapping suggestions to CompletionItems ──────────────────────────────────

const KIND_MAP: Readonly<Record<SuggestionKind, vscode.CompletionItemKind>> = {
    field:     vscode.CompletionItemKind.Field,
    parameter: vscode.CompletionItemKind.TypeParameter,
    variable:  vscode.CompletionItemKind.Variable,
    function:  vscode.CompletionItemKind.Function,
    class:     vscode.CompletionItemKind.Class,
    method:    vscode.CompletionItemKind.Method,
    reference: vscode.CompletionItemKind.Reference,
    text:      vscode.CompletionItemKind.Text,
};

function toCompletionItem(suggestion: ExpressionSuggestion): vscode.CompletionItem {
    const label = suggestion.labelDetail
        ? {
            label:       suggestion.label,
            detail:      suggestion.labelDetail,
            // Omitted rather than set to `undefined`: exactOptionalPropertyTypes.
            ...(suggestion.labelDescription !== undefined
                ? { description: suggestion.labelDescription }
                : {}),
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

// A parse result stand-in for documents the parser cannot read; only its
// (empty) declaration lists and absent bundle are consulted.
const EMPTY_PARSE: ParseResult = {
    fields: [], parameters: [], variables: [],
    dataset: { fields: [], parameters: [], variables: [] },
    language: { language: 'java', declared: false, offset: -1, length: 0 },
    allFields: [], allParameters: [], allVariables: [],
    groups: [], styles: [], references: [], resourceReferences: [],
    resourceBundle: null, imports: [], datasets: [], scopeRanges: [], outline: [],
};

// ── Provider ──────────────────────────────────────────────────────────────────
const provider = vscode.languages.registerCompletionItemProvider(
    { language: 'jrxml' },
    {
        provideCompletionItems(
            document: vscode.TextDocument,
            position: vscode.Position
        ): vscode.CompletionItem[] {
            if (!isInsideExpressionTag(document, position)) return [];

            const config = vscode.workspace.getConfiguration('jrxml');
            const text   = document.getText();

            let decls: ParseResult | null = null;
            try {
                decls = parseDeclarations(document);
            } catch {
                decls = null;
            }

            const options = suggestionOptions(config);
            // The member index models JDK/Java types; do not apply it to a
            // report that declares Groovy or JavaScript.
            if (((decls && decls.language) || reportLanguage(text)).language !== 'java') options.typedCompletion = false;

            const offset = document.offsetAt(position);
            const result = buildExpressionSuggestions({
                text,
                offset,
                // Only the declarations visible at the cursor: a subdataset
                // must not offer the master report's fields, and vice versa.
                declarations: visibleDeclarations(decls ?? EMPTY_PARSE, offset),
                options,
                customMethods: getCustomJavaMethods(),
                resources: resourceEntriesForDocument(document, decls ? decls.resourceBundle : null),
            });

            return result.items.map(toCompletionItem);
        }
    },
    '$', '{', ' ', '.', '('
);

export {
    provider,
    getCustomJavaMethods,
};
