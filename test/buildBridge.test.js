// test/buildBridge.test.js
// The build bridge only shells out to the project's command; these tests cover
// the configured-command seam and the task it creates.

const test   = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

let settings = {};
const executed = [];
let warning = null;
let registeredCommand = null;

class FakeTask {
    constructor(definition, scope, name, source, execution, problemMatchers) {
        this.definition = definition;
        this.scope = scope;
        this.name = name;
        this.source = source;
        this.execution = execution;
        this.problemMatchers = problemMatchers;
    }
}

class FakeShellExecution {
    constructor(command) { this.command = command; }
}

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') {
        return {
            Task: FakeTask,
            ShellExecution: FakeShellExecution,
            TaskScope: { Workspace: 'workspace', Global: 'global' },
            TaskGroup: { Build: 'build' },
            TaskRevealKind: { Always: 'always' },
            TaskPanelKind: { Shared: 'shared' },
            tasks: {
                executeTask: task => {
                    executed.push(task);
                    return { task };
                },
            },
            commands: {
                registerCommand: (id, handler) => {
                    registeredCommand = { id, handler };
                    return { dispose() {} };
                },
            },
            window: {
                showWarningMessage: message => { warning = message; },
            },
            workspace: {
                workspaceFolders: [{ uri: { fsPath: '/repo' } }],
                getConfiguration: () => ({
                    get: (key, fallback) => (key in settings ? settings[key] : fallback),
                }),
            },
        };
    }
    return originalLoad.call(this, request, ...rest);
};

const {
    register,
    runBuild,
    configuredCommand,
    DEFAULT_COMMAND,
    PROBLEM_MATCHERS,
} = require('../out/buildBridge');

function reset() {
    settings = {};
    executed.length = 0;
    warning = null;
    registeredCommand = null;
}

test('reads the configured command and falls back to the default', () => {
    reset();

    settings['build.command'] = '  ./mvnw verify  ';
    assert.strictEqual(configuredCommand(), './mvnw verify');

    settings = {};
    assert.strictEqual(configuredCommand(), DEFAULT_COMMAND);
});

test('an empty command warns instead of running a task', async () => {
    reset();
    settings['build.command'] = '   ';

    assert.strictEqual(await runBuild(), undefined);
    assert.strictEqual(executed.length, 0);
    assert.match(warning, /jrxml\.build\.command/);
});

test('runs the command as a build task with the JRXML matchers', async () => {
    reset();
    settings['build.command'] = './mvnw -q jasperreports:compile';

    const execution = await runBuild();

    assert.strictEqual(executed.length, 1);
    const task = executed[0];
    assert.strictEqual(execution.task, task);
    assert.strictEqual(task.execution.command, './mvnw -q jasperreports:compile');
    assert.deepStrictEqual(task.problemMatchers, PROBLEM_MATCHERS);
    assert.strictEqual(task.group, 'build');
    assert.strictEqual(task.scope, 'workspace');
});

test('register contributes the runBuild command', () => {
    reset();
    register({ subscriptions: [] });

    assert.strictEqual(registeredCommand.id, 'jrxml.runBuild');
});
