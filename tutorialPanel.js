// tutorialPanel.js
// Host side of the built-in JRXML tutorial.
//
// The document is static HTML built by the vscode-free tutorialHtml module and
// needs no scripts. Command links are enabled only for the commands the
// tutorial actually uses, so a link can never reach an unrelated command.

const vscode = require('vscode');
const { buildTutorialHtml, TUTORIAL_COMMAND_URIS } = require('./tutorialHtml');
const { getNonce } = require('./expressionPanelHtml');

const VIEW_TYPE = 'jrxmlTutorial';
const TITLE = 'JRXML Tutorial';

class TutorialPanel {
    static currentPanel = undefined;
    static viewType     = VIEW_TYPE;

    constructor(panel) {
        this._panel       = panel;
        this._disposables = [];

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._render();
    }

    static createOrShow() {
        if (TutorialPanel.currentPanel) {
            TutorialPanel.currentPanel._panel.reveal(vscode.ViewColumn.Active);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            TITLE,
            vscode.ViewColumn.Active,
            {
                enableScripts: false,
                retainContextWhenHidden: true,
                localResourceRoots: [],
                enableCommandUris: TUTORIAL_COMMAND_URIS,
            }
        );

        TutorialPanel.currentPanel = new TutorialPanel(panel);
    }

    _render() {
        this._panel.webview.html = buildTutorialHtml({ nonce: getNonce() });
    }

    dispose() {
        TutorialPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables = [];
    }
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.openTutorial', () => TutorialPanel.createOrShow())
    );
}

module.exports = { register, TutorialPanel };
