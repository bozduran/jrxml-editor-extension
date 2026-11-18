// test/buildBridge.test.ts
// The build bridge only shells out to the project's command; these tests cover
// the configured-command seam and the task it creates.
//
// The test is an ES module while the compiled host module is CommonJS, so the
// stub goes through Node's CJS loader: createRequire keeps that path, which a
// static `import` would bypass.

import test from 'node:test';
import assert from 'node:assert';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The fake task's shell execution. */
class FakeShellExecution {
    command: string;

    constructor(command: string) { this.command = command; }
}

/** The fake task the build bridge constructs. */
class FakeTask {
    definition: unknown;
    scope: unknown;
    name: unknown;
    source: unknown;
    execution: FakeShellExecution;
    problemMatchers: unknown;
    group?: unknown;
    presentationOptions?: unknown;

    constructor(
        definition: unknown,
        scope: unknown,
        name: unknown,
        source: unknown,
        execution: FakeShellExecution,
        problemMatchers: unknown
    ) {
        this.definition = definition;
        this.scope = scope;
        this.name = name;
        this.source = source;
        this.execution = execution;
        this.problemMatchers = problemMatchers;
    }
}

interface FakeTaskExecution {
    task: FakeTask;
}

/** The subset of the vscode API buildBridge imports. */
interface VscodeStub {
    Task: typeof FakeTask;
    ShellExecution: typeof FakeShellExecution;
    TaskScope: { Workspace: string; Global: string };
    TaskGroup: { Build: string };
    TaskRevealKind: { Always: string };
    TaskPanelKind: { Shared: string };
    tasks: { executeTask(task: FakeTask): FakeTaskExecution };
    commands: { registerCommand(id: string, handler: () => unknown): { dispose(): void } };
    window: { showWarningMessage(message: string): void };
    workspace: {
        workspaceFolders: Array<{ uri: { fsPath: string } }>;
        getConfiguration(section: string): { get(key: string, fallback: string): string };
    };
}

let settings: Record<string, string> = {};
const executed: FakeTask[] = [];
let warning: string | null = null;
let registeredCommand: { id: string; handler: () => unknown } | null = null;

/** Node's internal CJS loader hook: the only way to stub `vscode`. */
interface LoaderHost {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const loader = Module as unknown as LoaderHost;
const originalLoad = loader._load;
loader._load = (request: string, parent: unknown, isMain: boolean): unknown => {
    if (request === 'vscode') {
        const stub: VscodeStub = {
            Task: FakeTask,
            ShellExecution: FakeShellExecution,
            TaskScope: { Workspace: 'workspace', Global: 'global' },
            TaskGroup: { Build: 'build' },
            TaskRevealKind: { Always: 'always' },
            TaskPanelKind: { Shared: 'shared' },
            tasks: {
                executeTask: (task: FakeTask) => {
                    executed.push(task);
                    return { task };
                },
            },
            commands: {
                registerCommand: (id: string, handler: () => unknown) => {
                    registeredCommand = { id, handler };
                    return { dispose() {} };
                },
            },
            window: {
                showWarningMessage: (message: string) => { warning = message; },
            },
            workspace: {
                workspaceFolders: [{ uri: { fsPath: '/repo' } }],
                getConfiguration: (_section: string) => ({
                    get: (key: string, fallback: string): string => (key in settings ? settings[key] : fallback),
                }),
            },
        };
        return stub;
    }
    return originalLoad.call(loader, request, parent, isMain);
};

interface BuildBridgeModule {
    register(context: { subscriptions: Array<{ dispose(): void }> }): void;
    runBuild(): Promise<FakeTaskExecution | undefined>;
    configuredCommand(): string;
    DEFAULT_COMMAND: string;
    PROBLEM_MATCHERS: string[];
}

const buildBridge = require('../out/buildBridge.js') as BuildBridgeModule;
const {
    register,
    runBuild,
    configuredCommand,
    DEFAULT_COMMAND,
    PROBLEM_MATCHERS,
} = buildBridge;

function reset(): void {
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
    assert.ok(warning, 'an empty command must warn');
    assert.match(warning, /jrxml\.build\.command/);
});

test('runs the command as a build task with the JRXML matchers', async () => {
    reset();
    settings['build.command'] = './mvnw -q jasperreports:compile';

    const execution = await runBuild();
    assert.ok(execution, 'a configured command must run a task');

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

    assert.ok(registeredCommand, 'register must register a command');
    assert.strictEqual(registeredCommand.id, 'jrxml.runBuild');
});
