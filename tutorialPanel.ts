// tutorialPanel.ts
// Host side of the built-in JRXML tutorial.
//
// The document is static HTML built by the vscode-free tutorialHtml module and
// needs no scripts. Command links are enabled only for the commands the
// tutorial actually uses, so a link can never reach an unrelated command.

import * as vscode from 'vscode';
import { buildTutorialHtml, TUTORIAL_COMMAND_URIS } from './tutorialHtml';
import { getNonce } from './expressionPanelHtml';

const VIEW_TYPE = 'jrxmlTutorial';
const TITLE = 'JRXML Tutorial';

class TutorialPanel {
    static currentPanel: TutorialPanel | undefined = undefined;
    static viewType     = VIEW_TYPE;

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[];

    constructor(panel: vscode.WebviewPanel) {
        this._panel       = panel;
        this._disposables = [];

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._render();
    }

    static createOrShow(): void {
        const current = TutorialPanel.currentPanel;
        if (current) {
            current._panel.reveal(vscode.ViewColumn.Active);
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

    _render(): void {
        this._panel.webview.html = buildTutorialHtml({ nonce: getNonce() });
    }

    dispose(): void {
        TutorialPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables = [];
    }
}

function register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.openTutorial', () => TutorialPanel.createOrShow())
    );
}

export { register, TutorialPanel };
