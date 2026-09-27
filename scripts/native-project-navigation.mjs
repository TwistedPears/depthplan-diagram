import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Exercise the actual drawer, inline edits, system Save and recent-project submenu.
export async function projectNavigation(driver) {
  const { click, sync, until, dialogs, native, profile, request, session } =
    driver;
  const drawer = async () => {
    await until(() =>
      sync(
        'return !!document.querySelector("#project-drawer, .project-drawer-toggle")',
      ),
    );
    if (!(await sync('return !!document.querySelector("#project-drawer")')))
      await click('Toggle project boards');
  };
  const edit = async (selector, value, key = 'Enter') => {
    await sync(
      '[...document.querySelectorAll(arguments[0])].find(n=>n.getClientRects().length).dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));',
      [selector],
    );
    await until(() =>
      sync('return !!document.querySelector("[data-inline-edit]")'),
    );
    await sync(
      `const input=[...document.querySelectorAll('[data-inline-edit]')].find(n=>n.getClientRects().length);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[0]);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      if(arguments[1]==='Tab') input.blur();
      else input.dispatchEvent(new KeyboardEvent('keydown',{key:arguments[1],bubbles:true,cancelable:true}));`,
      [value, key],
    );
    await until(
      () =>
        sync(
          'return ![...document.querySelectorAll("[data-inline-edit]")].some(n=>n.getClientRects().length)',
        ),
      'Inline edit did not finish',
    ).catch(async (error) => {
      throw new Error(
        `${error.message}: ${await sync('return [...document.querySelectorAll(".project-notice,[data-inline-edit]")].map(n=>n.textContent||n.value).join(" | ")')}`,
      );
    });
  };
  const capture = async (name) => {
    for (const [width, height] of [
      [1440, 1000],
      [1024, 728],
      [900, 640],
    ]) {
      await request(`/session/${session}/window/rect`, { width, height });
      await driver.js(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
      );
      await writeFile(
        path.join(profile, `${name}-${width}.png`),
        Buffer.from(
          await request(`/session/${session}/screenshot`, undefined, 'GET'),
          'base64',
        ),
      );
      assert.equal(
        await sync('return document.documentElement.scrollWidth > innerWidth'),
        false,
      );
    }
  };
  await click('Menu');
  await click('New Project');
  await drawer();
  assert.equal(
    await sync('return document.querySelector(".project-title").textContent'),
    'Untitled Project',
  );
  assert.equal(
    await sync('return !!document.querySelector(".project-drawer-toggle")'),
    false,
  );
  assert.deepEqual(
    await sync(
      'const icon=document.querySelector("#project-drawer header svg"); return [icon.querySelector("use").getAttribute("href"),icon.style.transform]',
    ),
    ['#icon-arrow-down-to-line', 'rotate(-90deg) scaleX(1)'],
  );
  await click('Close board drawer');
  assert.equal(
    await sync(
      'return document.querySelector(".project-drawer-toggle").textContent',
    ),
    'Project',
  );
  await drawer();
  await edit('.project-title', 'Discarded', 'Escape');
  assert.equal(
    await sync('return document.querySelector(".project-title").textContent'),
    'Untitled Project',
  );
  await edit('.project-title', 'Navigation Project', 'Tab');
  const initialFiles = await readdir(profile);
  const firstId = await sync(
    'return document.querySelector(".project-board-open").dataset.boardId',
  );
  await edit(`#board-link-${firstId}`, 'Overview');
  await edit(`#board-link-${firstId}`, 'overview');
  await sync(`const input=document.querySelector('[aria-label="New bookmark name"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Memory bookmark');
    input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await click('Add bookmark');
  await click('New Board');
  await until(() =>
    sync('return document.querySelectorAll("[data-board-session]").length===2'),
  );
  await edit('.document-caption .document-name', 'Detail Board');
  await edit('.document-caption .document-state', 'Custom Board', 'Tab');
  await driver.boardAction(firstId, 'Close board');
  assert.deepEqual(await readdir(profile), initialFiles);
  await dialogs('project-save', null);
  await click('Menu');
  await click('Save As…');
  await until(
    async () => (await native('test:last-file-dialog')).kind === 'project-save',
  );
  assert.deepEqual(await native('test:last-file-dialog'), {
    kind: 'project-save',
    name: 'navigation_project.depthproject',
  });
  await until(() =>
    sync('return !document.querySelector(".quick-save").disabled'),
  );
  assert.equal(
    await sync('return !!document.querySelector("dialog[open]")'),
    false,
  );
  assert.deepEqual(await readdir(profile), initialFiles);
  const projectRoot = path.join(profile, 'navigation-project');
  await mkdir(projectRoot);
  const actualPath = path.join(projectRoot, 'navigation_project.depthproject');
  await dialogs('project-save', actualPath);
  await click('Save document');
  const current = async () => JSON.parse(await readFile(actualPath, 'utf8'));
  await until(async () => {
    try {
      return (await current()).boards.length === 2;
    } catch {
      return false;
    }
  });
  const project = await current();
  assert.deepEqual(
    project.boards.map((b) => b.path),
    ['overview.depthplan', 'Custom Board.depthplan'],
  );
  const memoryBoard = JSON.parse(
    await readFile(path.join(projectRoot, project.boards[0].path), 'utf8'),
  );
  assert.equal(memoryBoard.metadata.title, 'overview');
  await edit(`#board-link-${firstId}`, 'Overview');
  assert.equal((await current()).boards[0].path, 'overview.depthplan');
  assert.equal(
    JSON.parse(
      await readFile(path.join(projectRoot, 'overview.depthplan'), 'utf8'),
    ).metadata.title,
    'Overview',
  );
  assert.ok(
    Object.values(memoryBoard.namedViews).some(
      (view) => view.name === 'Memory bookmark',
    ),
  );
  await until(() =>
    sync('return !document.querySelector(".document-name sup")'),
  );
  await edit(
    '.document-caption .document-state',
    'discarded.depthplan',
    'Escape',
  );
  assert.equal((await current()).boards[1].path, 'Custom Board.depthplan');
  await edit('.document-caption .document-state', 'Exact Board Name.depthplan');
  assert.equal((await current()).boards[1].path, 'Exact Board Name.depthplan');
  assert.ok(!(await readdir(projectRoot)).includes('Custom Board.depthplan'));
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(projectRoot, 'Exact Board Name.depthplan'),
        'utf8',
      ),
    ).id,
    project.boards[1].id,
  );
  await until(() =>
    sync('return !document.querySelector(".workspace-notice")'),
  );
  await sync(`window.saveNotices=[]; new MutationObserver(()=>{ const text=document.querySelector('.workspace-notice')?.textContent; if(text) window.saveNotices.push(text); }).observe(document.body,{subtree:true,childList:true,characterData:true});
    const input=document.querySelector('[aria-label="New bookmark name"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Autosave check'); input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await click('Add bookmark');
  assert.equal(
    await sync(
      'return document.querySelector(".document-name sup")?.textContent',
    ),
    '*',
  );
  assert.equal(
    await sync('return document.querySelector(".document-name").title'),
    'Detail Board — Unsaved',
  );
  await until(async () =>
    Object.values(
      JSON.parse(
        await readFile(
          path.join(projectRoot, 'Exact Board Name.depthplan'),
          'utf8',
        ),
      ).namedViews ?? {},
    ).some((v) => v.name === 'Autosave check'),
  );
  await until(() =>
    sync('return !document.querySelector(".document-name sup")'),
  );
  assert.equal(
    await sync(
      'return window.saveNotices.some(text=>/^(Saving|Saved:|In memory)/.test(text))',
    ),
    false,
  );
  await capture('project-inline');
  await click('Menu');
  const menuLabels = await sync(
    'return [...document.querySelectorAll("#document-menu button")].filter(b=>!b.closest("[popover]")).map(b=>b.textContent.trim())',
  );
  assert.deepEqual(
    menuLabels.slice(
      menuLabels.indexOf('Save'),
      menuLabels.indexOf('Save') + 3,
    ),
    ['Save', 'Save As…', 'Close Project'],
  );
  for (const removed of [
    'Save Project',
    'Open Board in Project…',
    'Search Project…',
    'Reload',
    'Recent Projects',
    'Save Copy…',
  ])
    assert(!menuLabels.includes(removed));
  assert(
    await sync(
      'return [...document.querySelectorAll("#document-menu .dropdown-label")].some(n=>n.textContent==="Boards")',
    ),
  );
  assert.equal(menuLabels[0], 'Open Recent');
  assert.equal(menuLabels.at(-1), 'Settings');
  assert(
    await sync(
      `return !document.querySelector('#document-menu svg') && [...document.querySelectorAll('#document-menu .dropdown-label')].map(n=>n.textContent).join(',') === 'Boards,Projects' && [...document.querySelectorAll('#document-menu .dropdown-label')].every(n=>getComputedStyle(n).userSelect==='none' || getComputedStyle(n).webkitUserSelect==='none')`,
    ),
  );
  await capture('project-menu');
  assert.equal(
    await sync(
      'return [...document.querySelectorAll("#document-menu button")].some(b=>b.textContent.includes("Project Settings"))',
    ),
    false,
  );
  await click('Save');
  const lastDialog = await native('test:last-file-dialog');
  await dialogs('save', null);
  await click('Menu');
  await click('Save As…');
  await until(() =>
    sync('return !document.querySelector(".quick-save").disabled'),
  );
  assert.deepEqual(
    await native('test:last-file-dialog'),
    lastDialog,
    'Saved-project Save As saves the project without a board-copy chooser',
  );
  await native('test:dialogs', []);
  await click('Menu');
  await click('Open Board…');
  await until(() =>
    sync(`return !!document.querySelector('dialog[aria-label="Open Board"]')`),
  );
  await capture('project-open-board');
  const importSource = path.join(profile, 'menu-import.depthplan');
  await writeFile(
    importSource,
    JSON.stringify({
      ...memoryBoard,
      metadata: { ...memoryBoard.metadata, title: 'Imported from menu' },
    }),
  );
  await dialogs('project-import', [importSource]);
  await click('Import');
  await until(async () => (await current()).boards.length === 3);
  assert.equal((await current()).boards[2].name, 'Imported from menu');
  await click('Menu');
  await click('Open Board…');
  await dialogs('open', null);
  await click('Standalone');
  assert(await sync('return !!document.querySelector(".project-navigation")'));
  await click('Menu');
  await click('Close Project');
  await until(() =>
    sync('return !document.querySelector(".project-navigation")'),
  );
  for (let n = 0; n < 6; n++) {
    await dialogs('folder', profile);
    const created = await native(
      'project:create',
      `Recent ${n}`,
      `recent_${n}`,
    );
    assert.equal(created.status, 'success');
    await native('project:remember', created.project.sessionId, null);
    await native('project:close', created.project.sessionId);
  }
  const recents = (await native('project:recents')).entries.slice(0, 5);
  await click('Menu');
  await sync('document.querySelector(".recent-projects > button").click()');
  await until(() =>
    sync(
      'return document.querySelectorAll(".recent-projects .menu-flyout-panel button").length===5',
    ),
  );
  assert.deepEqual(
    await sync(
      'return [...document.querySelectorAll(".recent-projects .menu-flyout-panel button")].map(b=>b.firstChild.textContent)',
    ),
    recents.map((p) => p.name),
  );
  assert.equal(
    await sync('return !!document.querySelector("dialog[open]")'),
    false,
  );
  await capture('project-recents');
  assert(
    await sync(
      `const menu=document.querySelector('#document-menu').getBoundingClientRect();const flyout=document.querySelector('.recent-projects .menu-flyout-panel').getBoundingClientRect();return flyout.left>=menu.right-2 && flyout.right<=innerWidth && flyout.bottom<=innerHeight;`,
    ),
    'Open Recent flies out to the right and stays within the viewport',
  );
  await sync(
    `document.querySelector('.recent-projects > button').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));`,
  );
  await until(() =>
    sync('return document.activeElement.getAttribute("role")==="menuitem"'),
  );
  await sync(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`,
  );
  await until(() =>
    sync(
      'return document.querySelector(".recent-projects > button").getAttribute("aria-expanded")==="false"',
    ),
  );
  assert(
    await sync(
      'return !document.querySelector("#document-menu").hidden && document.activeElement.textContent.trim()==="Open Recent"',
    ),
  );
  await click('Open Recent');
  await until(() =>
    sync(
      'return document.querySelector(".recent-projects > button").getAttribute("aria-expanded")==="true"',
    ),
  );
  await sync(
    'document.querySelector(".recent-projects .menu-flyout-panel button").click()',
  );
  await until(() =>
    sync('return !!document.querySelector(".project-navigation")'),
  );
  await drawer();
  assert.equal(
    await sync('return document.querySelector(".project-title").textContent'),
    recents[0].name,
  );
  await click('Menu');
  await click('Open Board…');
  await dialogs('open', importSource);
  await click('Standalone');
  await until(() =>
    sync('return !document.querySelector(".project-navigation")'),
  );
  assert.equal(
    await sync('return document.querySelector(".document-state").textContent'),
    'menu-import.depthplan',
  );
  await click('Menu');
  await click('Close Board');
  await until(() =>
    sync(
      'return document.querySelector(".document-state").textContent === "Not saved yet"',
    ),
  );
  const standalone = path.join(profile, 'standalone.depthplan');
  await writeFile(standalone, JSON.stringify(memoryBoard));
  await native('test:open-files', [standalone]);
  await until(() =>
    sync(
      'return document.querySelector(".document-state")?.textContent === "standalone.depthplan"',
    ),
  );
  await edit('.document-name', 'Standalone title');
  await edit('.document-state', 'Standalone exact', 'Tab');
  const renamed = JSON.parse(
    await readFile(path.join(profile, 'Standalone exact.depthplan'), 'utf8'),
  );
  assert.equal(renamed.id, memoryBoard.id);
  assert.equal(renamed.metadata.title, 'Standalone title');
  assert.ok(!(await readdir(profile)).includes('standalone.depthplan'));
  assert.equal(
    await sync('return !!document.querySelector(".project-notice")'),
    false,
  );
  await click('Save document');
  await until(() =>
    sync(
      'return document.querySelector(".workspace-notice")?.textContent.startsWith("Saved:")',
    ),
  );
  assert.equal(
    await sync(
      'const n=document.querySelector(".workspace-notice");return n.getBoundingClientRect().top > innerHeight/2 && getComputedStyle(n).borderTopWidth==="0px"',
    ),
    true,
  );
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  await request(`/session/${session}/window/rect`, {
    width: 1280,
    height: 900,
  });
  return { project: actualPath, evidence: profile };
}
