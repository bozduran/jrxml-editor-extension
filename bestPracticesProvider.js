// bestPracticesProvider.js
// Extensible best-practices engine for JRXML expressions.
//
// HOW TO ADD A NEW RULE:
//   Push a new object into the RULES array. Each rule has:
//     id        — unique string, used as diagnostic code  e.g. 'jrxml.bp003.myRule'
//     name      — short label shown in the tree view
//     message   — full description shown in the Problems panel
//     severity  — vscode.DiagnosticSeverity.Warning | .Information | .Error
//     suppressible — true = user can hide the yellow line but keep quick fix
//     check(expr, declarations) → [{ start, end, fix: { label, replacement } }]
//         start/end = character offsets inside the raw expression string
//
// The engine handles scanning, diagnostics, tree view, suppress, and
// code-action registration automatically.

const vscode            = require('vscode');
const { parseDeclarations } = require('./jrxmlParser');
const { EXPRESSION_TAGS }   = require('./expressionUtils');

// ─────────────────────────────────────────────────────────────────────────────
// RULES
// ─────────────────────────────────────────────────────────────────────────────

const RULES = [

    // ── BP001: Boolean comparisons ────────────────────────────────────────────
    {
        id:          'jrxml.bp001.booleanEquals',
        name:        'Use EQUALS() for Boolean comparisons',
        message:     'Prefer EQUALS($ref, true/false) or NOT(EQUALS(...)) instead of == / != on Boolean values.',
        severity:    vscode.DiagnosticSeverity.Warning,
        suppressible: false,

        check(expr, declarations) {
            const hits     = [];
            const boolNames = buildTypeSet(declarations, isBoolean);

            // Catch BOTH Boolean.FALSE.equals($F{x}) AND $F{x}.equals(Boolean.FALSE)
            const boolEqualsRe = /(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\.equals\s*\(\s*(\$(F|P|V)\{([\w.]+)\})\s*\)|(\$(F|P|V)\{([\w.]+)\})\.equals\s*\(\s*(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\s*\)/g;
            let m;
            while ((m = boolEqualsRe.exec(expr)) !== null) {
                const full      = m[0];
                const boolConst = m[1] || m[8];
                const ref       = m[2] || m[5];
                const sigil     = m[3] || m[6];
                const name      = m[4] || m[7];

                if (!boolNames[sigil].has(name)) continue;
                const boolVal     = boolConst === 'TRUE' ? 'true' : 'false';
                const replacement = `EQUALS(${ref}, ${boolVal})`;
                hits.push({
                    start: m.index,
                    end:   m.index + full.length,
                    fix: { label: `Replace with ${replacement}`, replacement }
                });
            }

            // $F{x} == true|false  /  $F{x} != true|false
            const cmpRe = /(\$(F|P|V)\{([\w.]+)\})\s*(==|!=)\s*(true|false)/g;
            while ((m = cmpRe.exec(expr)) !== null) {
                const [full, ref, sigil, name, op, boolVal] = m;
                if (!boolNames[sigil].has(name)) continue;
                const inner       = `EQUALS(${ref}, ${boolVal})`;
                const replacement = op === '!=' ? `NOT(${inner})` : inner;
                hits.push({ start: m.index, end: m.index + full.length,
                    fix: { label: `Replace with ${replacement}`, replacement } });
            }

            // bare $F{x} used as condition (no == / != after it)
            const bareRe = /(\$(F|P|V)\{([\w.]+)\})(?!\s*[=!<>])/g;
            while ((m = bareRe.exec(expr)) !== null) {
                const [full, ref, sigil, name] = m;
                if (!boolNames[sigil].has(name)) continue;
                
                const beforeBare = expr.slice(0, m.index);
                const afterBare  = expr.slice(m.index + full.length).trimStart();
                
                if (/EQUALS\s*\(\s*$/.test(beforeBare)) continue;
                if (/(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\.equals\s*\(\s*$/.test(beforeBare)) continue;
                if (/^\.equals\s*\(\s*(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\s*\)/.test(afterBare)) continue;
                if (/^(==|!=)\s*(true|false)/.test(afterBare)) continue;

                const replacement = `EQUALS(${ref}, true)`;
                hits.push({ start: m.index, end: m.index + full.length,
                    fix: { label: `Replace with ${replacement}`, replacement } });
            }

            return hits;
        }
    },

    // ── BP002: Null-safe string comparison ────────────────────────────────────
    // Flags $F{x}.equals("literal") where field is String/nullable
    // Suggests CONTAINS($F{x}, "literal") with null guard
    {
        id:          'jrxml.bp002.nullSafeString',
        name:        'Null-safe string comparison',
        message:     '$ref.equals("value") throws NullPointerException if the field is null. Use "value".equals($ref) or wrap with a null check.',
        severity:    vscode.DiagnosticSeverity.Warning,
        suppressible: true,

        check(expr, declarations) {
            const hits      = [];
            const strNames  = buildTypeSet(declarations, isString);

            // $F{name}.equals("literal")  or  $F{name}.equals('literal')
            const re = /(\$(F|P|V)\{([\w.]+)\})\.equals\(("[^"]*"|'[^']*')\)/g;
            let m;
            while ((m = re.exec(expr)) !== null) {
                const [full, ref, sigil, name, literal] = m;
                if (!strNames[sigil].has(name)) continue;

                // Flip: put the literal first — safest one-click fix
                const replacement = `${literal}.equals(${ref})`;
                hits.push({
                    start: m.index,
                    end:   m.index + full.length,
                    fix: {
                        label:       `Flip to ${replacement}`,
                        replacement,
                    }
                });
            }
            return hits;
        }
    },

    // ── BP003: Optional.ofNullable for nullable fields ────────────────────────
    // Flags bare $F{x} / $P{x} / $V{x} that are used without any null check
    // when the type is a known nullable (String, Integer, BigDecimal, Date …)
    // Suggests Optional.ofNullable($F{x}).orElse(<default>)
    {
        id:          'jrxml.bp003.optionalNullable',
        name:        'Wrap nullable reference with Optional.ofNullable()',
        message:     '$ref may be null. Consider Optional.ofNullable($ref).orElse(<default>) to avoid NullPointerException.',
        severity:    vscode.DiagnosticSeverity.Information,
        suppressible: true,

        check(expr, declarations) {
            const hits     = [];
            const nullable = buildTypeSet(declarations, isNullable);

            const bareRe = /(\$(F|P|V)\{([\w.]+)\})/g;
            let m;
            while ((m = bareRe.exec(expr)) !== null) {
                const [full, ref, sigil, name] = m;
                if (!nullable[sigil].has(name)) continue;

                const before = expr.slice(0, m.index);
                const after  = expr.slice(m.index + full.length).trimStart();

                // Skip if already guarded
                if (/Optional\.ofNullable\s*\([^)]*$/.test(before)) continue;
                if (/!=\s*null|null\s*!=/.test(before + ' ' + after))  continue;
                if (/EQUALS\s*\(\s*$/.test(before))                    continue;
                if (/^\.equals\s*\(/.test(after))                      continue;
                if (/\?\s*$/.test(before) || /^\s*:/.test(after))      continue;

                // ── PREVENT CLASH WITH BP001 ──
                if (/(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\.equals\s*\(\s*$/.test(before)) continue;
                if (/^\.equals\s*\(\s*(?:java\.lang\.)?Boolean\.(TRUE|FALSE)\s*\)/.test(after)) continue;

                const decl    = findDecl(declarations, sigil, name);
                const defVal  = defaultForType(decl?.fullType || decl?.type || '');
                const replacement = `Optional.ofNullable(${ref}).orElse(${defVal})`;

                hits.push({
                    start: m.index,
                    end:   m.index + full.length,
                    fix: {
                        label:       `Wrap with Optional.ofNullable(...).orElse(${defVal})`,
                        replacement,
                    }
                });
            }
            return hits;
        }
    },

    // ── Add more rules below ──────────────────────────────────────────────────
    // {
    //     id: 'jrxml.bp004.myRule', name: '...', message: '...',
    //     severity: vscode.DiagnosticSeverity.Information,
    //     suppressible: true,
    //     check(expr, declarations) { return []; }
    // },

];

// ─────────────────────────────────────────────────────────────────────────────
// Type helpers
// ─────────────────────────────────────────────────────────────────────────────

function isBoolean(t) {
    if (!t) return false;
    const l = t.toLowerCase();
    return l === 'boolean' || l === 'java.lang.boolean';
}

function isString(t) {
    if (!t) return false;
    const l = t.toLowerCase();
    return l === 'string' || l === 'java.lang.string';
}

function isNullable(t) {
    if (!t) return false;
    const l = t.toLowerCase();
    return ['string','java.lang.string',
            'integer','java.lang.integer',
            'long','java.lang.long',
            'double','java.lang.double',
            'float','java.lang.float',
            'bigdecimal','java.math.bigdecimal',
            'date','java.util.date',
            'localdate','java.time.localdate',
            'localdatetime','java.time.localdatetime',
            'boolean','java.lang.boolean'].includes(l);
}

/** Return the sensible orElse default for a Java type */
function defaultForType(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('string'))                          return '""';
    if (t.includes('integer') || t.includes('long') ||
        t.includes('double')  || t.includes('float'))  return '0';
    if (t.includes('bigdecimal'))                      return 'java.math.BigDecimal.ZERO';
    if (t.includes('boolean'))                         return 'false';
    if (t.includes('date'))                            return 'new java.util.Date()';
    return 'null';
}

/**
 * Build { F: Set<name>, P: Set<name>, V: Set<name> } for declarations
 * matching the predicate on fullType.
 */
function buildTypeSet(declarations, predicate) {
    const sets = { F: new Set(), P: new Set(), V: new Set() };
    for (const f of declarations.fields)      if (predicate(f.fullType || f.type)) sets.F.add(f.name);
    for (const p of declarations.parameters)  if (predicate(p.fullType || p.type)) sets.P.add(p.name);
    for (const v of declarations.variables)   if (predicate(v.fullType || v.type)) sets.V.add(v.name);
    return sets;
}

function findDecl(declarations, sigil, name) {
    const list = sigil === 'F' ? declarations.fields
               : sigil === 'P' ? declarations.parameters
               :                 declarations.variables;
    return list.find(d => d.name === name) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suppress mechanism
// Suppressed rule ids are stored in workspace config:
//   jrxml.suppressedBestPractices: ["jrxml.bp002.nullSafeString", ...]
// Suppressed rules still appear in the tree view and still offer quick fixes,
// but do NOT emit a yellow diagnostic squiggly in the editor.
// ─────────────────────────────────────────────────────────────────────────────

function getSuppressed() {
    const cfg = vscode.workspace.getConfiguration('jrxml');
    return new Set(cfg.get('suppressedBestPractices') || []);
}

async function suppressRule(ruleId) {
    const cfg       = vscode.workspace.getConfiguration('jrxml');
    const current   = cfg.get('suppressedBestPractices') || [];
    if (!current.includes(ruleId)) {
        await cfg.update('suppressedBestPractices', [...current, ruleId],
                         vscode.ConfigurationTarget.Workspace);
    }
}

async function unsuppressRule(ruleId) {
    const cfg     = vscode.workspace.getConfiguration('jrxml');
    const current = cfg.get('suppressedBestPractices') || [];
    await cfg.update('suppressedBestPractices', current.filter(id => id !== ruleId),
                     vscode.ConfigurationTarget.Workspace);
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic collection + rule runner
// ─────────────────────────────────────────────────────────────────────────────

const bpDiagnostics = vscode.languages.createDiagnosticCollection('jrxml-bp');

// Map<uriString, Hit[]>
// Hit = { rule, absStart, absEnd, fix, document }
const storedHits = new Map();

const EXPR_TAG_RE = () => new RegExp(
    `(<(?:${EXPRESSION_TAGS.join('|')})(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/(?:${EXPRESSION_TAGS.join('|')})>)`,
    'g'
);

function runRules(document) {
    if (!document.fileName.endsWith('.jrxml')) {
        bpDiagnostics.delete(document.uri);
        storedHits.delete(document.uri.toString());
        return [];
    }

    const text       = document.getText();
    const parsed     = parseDeclarations(document);
    const suppressed = getSuppressed();
    const diags      = [];
    const hits       = [];

    const tagRe = EXPR_TAG_RE();
    let em;
    while ((em = tagRe.exec(text)) !== null) {
        const openTag    = em[1];
        const inner      = em[2];
        const exprOffset = em.index + openTag.length;

        const rawExpr = inner
            .replace(/^\s*<!\[CDATA\[/, '')
            .replace(/\]\]>\s*$/, '')
            .trim();
        if (!rawExpr) continue;

        const cdataOffset = inner.indexOf(rawExpr);

        for (const rule of RULES) {
            let ruleHits;
            try { ruleHits = rule.check(rawExpr, parsed); }
            catch (_) { continue; }

            for (const hit of ruleHits) {
                const absStart = exprOffset + cdataOffset + hit.start;
                const absEnd   = exprOffset + cdataOffset + hit.end;

                hits.push({ rule, absStart, absEnd, fix: hit.fix, document });

                // Only add a visible diagnostic if NOT suppressed
                if (!suppressed.has(rule.id)) {
                    const diag = new vscode.Diagnostic(
                        new vscode.Range(document.positionAt(absStart), document.positionAt(absEnd)),
                        `[${rule.name}] ${rule.message}`,
                        rule.severity
                    );
                    diag.source = 'JRXML Best Practices';
                    diag.code   = rule.id;
                    diags.push(diag);
                }
            }
        }
    }

    bpDiagnostics.set(document.uri, diags);
    storedHits.set(document.uri.toString(), hits);
    return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree view
// ─────────────────────────────────────────────────────────────────────────────

class BpTreeItem extends vscode.TreeItem {
    constructor(label, collapsible, hit, iconId) {
        super(label, collapsible);
        this.hit = hit || null;
        if (iconId) this.iconPath = new vscode.ThemeIcon(iconId);
    }
}

class BestPracticesTreeProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
        this._grouped = {};
    }

    refresh(hits) {
        this._grouped = {};
        for (const hit of (hits || [])) {
            const key = hit.rule.id;
            if (!this._grouped[key]) this._grouped[key] = { rule: hit.rule, hits: [] };
            this._grouped[key].hits.push(hit);
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(el) { return el; }

    getChildren(element) {
        if (!element) {
            if (!this._grouped || Object.keys(this._grouped).length === 0) {
                return [new BpTreeItem('No issues found ✓', vscode.TreeItemCollapsibleState.None, null, 'pass')];
            }
            const suppressed = getSuppressed();
            return Object.values(this._grouped).map(g => {
                const isSuppressed = suppressed.has(g.rule.id);
                const item = new BpTreeItem(
                    `${isSuppressed ? '$(eye-closed) ' : ''}${g.rule.name}  (${g.hits.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    null,
                    isSuppressed ? 'eye-closed' : 'lightbulb'
                );
                item.groupKey  = g.rule.id;
                item._hits     = g.hits;
                item._rule     = g.rule;
                item.contextValue = g.rule.suppressible
                    ? (isSuppressed ? 'bp-rule-suppressed' : 'bp-rule-suppressible')
                    : 'bp-rule';
                item.tooltip = isSuppressed
                    ? `${g.rule.name} — suppressed (quick fixes still available)`
                    : g.rule.message;
                return item;
            });
        }

        if (element._hits) {
            return element._hits.map(hit => {
                const pos  = hit.document.positionAt(hit.absStart);
                const item = new BpTreeItem(
                    `Line ${pos.line + 1}: ${hit.fix.label}`,
                    vscode.TreeItemCollapsibleState.None,
                    hit,
                    'warning'
                );
                item.command = {
                    command: 'jrxml.bp.jumpToHit',
                    title:   'Jump to issue',
                    arguments: [hit]
                };
                item.tooltip      = hit.rule.message;
                item.contextValue = 'bp-hit';
                return item;
            });
        }
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Code actions — quick fix + suppress actions
// ─────────────────────────────────────────────────────────────────────────────

const bpCodeActions = vscode.languages.registerCodeActionsProvider(
    { language: 'jrxml', scheme: 'file' },
    {
        provideCodeActions(document, range, context) {
            const actions = [];
            const hits    = storedHits.get(document.uri.toString()) || [];

            for (const diag of context.diagnostics) {
                if (diag.source !== 'JRXML Best Practices') continue;

                const hit = hits.find(h =>
                    h.rule.id === diag.code &&
                    document.positionAt(h.absStart).isEqual(diag.range.start)
                );
                if (!hit) continue;

                // Quick fix
                if (hit.fix) {
                    const fix = new vscode.CodeAction(hit.fix.label, vscode.CodeActionKind.QuickFix);
                    fix.diagnostics = [diag];
                    fix.isPreferred = true;
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, diag.range, hit.fix.replacement);
                    fix.edit = edit;
                    actions.push(fix);
                }

                // Suppress action (only for suppressible rules)
                if (hit.rule.suppressible) {
                    const suppress = new vscode.CodeAction(
                        `Suppress "${hit.rule.name}" warnings (keep quick fixes)`,
                        vscode.CodeActionKind.QuickFix
                    );
                    suppress.diagnostics  = [diag];
                    suppress.isPreferred  = false;
                    suppress.command = {
                        command:   'jrxml.bp.suppressRule',
                        title:     'Suppress rule',
                        arguments: [hit.rule.id]
                    };
                    actions.push(suppress);
                }
            }

            // Also offer quick fix for hits that are suppressed (no diagnostic)
            // by scanning all stored hits in range
            const rangeOffset = document.offsetAt(range.start);
            for (const hit of hits) {
                if (getSuppressed().has(hit.rule.id) && hit.fix) {
                    if (hit.absStart <= rangeOffset && rangeOffset <= hit.absEnd) {
                        const fix = new vscode.CodeAction(
                            `[suppressed] ${hit.fix.label}`,
                            vscode.CodeActionKind.QuickFix
                        );
                        const edit = new vscode.WorkspaceEdit();
                        const r = new vscode.Range(
                            document.positionAt(hit.absStart),
                            document.positionAt(hit.absEnd)
                        );
                        edit.replace(document.uri, r, hit.fix.replacement);
                        fix.edit = edit;
                        actions.push(fix);
                    }
                }
            }

            return actions;
        }
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
);

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

function register(context) {
    context.subscriptions.push(bpDiagnostics, bpCodeActions);

    const treeProvider = new BestPracticesTreeProvider();
    const treeView = vscode.window.createTreeView('jrxmlBestPractices', {
        treeDataProvider: treeProvider,
        showCollapseAll:  true,
    });
    context.subscriptions.push(treeView);

    function runAndRefresh(doc) {
        if (!doc || !doc.fileName.endsWith('.jrxml')) { treeProvider.refresh([]); return; }
        treeProvider.refresh(runRules(doc));
    }

    let timer;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (!e.document.fileName.endsWith('.jrxml')) return;
            clearTimeout(timer);
            timer = setTimeout(() => runAndRefresh(e.document), 600);
        }),
        vscode.window.onDidChangeActiveTextEditor(ed => runAndRefresh(ed?.document)),
        vscode.workspace.onDidSaveTextDocument(doc => runAndRefresh(doc)),
        // Re-run when suppress config changes so squiggles update instantly
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('jrxml.suppressedBestPractices'))
                runAndRefresh(vscode.window.activeTextEditor?.document);
        })
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.bp.jumpToHit', hit => {
            vscode.window.showTextDocument(hit.document.uri).then(editor => {
                const pos = hit.document.positionAt(hit.absStart);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(
                    new vscode.Range(pos, hit.document.positionAt(hit.absEnd)),
                    vscode.TextEditorRevealType.InCenter
                );
            });
        }),

        vscode.commands.registerCommand('jrxml.bp.suppressRule', async ruleId => {
            await suppressRule(ruleId);
            runAndRefresh(vscode.window.activeTextEditor?.document);
            vscode.window.showInformationMessage(
                `Rule suppressed. Quick fixes still available. To re-enable, remove from jrxml.suppressedBestPractices in settings.`
            );
        }),

        vscode.commands.registerCommand('jrxml.bp.unsuppressRule', async ruleId => {
            await unsuppressRule(ruleId);
            runAndRefresh(vscode.window.activeTextEditor?.document);
        }),

        vscode.commands.registerCommand('jrxml.refreshBestPractices', () => {
            runAndRefresh(vscode.window.activeTextEditor?.document);
        })
    );

    // Tree view inline buttons for suppress/unsuppress
    context.subscriptions.push(
        vscode.commands.registerCommand('jrxml.bp.suppressFromTree', item => {
            vscode.commands.executeCommand('jrxml.bp.suppressRule', item.groupKey);
        }),
        vscode.commands.registerCommand('jrxml.bp.unsuppressFromTree', item => {
            vscode.commands.executeCommand('jrxml.bp.unsuppressRule', item.groupKey);
        })
    );

    runAndRefresh(vscode.window.activeTextEditor?.document);
}

module.exports = { register };
