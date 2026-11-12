// settingsPanel.ts
// A dedicated webview panel for every jrxml.* setting, grouped by area.
//
// Toggles are bound live to workspace settings, so the panel, the native
// Settings UI and the running features always agree. The document itself is
// built by the vscode-free settingsPanelHtml module.

import * as vscode from 'vscode';
import { SECTION, SETTINGS_GROUPS, allSettings } from './settingsSchema';
import { buildSettingsHtml, getNonce } from './settingsPanelHtml';

/** One message posted by the settings webview. */
interface SettingsMessage {
    command?: string;
    key: string;
    value?: unknown;
}

function errorText(err: unknown): string {
    return err instanceof Error && err.message ? err.message : String(err);
}

class SettingsPanel {
    static currentPanel: SettingsPanel | undefined = undefined;
    static viewType     = 'jrxmlSettingsPanel';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[];

    constructor(panel: vscode.WebviewPanel) {
        this._panel       = panel;
        this._disposables = [];

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message: unknown) => this._handleMessage(message),
            null,
            this._disposables
        );

        // Keep the panel in step with changes made in the native Settings UI.
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(SECTION)) this._postState();
        }, null, this._disposables);
    }

    static createOrShow(): void {
        const current = SettingsPanel.currentPanel;
        if (current) {
            current._panel.reveal(vscode.ViewColumn.Active);
            current._postState();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            SettingsPanel.viewType,
            'JRXML Settings',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [],
            }
        );

        SettingsPanel.currentPanel = new SettingsPanel(panel);
    }

    _configuration(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration(SECTION);
    }

    _values(): Record<string, unknown> {
        const config = this._configuration();
        const values: Record<string, unknown> = {};
        for (const setting of allSettings()) {
            values[setting.key] = config.get(setting.key, setting.default);
        }
        return values;
    }

    _update(): void {
        this._panel.title = 'JRXML Settings';
        this._panel.webview.html = buildSettingsHtml({
            groups:  SETTINGS_GROUPS,
            values:  this._values(),
            nonce:   getNonce(),
            section: SECTION,
        });
    }

    _postState(): void {
        this._panel.webview.postMessage({ command: 'state', values: this._values() });
    }

    async _handleMessage(raw: unknown): Promise<void> {
        const message = raw as SettingsMessage;
        try {
            switch (message.command) {
                case 'update':
                    await this._configuration().update(
                        message.key, message.value, vscode.ConfigurationTarget.Workspace
                    );
                    this._postState();
                    break;

                case 'reset':
                    for (const setting of allSettings()) {
                        await this._configuration().update(
                            setting.key, setting.default, vscode.ConfigurationTarget.Workspace
                        );
                    }
                    this._postState();
                    break;

                case 'openNative':
                    await vscode.commands.executeCommand('workbench.action.openSettings', SECTION);
                    break;

                case 'openTutorial':
                    await vscode.commands.executeCommand('jrxml.openTutorial');
                    break;

                default:
                    break;
            }
        } catch (err) {
            vscode.window.showErrorMessage(`JRXML settings: ${errorText(err)}`);
        }
    }

    dispose(): void {
        SettingsPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables = [];
    }
}

function register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.openSettingsPanel', () => SettingsPanel.createOrShow())
    );
}

export { register, SettingsPanel };
