import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// The real project UI and native storage, using only disposable files/dialog choices.
export async function projectNavigation(driver) {
  const { click, sync, until, dialogs, profile, request, session } = driver;
  const fillName = (value) =>
    sync(
      `const input=document.querySelector('dialog[open] input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[0]);
    input.dispatchEvent(new Event('input',{bubbles:true})); return true`,
      [value],
    );
  const dialogGone = () =>
    until(
      () => sync('return !document.querySelector("dialog[open]")'),
      'Project dialog did not complete',
    );
  const drawer = async () => {
    if (!(await sync('return !!document.querySelector("#project-drawer")')))
      await click('Toggle project boards');
  };
  const boardAction = async (name, action) => {
    await drawer();
    await until(() =>
      sync(
        `const summary=Array.from(document.querySelectorAll('summary')).find(s=>s.getAttribute('aria-label')===arguments[0]);
      if(!summary)return false; summary.parentElement.open=true;
      const button=Array.from(summary.parentElement.querySelectorAll('button')).find(b=>b.textContent.trim()===arguments[1]);
      if(!button||button.disabled)return false;button.click();return true`,
        [`Actions for ${name}`, action],
      ),
    );
  };
  await click('Menu');
  await click('New Project…');
  await fillName('Navigation Project');
  // The generated folder is previewed and does not overwrite an existing folder.
  await dialogs('folder', profile);
  await click('Choose folder and create');
  await dialogGone();
  // Case-preserving generated folder name is the visible preview.
  const actualPath = path.join(
    profile,
    'Navigation-Project',
    'project.depthproject',
  );
  const project = JSON.parse(await readFile(actualPath, 'utf8'));
  assert.equal(project.boards.length, 1);
  const root = path.dirname(actualPath);
  // Read using the actual generated destination in the rest of the journey.
  const current = async () => JSON.parse(await readFile(actualPath, 'utf8'));
  const a = path.join(profile, 'navigation-source.depthplan');
  const b = path.join(profile, 'navigation-legacy.depthplan.json');
  const original = await readFile('docs/sample/recursive_document.depthplan');
  const second = await readFile('docs/sample/workflow_document.depthplan');
  await writeFile(a, original);
  await writeFile(b, second);
  await drawer();
  await dialogs('project-import', [a, b]);
  await click('Import Boards…');
  await until(async () => (await current()).boards.length === 3);
  await until(() =>
    sync('return document.querySelectorAll("[role=tab]").length===2'),
  );
  assert.deepEqual(await readFile(a), original);
  assert.deepEqual(await readFile(b), second);
  await click('New Board');
  await fillName('設計 API');
  await click('Create board');
  await dialogGone();
  const newId = (await current()).boards.at(-1).id;
  await boardAction('設計 API', 'Rename…');
  await fillName('API Details');
  await click('Rename board');
  await dialogGone();
  assert.equal((await current()).boards.at(-1).id, newId);
  await boardAction('API Details', 'Duplicate…');
  await click('Duplicate board');
  await dialogGone();
  const duplicate = (await current()).boards.at(-1);
  assert.notEqual(duplicate.id, newId);
  await boardAction(duplicate.name, 'Move up');
  await until(async () => (await current()).boards.at(-2).id === duplicate.id);
  await boardAction('API Details', 'Remove from Project…');
  await click('Remove board');
  await dialogGone();
  assert.ok(!(await current()).boards.some((board) => board.id === newId));
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'API-Details.depthplan'), 'utf8'))
      .id,
    newId,
  );
  await click(`Close ${duplicate.name} tab`);
  assert.ok(
    (await current()).boards.some((board) => board.id === duplicate.id),
  );
  const persisted = await current();
  await click('Menu');
  await click('Close Project');
  await until(() =>
    sync('return !document.querySelector(".project-navigation")'),
  );
  await click('Menu');
  await dialogs('project-open', actualPath);
  await click('Open Project…');
  await until(() => sync('return !!document.querySelector("[role=tab]")'));
  assert.deepEqual(await current(), persisted);
  await drawer();
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
      path.join(profile, `project-${width}.png`),
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
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  await click('Menu');
  await click('Close Project');
  await until(() =>
    sync('return !document.querySelector(".project-navigation")'),
  );
  await request(`/session/${session}/window/rect`, {
    width: 1280,
    height: 900,
  });
  return { project: actualPath, evidence: profile };
}
