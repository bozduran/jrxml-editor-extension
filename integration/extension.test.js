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

    test('completes typed members after a $F reference', async () => {
        const uri = tempFile('Typed.jrxml', [
            '<jasperReport name="Typed" uuid="22222222-2222-2222-2222-222222222222">',
            '\t<field name="CustomerName" class="java.lang.String"/>',
            '\t<detail>',
            '\t\t<band height="20">',
            '\t\t\t<textField>',
            '\t\t\t\t<reportElement x="0" y="0" width="100" height="20"/>',
            '\t\t\t\t<textFieldExpression><![CDATA[$F{CustomerName}.]]></textFieldExpression>',
            '\t\t\t</textField>',
            '\t\t</band>',
            '\t</detail>',
            '</jasperReport>',
        ].join('\n'));

        const document = await openDocument(uri);
        const line = document.getText().split('\n')
            .findIndex(text => text.includes('$F{CustomerName}.'));
        const character = document.lineAt(line).text.indexOf('$F{CustomerName}.') + '$F{CustomerName}.'.length;

        const items = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider',
            uri,
            new vscode.Position(line, character)
        );

        const upper = items.items.find(item => (item.filterText || item.label) === 'toUpperCase');
        assert.ok(upper, `expected toUpperCase, got ${items.items.slice(0, 5).map(i => i.label).join(', ')}`);
        assert.ok(
            items.items.some(item => (item.filterText || item.label) === 'substring'),
            'expected the String overloads'
        );
    });

    test('explains a receiver whose class is not declared', async () => {
        const uri = tempFile('Untyped.jrxml', [
            '<jasperReport name="Untyped" uuid="33333333-3333-3333-3333-333333333333">',
            '\t<field name="Unset"/>',
            '\t<detail>',
            '\t\t<band height="20">',
            '\t\t\t<textField>',
            '\t\t\t\t<reportElement x="0" y="0" width="100" height="20"/>',
            '\t\t\t\t<textFieldExpression><![CDATA[$F{Unset}.]]></textFieldExpression>',
            '\t\t\t</textField>',
            '\t\t</band>',
            '\t</detail>',
            '</jasperReport>',
        ].join('\n'));

        const document = await openDocument(uri);
        const line = document.getText().split('\n')
            .findIndex(text => text.includes('$F{Unset}.'));
        const character = document.lineAt(line).text.indexOf('$F{Unset}.') + '$F{Unset}.'.length;

        const items = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider',
            uri,
            new vscode.Position(line, character)
        );

        assert.ok(
            items.items.some(item => String(item.label).includes('is not declared')),
            `expected the class hint, got ${items.items.slice(0, 5).map(i => i.label).join(', ')}`
        );
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

    test('opens the If / Else builder and reads the report schema', async () => {
        const uri = tempFile('IfElseBuilder.jrxml', [
            '<jasperReport name="IfElseBuilder" uuid="44444444-4444-4444-4444-444444444444">',
            '\t<field name="status" class="java.lang.String"/>',
            '\t<parameter name="limit" class="java.lang.Integer"/>',
            '\t<variable name="total" class="java.math.BigDecimal"/>',
            '\t<detail>',
            '\t\t<band height="20">',
            '\t\t\t<textField>',
            '\t\t\t\t<reportElement x="0" y="0" width="100" height="20"/>',
            '\t\t\t\t<textFieldExpression><![CDATA[$F{status}]]></textFieldExpression>',
            '\t\t\t</textField>',
            '\t\t</band>',
            '\t</detail>',
            '</jasperReport>',
        ].join('\n'));

        const document = await openDocument(uri);

        // The builder reads names straight from the open report (no upload).
        const { readSchema } = require('../ifElsePanel');
        const { schema } = readSchema(document);
        assert.ok(schema, 'expected a schema');
        assert.ok(schema.F.some(item => item.name === 'status' && item.cls === 'String'));
        assert.ok(schema.P.some(item => item.name === 'limit' && item.cls === 'Integer'));
        assert.ok(schema.P.some(item => item.name === 'REPORT_CONNECTION'), 'built-in parameters missing');
        assert.ok(schema.V.some(item => item.name === 'total' && item.cls === 'BigDecimal'));
        assert.ok(schema.V.some(item => item.name === 'PAGE_NUMBER'), 'built-in variables missing');

        const line = document.getText().split('\n').findIndex(text => text.includes('$F{status}'));
        const character = document.lineAt(line).text.indexOf('$F{status}') + 2;
        const position = new vscode.Position(line, character);
        vscode.window.activeTextEditor.selection = new vscode.Selection(position, position);

        await vscode.commands.executeCommand('jrxml.openIfElseBuilder');

        const tab = await waitFor(() => vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .find(candidate => candidate.label === 'If / Else Builder'));

        assert.ok(tab, 'If / Else Builder tab was not opened');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('applies a built expression to exactly the target tag', async () => {
        const uri = tempFile('ApplyIfElse.jrxml', [
            '<jasperReport name="ApplyIfElse" uuid="55555555-5555-5555-5555-555555555555">',
            '\t<field name="status" class="java.lang.String"/>',
            '\t<detail><band height="20">',
            '\t\t<textField><reportElement x="0" y="0" width="100" height="20"/>',
            '\t\t<textFieldExpression><![CDATA[$F{status}]]></textFieldExpression></textField>',
            '\t</band></detail>',
            '</jasperReport>',
        ].join('\n'));

        const document = await openDocument(uri);
        const editor = vscode.window.activeTextEditor;
        assert.ok(editor, 'expected an active editor');
        const text = document.getText();
        const offset = text.indexOf('$F{status}');
        const { findExpressionAtCursor } = require('../expressionUtils');
        const target = findExpressionAtCursor(
            document,
            document.positionAt(offset + '$F{status}'.length)
        );
        assert.ok(target, 'expected the expression tag under the cursor');

        const expression = 'IF($F{status}.equals("PAID"), "Paid", "Unknown")';
        const applied = await require('../expressionApply').applyExpressionToEditor(
            editor,
            target,
            expression
        );

        assert.strictEqual(applied.ok, true, applied.reason);
        const updated = document.getText();
        assert.ok(
            updated.includes(`<textFieldExpression><![CDATA[${expression}]]></textFieldExpression>`),
            'the expression was not written into the target tag'
        );

        await vscode.commands.executeCommand('undo');
        assert.ok(
            document.getText().includes('<![CDATA[$F{status}]]>'),
            'undo did not restore the original tag'
        );
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

    test('contributes the JRXML Activity Bar container', async () => {
        const pkg = require('../package.json');
        const containers = pkg.contributes.viewsContainers.activitybar || [];
        const container = containers.find(candidate => candidate.id === 'jrxmlViews');

        assert.ok(container, 'missing the JRXML Activity Bar container');
        assert.strictEqual(container.title, 'JRXML');
        assert.strictEqual(container.icon, 'media/jrxml.svg');
        assert.deepStrictEqual(
            pkg.contributes.views.jrxmlViews.map(view => view.id),
            ['jrxmlIssues', 'jrxmlBestPractices', 'jrxmlIncludeChain']
        );

        // The workbench command generated for a contributed view container.
        await vscode.commands.executeCommand('workbench.view.extension.jrxmlViews');
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
