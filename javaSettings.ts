// javaSettings.ts
// Host-side readers for the Java settings shared by completion and diagnostics.
//
// This is the only module that decides how `jrxml.java.sourcePaths` and
// `jrxml.typeCompletion.jdkBaseline` are parsed, so completion and lint can
// never disagree about either value.

import * as vscode from 'vscode';
import { normalizeBaseline } from './expressionSuggestions';

/** `jrxml.java.sourcePaths`, ignoring malformed values. */
export function javaSourcePaths(config: vscode.WorkspaceConfiguration): string[] {
    const configured = config.get<unknown>('java.sourcePaths', []);
    if (!Array.isArray(configured)) return [];
    return configured.filter((entry): entry is string => typeof entry === 'string');
}

/** The JDK baseline both the member table and the lint checks use. */
export function javaBaseline(config: vscode.WorkspaceConfiguration): number {
    return normalizeBaseline(config.get('typeCompletion.jdkBaseline', '8'));
}
