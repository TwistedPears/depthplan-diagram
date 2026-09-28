import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchNative } from './native-driver.mjs';

export async function selectionMenu() {
  let driver = await launchNative();
  const profile = driver.profile;
  const file = path.join(profile, 'selection-menu.depthplan');
  const geometry = (x, y, z = 0) => ({
    x,
    y,
    z,
    width: 160,
    height: 100,
    rotation: 0,
  });
  const a = geometry(400, 300),
    b = geometry(720, 450, 1);
  const object = (id, g, fill) => ({
    id,
    parentId: null,
    type: 'rectangle',
    name: id,
    content: [],
    geometry: g,
    style: { fill, strokeWidth: 3 },
  });
  const source = {
    formatVersion: 2,
    id: 'context-board',
    metadata: {
      title: 'Context board',
      created: '2026-09-28',
      modified: '2026-09-28',
    },
    objects: { a: object('a', a, '#bbf7d0'), b: object('b', b, '#bfdbfe') },
    rootDepths: { a: 0, b: 0 },
    layouts: { a: { 0: { a } }, b: { 0: { b } } },
    connections: {
      edge: {
        id: 'edge',
        ownerId: null,
        kind: 'arrow',
        z: 2,
        start: { kind: 'object', objectId: 'a', side: 'right', offset: 0.5 },
        end: { kind: 'object', objectId: 'b', side: 'left', offset: 0.5 },
      },
    },
  };
  const position = (id) =>
    driver.sync(
      'return window.Konva.stages[0].findOne("#object-"+arguments[0]).getAbsolutePosition()',
      [id],
    );
  const menu = async (id = 'a') => {
    const p = await position(id);
    await driver.drag(p.x, p.y, 0, 0, 2);
    await driver.until(
      () =>
        driver.sync(
          'return !!document.querySelector(".selection-menu:popover-open")',
        ),
      'Selection menu did not open',
    );
  };
  const dismiss = () =>
    driver.sync(
      'document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true,cancelable:true}))',
    );
  const save = async () => {
    await driver.sync(
      `const save=document.querySelector('[aria-label="Save document"]'); if (save && !save.disabled) save.click();`,
    );
    await driver.until(() =>
      driver.sync('return !document.querySelector("[aria-label=Unsaved]")'),
    );
    return JSON.parse(await readFile(file, 'utf8'));
  };
  const capture = async (name) => {
    await driver.js(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
    );
    await writeFile(
      path.join(profile, `${name}.png`),
      Buffer.from(
        await driver.request(
          `/session/${driver.session}/screenshot`,
          undefined,
          'GET',
        ),
        'base64',
      ),
    );
  };
  try {
    await driver.click('Menu');
    await driver.click('Settings');
    await driver.sync(
      `const toggle=document.querySelector('[aria-label="Autosave"]'); if(toggle.getAttribute('aria-checked')==='true') toggle.click();`,
    );
    await driver.click('Menu');
    await writeFile(file, JSON.stringify(source));
    await driver.dialogs('open', file);
    await driver.click('Menu');
    await driver.click('Open Board…');
    await driver.until(() =>
      driver.sync('return !!window.Konva.stages[0].findOne("#object-a")'),
    );
    assert.equal(
      await driver.sync(
        'return !!document.querySelector("[aria-label=Unsaved]")',
      ),
      false,
    );
    await menu();
    assert.equal(
      await driver.sync(
        'return !!document.querySelector("[aria-label=Unsaved]")',
      ),
      false,
      'Opening the menu must not dirty the board',
    );
    const labels = await driver.sync(
      'return [...document.querySelectorAll(".selection-menu button")].map(b=>b.getAttribute("aria-label"))',
    );
    assert.deepEqual(labels, [
      'Cut',
      'Copy',
      'Paste',
      'Copy styles',
      'Paste styles',
      'Save Template',
      'Send backward',
      'Bring forward',
      'Send to back',
      'Bring to front',
      'Flip horizontal',
      'Flip vertical',
      'Add link',
      'Copy link to object',
      'Duplicate',
      'Delete',
    ]);
    await capture('selection-menu-single');
    await driver.click('Copy styles');
    await menu('b');
    await driver.click('Paste styles');
    let document = await save();
    assert.equal(document.objects.b.style.fill, '#bbf7d0');
    await driver.click('Undo');
    document = await save();
    assert.equal(document.objects.b.style.fill, '#bfdbfe');

    await menu('a');
    await driver.click('Copy link to object');
    const link = await driver.native('clipboard:read-text');
    assert.equal(link, 'depthplan://object?board=context-board&item=object-a');
    await menu('b');
    await driver.click('Add link');
    await driver.sync(
      `const e=document.querySelector('[aria-label="Item link URL"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,arguments[0]);e.dispatchEvent(new Event("input",{bubbles:true}))`,
      [link],
    );
    await driver.click('Open link');
    await driver.until(() =>
      driver.sync('return !document.querySelector("dialog[open]")'),
    );
    document = await save();
    assert.equal(document.objects.b.style.link, link);
    await driver.click('Reset view');

    await menu('a');
    await driver.click('Copy');
    await menu('a');
    await driver.click('Paste');
    await driver.until(() =>
      driver.sync(
        'return window.Konva.stages[0].find(".recursive-object").length===3',
      ),
    );
    await driver.click('Undo');
    await menu('a');
    await driver.click('Cut');
    await driver.until(() =>
      driver.sync('return !window.Konva.stages[0].findOne("#object-a")'),
    );
    await driver.click('Undo');
    await menu('a');
    await driver.click('Duplicate');
    await driver.until(() =>
      driver.sync(
        'return window.Konva.stages[0].find(".recursive-object").length===3',
      ),
    );
    await driver.click('Undo');

    for (const label of [
      'Send backward',
      'Bring forward',
      'Send to back',
      'Bring to front',
    ]) {
      await menu('a');
      await driver.click(label);
      document = await save();
      const z = document.layouts.a[0].a.z;
      assert(Number.isInteger(z));
      if (label === 'Bring to front')
        assert(
          z > document.layouts.b[0].b.z && z > document.connections.edge.z,
        );
      if (label === 'Send to back')
        assert(
          z < document.layouts.b[0].b.z && z < document.connections.edge.z,
        );
    }
    // Right-drag still pans, including when starting on a selected object.
    let p = await position('a');
    await driver.drag(p.x, p.y, 60, 30, 2);
    assert.equal(
      await driver.sync(
        'return !!document.querySelector(".selection-menu:popover-open")',
      ),
      false,
    );
    const moved = await position('a');
    assert(Math.abs(moved.x - p.x - 60) < 1);

    // Marquee captures both shapes and their connector; right-click preserves it.
    const pa = await position('a'),
      pb = await position('b');
    const scale = await driver.sync('return window.Konva.stages[0].scaleX()');
    const left = Math.min(pa.x, pb.x) - 100 * scale,
      top = Math.min(pa.y, pb.y) - 70 * scale;
    const right = Math.max(pa.x, pb.x) + 100 * scale,
      bottom = Math.max(pa.y, pb.y) + 70 * scale;
    await driver.drag(left, top, right - left, bottom - top, 0);
    await menu('a');
    assert.equal(
      await driver.sync(
        `return !!document.querySelector('.selection-menu [aria-label="Add link"]')`,
      ),
      false,
    );
    await capture('selection-menu-multiple');
    await driver.click('Flip horizontal');
    document = await save();
    assert(document.layouts.a[0].a.x > document.layouts.b[0].b.x);
    assert.equal(document.connections.edge.start.kind, 'object');
    await menu('a');
    await driver.click('Flip vertical');
    document = await save();
    assert(document.layouts.a[0].a.y > document.layouts.b[0].b.y);
    await menu('a');
    await driver.click('Save Template');
    await driver.until(() =>
      driver.sync(
        `return !!document.querySelector('dialog[aria-label="Save template"]')`,
      ),
    );
    await driver.click('Cancel');
    await driver.until(() =>
      driver.sync('return !document.querySelector("dialog[open]")'),
    );
    await menu('a');
    await driver.click('Save Template');
    await driver.sync(
      'const e=document.querySelector("dialog input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"Context selection");e.dispatchEvent(new Event("input",{bubbles:true}))',
    );
    await driver.click('Review template');
    await driver.click('Save to library');
    await driver.until(
      async () => (await driver.native('template:list')).entries.length === 1,
    );
    const personal = (await driver.native('template:list')).entries[0];
    assert.equal(Object.keys(personal.document.objects).length, 2);
    assert.equal(Object.keys(personal.document.connections).length, 1);
    assert.equal(
      personal.document.extensions.template.name,
      'Context selection',
    );
    assert.equal((await readdir(path.join(profile, 'templates'))).length, 1);
    await driver.until(() =>
      driver.sync('return !document.querySelector("dialog[open]")'),
    );
    // Keyboard invocation, Escape and Delete use the same selection.
    await driver.sync(
      'const e=document.querySelector(".canvas-container");e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true,bubbles:true,cancelable:true}))',
    );
    await driver.until(() =>
      driver.sync(
        'return !!document.querySelector(".selection-menu:popover-open")',
      ),
    );
    await dismiss();
    await menu('a');
    await driver.click('Delete');
    await driver.until(() =>
      driver.sync(
        'return window.Konva.stages[0].find(".recursive-object").length===0',
      ),
    );
    await driver.click('Undo');
    await save();
    // Project boards stay open together; object links activate the matching session.
    const otherFile = path.join(profile, 'other-board.depthplan');
    await writeFile(
      otherFile,
      JSON.stringify({
        ...source,
        id: 'other-board',
        metadata: { ...source.metadata, title: 'Other board' },
      }),
    );
    const projectFile = path.join(profile, 'links.depthproject');
    await writeFile(
      projectFile,
      JSON.stringify({
        projectVersion: 1,
        id: 'link-project',
        name: 'Object links',
        description: '',
        autosave: false,
        homeBoardId: 'context-board',
        boards: [
          {
            id: 'context-board',
            name: 'Context board',
            path: path.basename(file),
          },
          {
            id: 'other-board',
            name: 'Other board',
            path: path.basename(otherFile),
          },
        ],
      }),
    );
    await driver.dialogs('project-open', projectFile);
    await driver.click('Menu');
    await driver.click('Open Project…');
    await driver.until(() =>
      driver.sync(
        'return !!document.querySelector("#project-drawer, .project-drawer-toggle")',
      ),
    );
    if (
      !(await driver.sync('return !!document.querySelector("#project-drawer")'))
    )
      await driver.click('Toggle project boards');
    await driver.sync(
      'document.getElementById("board-link-other-board").click()',
    );
    await driver.until(() =>
      driver.sync(
        'return document.getElementById("board-other-board")?.dataset.active === "true"',
      ),
    );
    await driver.js('window.desktop.openLink(arguments[0])', [link]);
    await driver.until(() =>
      driver.sync(
        'return document.getElementById("board-context-board")?.dataset.active === "true"',
      ),
    );
    assert.deepEqual(await driver.sync('return window.nativeErrors'), []);
    await driver.close();
    driver = await launchNative(profile);
    const persisted = (await driver.native('template:list')).entries;
    assert.equal(persisted.length, 1);
    assert.deepEqual(persisted[0], personal);
    console.log(
      `PASS selection menu: actions, clipboard, Undo, style copy, links, stacking, flips, multi-selection, right-pan, keyboard menu and personal templates after restart. Evidence: ${profile}`,
    );
    return profile;
  } catch (error) {
    await capture('selection-menu-failure').catch(() => {});
    console.error(`Selection menu evidence: ${profile}`);
    throw error;
  } finally {
    await driver.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await selectionMenu();
