// integration/extension.test.js
// Extension Host smoke tests: activation, command registration, diagnostics and
// the destructive commands with their preview turned off.
//
// Run with `npm run test:integration` (downloads VS Code on first use).
// Unit tests stay in test/ and run with `npm test` — these are separate because
// they need the real `vscode` API.

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vscode = require('vscode');

const EXTENSION_ID = 'BozNtouranLabs.jrxml-editor-extension';
const FIXTURES     = path.join(__dirname, '..', 'test', 'fixtures');

let extension;
let tempDir;

/** Write content to a throwaway file and return its URI. */
function tempFile(name, content) {
    if (!tempDir) tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrxml-it-'));
    const file = path.join(tempDir, name);
    fs.writeFileSync(file, content);
    return vscode.Uri.file(file);
}

/** Temp copy of a repository fixture (never mutate the fixtures themselves). */
function fixtureCopy(name) {
    return tempFile(name, fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

async function openDocument(uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    return document;
}

async function setConfig(key, value) {
    await vscode.workspace.getConfiguration('jrxml')
        .update(key, value, vscode.ConfigurationTarget.Global);
}

async function waitFor(predicate, timeout = 20000) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const value = predicate();
        if (value) return value;
        if (Date.now() > deadline) return null;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}

suite('JRXML extension smoke', () => {
    suiteSetup(async () => {
        extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} not found`);

        // A top-level throw in any provider module surfaces here.
        await extension.activate();
        assert.strictEqual(extension.isActive, true);

        // The destructive commands are exercised without their modal preview.
        await setConfig('sort.preview', false);
        await setConfig('clear.preview', false);
    });

    suiteTeardown(async () => {
        await setConfig('sort.preview', true);
        await setConfig('clear.preview', true);
    });

    test('registers every contributed command', async () => {
        const pkg = require('../package.json');
        const registered = await vscode.commands.getCommands(true);

        for (const contribution of pkg.contributes.commands) {
            assert.ok(
                registered.includes(contribution.command),
                `${contribution.command} was not registered`
            );
        }
    });

    test('publishes diagnostics for a fixture', async () => {
        const uri = fixtureCopy('NullCheckReport.jrxml');
        await openDocument(uri);

        const found = await waitFor(() =>
            vscode.languages.getDiagnostics(uri)
                .find(diagnostic => diagnostic.code === 'jrxml.lint.uncheckedNullDereference'));

        assert.ok(found, 'expected an unchecked-null-dereference diagnostic');
        assert.match(found.message, /may be null when \.toString\(\.\.\.\) is called/);
    });

    test('applies the geometry sort and is idempotent', async () => {
        const document = await openDocument(fixtureCopy('SortEdgeReport.jrxml'));

        await vscode.commands.executeCommand('jrxml.sortElements');
        const sorted = document.getText();

        const image = sorted.indexOf('uuid="dddddddd-0000-0000-0000-000000000003"');
        const textField = sorted.indexOf('uuid="dddddddd-0000-0000-0000-000000000002"');
        assert.ok(image !== -1 && textField !== -1 && image < textField, 'elements were not reordered');

        await vscode.commands.executeCommand('jrxml.sortElements');
        assert.strictEqual(document.getText(), sorted, 'a second sort changed the document');
    });

    test('applies clear fixes', async () => {
        const document = await openDocument(fixtureCopy('ClearEdgeReport.jrxml'));

        await vscode.commands.executeCommand('jrxml.applyClearFixes');
        const cleared = document.getText();

        assert.ok(!cleared.includes('UnusedParam'), 'unused parameter was not deleted');
        assert.ok(!cleared.includes('UnusedField'), 'unused field was not deleted');
        assert.ok(
            cleared.includes('net.sf.jasperreports.jsonql.field.expression'),
            'jsonql property was not added'
        );
    });

    test('formats a document through the formatting provider', async () => {
        const uri = tempFile('Expected.jrxml', [
            '<jasperReport name="Wrong" uuid="11111111-1111-1111-1111-111111111111">',
            '\t<detail>',
            '\t\t<band height="20">',
            '\t\t\t<element kind="textField" x="0" y="0" width="10" height="10">',
            '\t\t\t\t<expression><![CDATA[$F{a}==null?"-":$F{a}]]></expression>',
            '\t\t\t</element>',
            '\t\t</band>',
            '\t</detail>',
            '</jasperReport>',
        ].join('\n'));

        const document = await openDocument(uri);
        await vscode.commands.executeCommand('editor.action.formatDocument');

        const formatted = await waitFor(() => {
            const text = document.getText();
            return text.includes('name="Expected"') ? text : null;
        });

        assert.ok(formatted, 'report name was not aligned to the file base name');
        assert.ok(formatted.includes('positionType="Float"'), 'positionType was not added');
        assert.ok(formatted.includes('$F{a} == null ? "-" : $F{a}'), 'expression was not formatted');
    });

    test('opens the settings panel', async () => {
        await vscode.commands.executeCommand('jrxml.openSettingsPanel');

        const tab = await waitFor(() => vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .find(candidate => candidate.label === 'JRXML Settings'));

        assert.ok(tab, 'JRXML Settings tab was not opened');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('resolves the include chain of the open report', async () => {
        const uri = vscode.Uri.file(path.join(__dirname, 'workspace', 'DetailReport.jrxml'));
        await openDocument(uri);

        const { computeTree } = require('../includeChainView');
        const tree = await computeTree(uri);

        assert.ok(tree.length >= 1, 'expected at least one top template');
        assert.match(tree[0].path, /MasterReport\.jrxml$/);

        const current = findNode(tree, node => node.current);
        assert.ok(current, 'the open report should be marked current');
        assert.match(current.path, /DetailReport\.jrxml$/);
    });

    test('marks a report nothing calls as not referenced', async () => {
        const uri = vscode.Uri.file(path.join(__dirname, 'workspace', 'OrphanReport.jrxml'));
        await openDocument(uri);

        const { computeTree } = require('../includeChainView');
        const tree = await computeTree(uri);

        assert.strictEqual(tree.length, 1);
        assert.strictEqual(tree[0].current, true);
        assert.deepStrictEqual(tree[0].children, []);
    });
});

function findNode(nodes, predicate) {
    for (const node of nodes) {
        if (predicate(node)) return node;
        const found = findNode(node.children || [], predicate);
        if (found) return found;
    }
    return null;
}
