// workspaceValidation.js
// "JRXML: Validate Workspace" — runs the same analysis as the editor over every
// .jrxml file in the workspace and surfaces the results in the Problems panel.
//
// The CI equivalent is `node tools/validate-workspace.js`, which shares the
// same pure pipeline and exits non-zero on errors.

const vscode = require('vscode');
const { updateDiagnostics } = require('./diagnosticsProvider');
const { EXCLUDE_GLOB } = require('./workspaceFiles');

/**
 * Validate every JRXML file in the workspace.
 * @returns {Promise<{files:number, errors:number, warnings:number}>}
 */
async function validateWorkspace() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('Open a folder to validate its JRXML files.');
        return { files: 0, errors: 0, warnings: 0 };
    }

    const uris = await vscode.workspace.findFiles('**/*.jrxml', EXCLUDE_GLOB);
    if (uris.length === 0) {
        vscode.window.showInformationMessage('No .jrxml files found in the workspace.');
        return { files: 0, errors: 0, warnings: 0 };
    }

    let errors = 0;
    let warnings = 0;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Validating JRXML workspace' },
        async progress => {
            for (let index = 0; index < uris.length; index++) {
                progress.report({
                    message: `${index + 1}/${uris.length}`,
                    increment: 100 / uris.length,
                });

                let document;
                try {
                    document = await vscode.workspace.openTextDocument(uris[index]);
                } catch (_) {
                    continue; // deleted or unreadable since findFiles ran
                }

                for (const finding of updateDiagnostics(document)) {
                    if (finding.severity === 'error') errors++;
                    else warnings++;
                }
            }
        }
    );

    const message = `Validated ${uris.length} JRXML file(s): ${errors} error(s), ${warnings} warning(s).`;
    if (errors > 0) vscode.window.showWarningMessage(message);
    else vscode.window.showInformationMessage(message);

    return { files: uris.length, errors, warnings };
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.validateWorkspace', validateWorkspace)
    );
}

module.exports = { register, validateWorkspace };
