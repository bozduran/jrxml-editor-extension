// settingsPanel.js
// A dedicated webview panel for every jrxml.* setting, grouped by area.
//
// Toggles are bound live to workspace settings, so the panel, the native
// Settings UI and the running features always agree. The document itself is
// built by the vscode-free settingsPanelHtml module.

const vscode = require('vscode');
const { SECTION, SETTINGS_GROUPS, allSettings } = require('./settingsSchema');
const { buildSettingsHtml, getNonce } = require('./settingsPanelHtml');

class SettingsPanel {
    static currentPanel = undefined;
    static viewType     = 'jrxmlSettingsPanel';

    constructor(panel) {
        this._panel       = panel;
        this._disposables = [];

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(message => this._handleMessage(message), null, this._disposables);

        // Keep the panel in step with changes made in the native Settings UI.
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(SECTION)) this._postState();
        }, null, this._disposables);
    }

    static createOrShow() {
        if (SettingsPanel.currentPanel) {
            SettingsPanel.currentPanel._panel.reveal(vscode.ViewColumn.Active);
            SettingsPanel.currentPanel._postState();
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

    _configuration() {
        return vscode.workspace.getConfiguration(SECTION);
    }

    _values() {
        const config = this._configuration();
        const values = {};
        for (const setting of allSettings()) {
            values[setting.key] = config.get(setting.key, setting.default);
        }
        return values;
    }

    _update() {
        this._panel.title = 'JRXML Settings';
        this._panel.webview.html = buildSettingsHtml({
            groups:  SETTINGS_GROUPS,
            values:  this._values(),
            nonce:   getNonce(),
            section: SECTION,
        });
    }

    _postState() {
        this._panel.webview.postMessage({ command: 'state', values: this._values() });
    }

    async _handleMessage(message) {
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

                default:
                    break;
            }
        } catch (err) {
            vscode.window.showErrorMessage(`JRXML settings: ${err.message || err}`);
        }
    }

    dispose() {
        SettingsPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables = [];
    }
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.openSettingsPanel', () => SettingsPanel.createOrShow())
    );
}

module.exports = { register, SettingsPanel };
