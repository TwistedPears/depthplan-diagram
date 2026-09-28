import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function menuSettings(driver) {
  const { click, sync, until, native, dialogs, profile, request, session } =
    driver;
  const pause = () =>
    driver.js('new Promise(resolve=>setTimeout(resolve,1500))');
  const hover = (selector) =>
    sync(
      `
    const next=document.querySelector(arguments[0]);
    const previous=window.testHoverNode;
    previous?.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:next}));
    next?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:previous}));
    window.testHoverNode=next;
  `,
      [selector],
    );
  const expanded = (name) =>
    sync(
      `return document.querySelector('[role=menu][aria-label="'+arguments[0]+'"]').matches(':popover-open')`,
      [name],
    );
  await click('Menu');
  assert.deepEqual(
    await sync(
      `return [...document.querySelectorAll('#document-menu button')].filter(b=>!b.closest('[popover]')).map(b=>b.textContent.trim())`,
    ),
    [
      'Open Recent',
      'New Board',
      'Open Board…',
      'Save Board As…',
      'New Project',
      'Open Project…',
      'Save Project As…',
      'Save All',
      'Close All',
      'Templates',
      'Export',
      'Settings',
      'Quit DepthPlan',
    ],
  );
  assert(
    await sync(
      `return !document.querySelector('#document-menu svg') && document.querySelector('.recent-projects').nextElementSibling.matches('.dropdown-separator')`,
    ),
  );
  assert(
    await sync(
      `const menu=document.querySelector('#document-menu');const settings=menu.querySelector('[aria-label="Settings"]').closest('.menu-flyout');return settings.previousElementSibling.lastElementChild.textContent.trim()==='Export' && menu.lastElementChild.textContent.trim()==='Quit DepthPlan' && menu.lastElementChild.previousElementSibling.matches('.dropdown-separator')`,
    ),
  );
  for (const label of ['Open Recent', 'Settings']) {
    const panel = `[role=menu][aria-label="${label}"]`;
    const trigger = await sync(
      `const panel=document.querySelector(arguments[0]);panel.previousElementSibling.id='hover-trigger';return '#hover-trigger'`,
      [panel],
    );
    await hover(trigger);
    await until(() => expanded(label));
    await hover(panel);
    await driver.js('new Promise(resolve=>setTimeout(resolve,200))');
    assert(await expanded(label), 'Hovering the submenu must keep it open');
    await hover('#document-menu .dropdown-label');
    await until(async () => !(await expanded(label)));
    await sync(
      `document.querySelector('#hover-trigger').removeAttribute('id')`,
    );
  }
  await click('Settings');
  assert(
    await sync(
      `return document.querySelector('[aria-label="Autosave"]').getAttribute('aria-checked')==='true'`,
    ),
  );
  for (const [width, height] of [
    [1440, 1000],
    [900, 640],
  ]) {
    await request(`/session/${session}/window/rect`, { width, height });
    await driver.js(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    assert(
      await sync(
        `const p=document.querySelector('[role=menu][aria-label=Settings]').getBoundingClientRect();const m=document.querySelector('#document-menu').getBoundingClientRect();return p.left>=m.right-2 && p.right<=innerWidth && p.bottom<=innerHeight`,
      ),
    );
    await writeFile(
      path.join(profile, `settings-menu-${width}.png`),
      Buffer.from(
        await request(`/session/${session}/screenshot`, undefined, 'GET'),
        'base64',
      ),
    );
  }
  await request(`/session/${session}/window/rect`, {
    width: 1280,
    height: 900,
  });
  await sync(
    `document.querySelector('[role=menu][aria-label=Settings]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
  );
  await until(async () => !(await expanded('Settings')));
  assert.equal(
    await sync('return document.activeElement.textContent'),
    'Settings',
  );
  await click('Menu');
  const sample = JSON.parse(
    await readFile('docs/sample/recursive_document.depthplan', 'utf8'),
  );
  const file = path.join(profile, 'autosave-board.depthplan');
  await writeFile(file, JSON.stringify(sample));
  await native('test:open-files', [file]);
  await until(() =>
    sync(
      'return document.querySelector(".document-state")?.textContent==="autosave-board.depthplan"',
    ),
  );
  const rename = async (title) => {
    await sync(
      `document.querySelector('.document-name').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    );
    await until(() =>
      sync('return !!document.querySelector("[data-inline-edit]")'),
    );
    await sync(
      `const input=document.querySelector('[data-inline-edit]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[0]);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));`,
      [title],
    );
    await until(() =>
      sync('return !document.querySelector("[data-inline-edit]")'),
    );
  };
  const title = async () =>
    JSON.parse(await readFile(file, 'utf8')).metadata.title;
  await rename('Automatic standalone');
  await until(async () => (await title()) === 'Automatic standalone');
  await click('Menu');
  await click('Settings');
  await sync(`document.querySelector('[aria-label=Autosave]').click()`);
  assert.equal(
    await sync('return localStorage.getItem("depthplan.autosave")'),
    'off',
  );
  await click('Menu');
  await rename('Manual standalone');
  await pause();
  assert.equal(await title(), 'Automatic standalone');
  await click('Save document');
  await until(async () => (await title()) === 'Manual standalone');
  await click('Menu');
  await click('Settings');
  await sync(`document.querySelector('[aria-label=Autosave]').click()`);
  await click('Menu');
  await click('Menu');
  await click('New Board');
  await until(() =>
    sync(
      'return document.querySelector(".document-state").textContent === "Not saved yet"',
    ),
  );
  assert(
    await sync(
      'return !!document.querySelector(".canvas-welcome") && !document.querySelector(".document-name sup") && document.querySelector("button[aria-label=Undo]").disabled && document.querySelector("button[aria-label=Redo]").disabled',
    ),
  );
  for (const x of [300, 600]) {
    await click('Square');
    await driver.drag(x, 300, 120, 90, 0);
  }
  await driver.drag(250, 240, 510, 230, 0);
  await click('Delete selected');
  await until(() =>
    sync(
      'return window.Konva.stages[0].find(".recursive-object").length === 0',
    ),
  );
  assert(
    await sync(
      'return !!document.querySelector(".document-name sup") && !document.querySelector(".canvas-welcome")',
    ),
  );
  for (let n = 0; n < 3; n++) await click('Undo');
  assert(
    await sync(
      'return !!document.querySelector(".document-name sup") && !document.querySelector(".canvas-welcome") && document.querySelector("button[aria-label=Undo]").disabled && !document.querySelector("button[aria-label=Redo]").disabled',
    ),
  );
  for (let n = 0; n < 3; n++) await click('Redo');
  await dialogs('message', 'Cancel');
  await click('Menu');
  await click('New Board');
  assert(
    await sync(
      'return !!document.querySelector(".document-name sup") && !document.querySelector(".canvas-welcome")',
    ),
  );
  const before = await native('test:last-file-dialog');
  await dialogs('save', null);
  await rename('Unsaved memory board');
  assert(await sync('return !!document.querySelector(".document-name sup")'));
  await click('Undo');
  assert(await sync('return !!document.querySelector(".document-name sup")'));
  await click('Redo');
  assert(await sync('return !!document.querySelector(".document-name sup")'));
  await pause();
  assert.deepEqual(
    await native('test:last-file-dialog'),
    before,
    'Autosave must not prompt for the first save',
  );
  assert.equal(
    await sync('return document.querySelector(".document-state").textContent'),
    'Not saved yet',
  );
  await dialogs('message', 'Discard');
  await click('Menu');
  await click('Close All');
  await until(() =>
    sync(
      'return document.querySelector(".document-name").textContent.includes("Untitled")',
    ),
  );
  assert(
    await sync(
      'return !!document.querySelector(".canvas-welcome") && !document.querySelector(".document-name sup")',
    ),
  );
  await native('test:dialogs', []);
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    `PASS menu order, hover dismissal, keyboard, Autosave default/on/off/manual/first-save and settings layouts. Evidence: ${profile}`,
  );
}
