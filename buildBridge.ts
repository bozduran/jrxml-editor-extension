// buildBridge.ts
// "JRXML: Run Build" — a thin bridge to the project's own JasperReports build.
//
// The extension never embeds the report engine. It runs the configured shell
// command as a VS Code task and attaches the contributed $jrxml-* problem
// matchers, so compiler/verifier output lands in the Problems panel. Keep the
// project's Maven/Ant compile + verifyDesign as the authoritative gate.

import * as vscode from 'vscode';
import { defaults } from './settingsSchema';

const defaultBuildCommand = defaults()['build.command'];
export const DEFAULT_COMMAND = typeof defaultBuildCommand === 'string' ? defaultBuildCommand : '';
export const PROBLEM_MATCHERS = ['$jrxml-file-line', '$jrxml-javac', '$jrxml-compile'];

/** The configured build command, trimmed; empty means "not configured". */
export function configuredCommand(): string {
    const value = vscode.workspace.getConfiguration('jrxml').get('build.command', DEFAULT_COMMAND);
    return typeof value === 'string' ? value.trim() : '';
}

/** Run the build command as a task with the JRXML problem matchers attached. */
export async function runBuild(): Promise<vscode.TaskExecution | undefined> {
    const command = configuredCommand();
    if (!command) {
        vscode.window.showWarningMessage('Set jrxml.build.command before running the JRXML build.');
        return undefined;
    }

    const scope = (vscode.workspace.workspaceFolders || []).length > 0
        ? vscode.TaskScope.Workspace
        : vscode.TaskScope.Global;

    const task = new vscode.Task(
        { type: 'jrxml', command },
        scope,
        'JRXML build',
        'jrxml',
        new vscode.ShellExecution(command),
        PROBLEM_MATCHERS
    );
    task.group = vscode.TaskGroup.Build;
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel:  vscode.TaskPanelKind.Shared,
    };

    return vscode.tasks.executeTask(task);
}

export function register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.runBuild', runBuild)
    );
}
