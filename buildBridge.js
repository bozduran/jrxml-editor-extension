// buildBridge.js
// "JRXML: Run Build" — a thin bridge to the project's own JasperReports build.
//
// The extension never embeds the report engine. It runs the configured shell
// command as a VS Code task and attaches the contributed $jrxml-* problem
// matchers, so compiler/verifier output lands in the Problems panel. Keep the
// project's Maven/Ant compile + verifyDesign as the authoritative gate.

const vscode = require('vscode');

const DEFAULT_COMMAND = 'mvn -q -DskipTests jasperreports:compile';
const PROBLEM_MATCHERS = ['$jrxml-file-line', '$jrxml-javac', '$jrxml-compile'];

/** The configured build command, trimmed; empty means "not configured". */
function configuredCommand() {
    const value = vscode.workspace.getConfiguration('jrxml').get('build.command', DEFAULT_COMMAND);
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Run the build command as a task with the JRXML problem matchers attached.
 * @returns {Promise<vscode.TaskExecution|undefined>}
 */
async function runBuild() {
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

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.runBuild', runBuild)
    );
}

module.exports = { register, runBuild, configuredCommand, DEFAULT_COMMAND, PROBLEM_MATCHERS };
