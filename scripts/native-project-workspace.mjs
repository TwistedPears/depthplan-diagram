import assert from 'node:assert/strict';
import { readFile, writeFile, cp, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import client from './mcp/native-client.cjs';
import { launchNative } from './native-driver.mjs';

export async function projectWorkspace(driver) {
  let current = driver;
  let probe;
  const rootProfile = driver.profile;
  const sample = JSON.parse(
    await readFile('docs/sample/recursive_document.depthplan', 'utf8'),
  );
  sample.metadata.title = 'Board A';
  await driver.dialogs('folder', rootProfile);
  let project = (
    await driver.native(
      'project:create',
      'Resume Project',
      'Resume-Project',
      sample,
    )
  ).project;
  for (const name of ['B', 'C'])
    project = (
      await driver.native(
        'project:apply',
        project.sessionId,
        project.fingerprint,
        {
          kind: 'duplicateBoard',
          boardId: project.manifest.boards[0].id,
          name: `Board ${name}`,
          path: `Board-${name}.depthplan`,
        },
      )
    ).project;
  const [a, b, c] = project.manifest.boards;
  const originalRoot = path.dirname(project.location);
  const originals = await Promise.all(
    project.manifest.boards.map((board) =>
      readFile(path.join(originalRoot, board.path)),
    ),
  );
  const manifestBytes = await readFile(project.location);
  await driver.native('project:close', project.sessionId);
  const tabs = () =>
    current.sync(
      'return Array.from(document.querySelectorAll("[role=tab]")).map(t=>t.id.slice(4))',
    );
  const active = () =>
    current.sync(
      'return document.querySelector("[role=tab][aria-selected=true]")?.id.slice(4) ?? null',
    );
  const opened = () => current.until(async () => (await active()) === a.id);
  const open = async (board) => {
    if (
      !(await current.sync(
        'return !!document.querySelector("#project-drawer")',
      ))
    )
      await current.click('Toggle project boards');
    await current.click(`Open ${board.name}, ${board.path}`);
    await current.until(async () => (await active()) === board.id);
  };
  const closeProject = async () => {
    await current.click('Menu');
    await current.click('Close Project');
    await current.until(() =>
      current.sync('return !document.querySelector(".project-navigation")'),
    );
  };
  const capture = async (name) => {
    for (const [width, height] of [
      [1440, 1000],
      [1024, 728],
      [900, 640],
    ]) {
      await current.request(`/session/${current.session}/window/rect`, {
        width,
        height,
      });
      await current.js(
        'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
      );
      await writeFile(
        path.join(rootProfile, `${name}-${width}.png`),
        Buffer.from(
          await current.request(
            `/session/${current.session}/screenshot`,
            undefined,
            'GET',
          ),
          'base64',
        ),
      );
    }
  };
  const workspace = async () =>
    JSON.parse(
      await readFile(path.join(rootProfile, 'workspaces.json'), 'utf8'),
    ).find(
      (entry) =>
        entry.id === project.manifest.id && entry.location === project.location,
    )?.view;
  try {
    await current.click('Menu');
    await capture('project-start');
    await current.click('Menu');
    const status = await current.native('automation:enable', true);
    await current.native('test:open-files', [project.location]);
    await opened();
    probe = client(current.adapter, status.descriptor);
    await probe.initialize();
    let sequence = 0;
    const camera = async (x) => {
      const state = await probe.call('depthplan_get_state');
      assert.equal(state.ok, true, JSON.stringify(state));
      const result = await probe.call('depthplan_camera', {
        handle: state.data.handle,
        expectedRevision: state.data.revision,
        expectedViewRevision: state.data.viewRevision,
        requestId: `workspace-${sequence++}`,
        action: { type: 'set', camera: { x, y: -25, scale: 0.75 } },
      });
      assert.equal(result.ok, true, JSON.stringify(result));
    };
    await camera(100);
    await open(b);
    await camera(200);
    await open(c);
    await camera(300);
    await open(b);
    await current.until(async () => {
      try {
        const saved = await workspace();
        return (
          saved?.tabs.length === 3 &&
          saved.active === b.id &&
          saved.tabs[2].camera.x === 300
        );
      } catch {
        return false;
      }
    });
    await current.native('test:open-files', [project.location]);
    await current.until(
      async () => (await current.native('file:open-requests')).length === 0,
    );
    assert.deepEqual(await tabs(), [a.id, b.id, c.id]);
    assert.equal(await active(), b.id);
    await closeProject();
    await current.click('Menu');
    await current.click('Recent Projects…');
    await current.until(() =>
      current.sync(
        'return document.querySelector("dialog")?.textContent.includes("Resume Project")',
      ),
    );
    await capture('project-recents');
    await current.click('Open Resume Project');
    await current.until(async () => (await active()) === b.id);
    assert.deepEqual(await tabs(), [a.id, b.id, c.id]);
    for (const [index, board] of [a, b, c].entries()) {
      await open(board);
      const state = await probe.call('depthplan_get_state');
      assert.equal(
        state.data.camera.x,
        (index + 1) * 100,
        JSON.stringify(state),
      );
      assert.equal(state.data.dirty, false);
    }
    await open(b);
    await closeProject();
    probe.close();
    probe = null;
    await current.close();
    current = await launchNative(rootProfile, [project.location]);
    await current.until(async () => (await active()) === b.id);
    assert.deepEqual(await tabs(), [a.id, b.id, c.id]);
    await closeProject();
    const copiedRoot = path.join(rootProfile, 'Copied-Project');
    await cp(originalRoot, copiedRoot, { recursive: true });
    await current.native('test:open-files', [
      path.join(copiedRoot, 'project.depthproject'),
    ]);
    await opened();
    assert.deepEqual(await tabs(), [a.id]);
    await closeProject();
    const movedRoot = path.join(rootProfile, 'Moved-Project');
    await rename(originalRoot, movedRoot);
    project.location = path.join(movedRoot, 'project.depthproject');
    await current.click('Menu');
    await current.click('Recent Projects…');
    await current.until(() =>
      current.sync(
        'return !!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Locate Resume Project…")',
      ),
    );
    await current.native('test:dialogs', [
      { kind: 'project-open', value: project.location },
      { kind: 'message', value: 'Restore workspace' },
    ]);
    await current.click('Locate Resume Project…');
    await current.until(async () => (await active()) === b.id);
    assert.deepEqual(await tabs(), [a.id, b.id, c.id]);
    await closeProject();
    await unlink(path.join(movedRoot, c.path));
    await current.native('test:open-files', [project.location]);
    await current.until(async () => (await active()) === b.id);
    assert.deepEqual(await tabs(), [a.id, b.id]);
    assert.deepEqual(await readFile(project.location), manifestBytes);
    for (const [index, board] of [a, b].entries())
      assert.deepEqual(
        await readFile(path.join(movedRoot, board.path)),
        originals[index],
      );
    assert.deepEqual(await current.sync('return window.nativeErrors'), []);
    console.log(
      `PASS project workspace: cold/warm native opens, three-board tabs/cameras, same-location focus, copied isolation, moved recovery, missing member fallback and unchanged sources. Evidence: ${rootProfile}`,
    );
  } finally {
    probe?.close();
    await current.close();
  }
}
