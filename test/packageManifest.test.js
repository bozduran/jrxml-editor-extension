// test/packageManifest.test.js
// The extension's Activity Bar container, its icon asset, and view placement.
//
// Moving a view between containers is entirely manifest-driven: a typo in the
// container id silently hides the view, and a hard-coded icon colour would
// break light/high-contrast themes. These tests pin both.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

const pkg = require('../package.json');

const ROOT         = path.join(__dirname, '..');
const CONTAINER_ID = 'jrxmlViews';
const VIEW_IDS     = ['jrxmlIssues', 'jrxmlBestPractices', 'jrxmlIncludeChain'];

function activityBarContainers() {
    return pkg.contributes.viewsContainers
        && Array.isArray(pkg.contributes.viewsContainers.activitybar)
        ? pkg.contributes.viewsContainers.activitybar
        : [];
}

test('declares the JRXML Activity Bar container', () => {
    const containers = activityBarContainers();
    const container = containers.find(candidate => candidate.id === CONTAINER_ID);

    assert.ok(container, `missing the ${CONTAINER_ID} Activity Bar container`);
    assert.strictEqual(container.title, 'JRXML');
    assert.strictEqual(container.icon, 'media/jrxml.svg');
    assert.ok(!path.isAbsolute(container.icon), 'the icon path must be extension-relative');
    assert.ok(fs.existsSync(path.join(ROOT, container.icon)), 'the icon file is missing');
    assert.match(container.icon, /\.svg$/i);

    const ids = containers.map(candidate => candidate.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'Activity Bar container ids must be unique');
});

test('ships a monochrome, theme-aware 24x24 icon', () => {
    const file = path.join(ROOT, 'media', 'jrxml.svg');
    const svg = fs.readFileSync(file, 'utf8');

    assert.match(svg, /^<svg\b/);
    assert.ok(svg.includes('viewBox="0 0 24 24"'), 'Activity Bar icons should be 24x24');
    assert.ok(svg.includes('currentColor'), 'the icon must follow the Activity Bar colour');
    assert.ok(!/(?:fill|stroke)="#[0-9a-f]{3,8}"/i.test(svg), 'no hard-coded icon colours');
    assert.ok(!/<script|<image|href\s*=/i.test(svg), 'the icon must not load external content');
});

test('moves the JRXML views into the Activity Bar container', () => {
    const views = pkg.contributes.views || {};
    const ids = (views[CONTAINER_ID] || []).map(view => view.id);

    assert.deepStrictEqual(ids, VIEW_IDS, 'the three JRXML views must be in the new container');
    assert.ok(
        !(views.explorer || []).some(view => VIEW_IDS.includes(view.id)),
        'the views must be moved, not duplicated in Explorer'
    );

    for (const view of views[CONTAINER_ID]) {
        assert.ok(view.id, 'every view needs an id');
        assert.ok(view.name, `view ${view.id} needs a name`);
    }
});

test('view ids are unique across every container', () => {
    const all = Object.values(pkg.contributes.views || {}).flat();
    const ids = all.map(view => view.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'a view id may only appear in one container');
});

test('view/title menus only reference declared views', () => {
    const declared = new Set(
        Object.values(pkg.contributes.views || {}).flat().map(view => view.id)
    );

    for (const menu of pkg.contributes.menus['view/title'] || []) {
        const match = /^view == ([A-Za-z0-9_]+)/.exec(menu.when || '');
        if (match) {
            assert.ok(declared.has(match[1]), `${menu.command} targets an unknown view ${match[1]}`);
        }
    }
});
