import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import client from './mcp/native-client.cjs';
import { launchNative } from './native-driver.mjs';

export async function projectPersistence(driver) {
  const { native, dialogs, click, sync, until, profile } = driver;
  const sample = JSON.parse(
    await readFile('docs/sample/recursive_document.depthplan', 'utf8'),
  );
  sample.metadata.title = 'Board A';
  await dialogs('folder', profile);
  let project = (
    await native(
      'project:create',
      'Persistence Project',
      'Persistence-Project',
      sample,
    )
  ).project;
  assert.ok(project);
  const a = project.manifest.boards[0];
  project = (
    await native('project:apply', project.sessionId, project.fingerprint, {
      kind: 'duplicateBoard',
      boardId: a.id,
      name: 'Board B',
      path: 'Board-B.depthplan',
    })
  ).project;
  const b = project.manifest.boards[1];
  const root = path.dirname(project.location);
  const read = async (board) =>
    JSON.parse(await readFile(path.join(root, board.path), 'utf8'));
  await native('project:close', project.sessionId);
  if (!(await driver.native('automation:status')).enabled) {
    await driver.click('Menu');
    await driver.sync(
      `document.querySelector('[role=switch][aria-label="MCP Server"]').click()`,
    );
    await driver.until(
      async () => (await driver.native('automation:status')).enabled,
    );
    await driver.click('Menu');
  }
  const status = await driver.native('automation:status');
  const probe = client(driver.adapter, status.descriptor);
  await probe.initialize();
  let restored;
  try {
    await click('Menu');
    await dialogs('project-open', project.location);
    await click('Open Project…');
    await until(async () => (await probe.call('depthplan_get_state')).ok);
    const open = async (board) => {
      if (!(await sync('return !!document.querySelector("#project-drawer")')))
        await click('Toggle project boards');
      await click(`Open ${board.name}, ${board.path}`);
      await until(() =>
        sync(
          'return document.querySelector("[data-board-session][data-active=true]")?.id === arguments[0]',
          [`board-${board.id}`],
        ),
      );
    };
    let counter = 0;
    const edit = async (name) => {
      const state = await probe.call('depthplan_get_state');
      const result = await probe.call('depthplan_edit', {
        handle: state.data.handle,
        expectedRevision: state.data.revision,
        expectedViewRevision: state.data.viewRevision,
        requestId: `project-persist-${counter++}`,
        actions: [{ type: 'edit_object', id: 'api', name }],
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      return result;
    };
    const capture = async (name) => {
      for (const [width, height] of [
        [1440, 1000],
        [1024, 728],
        [900, 640],
      ]) {
        await driver.request(`/session/${driver.session}/window/rect`, {
          width,
          height,
        });
        await driver.js(
          'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
        );
        await writeFile(
          path.join(profile, `${name}-${width}.png`),
          Buffer.from(
            await driver.request(
              `/session/${driver.session}/screenshot`,
              undefined,
              'GET',
            ),
            'base64',
          ),
        );
      }
    };
    await edit('Autosaved A');
    await open(b);
    await edit('Autosaved B');
    await until(
      async () =>
        (await read(a)).objects.api.name === 'Autosaved A' &&
        (await read(b)).objects.api.name === 'Autosaved B',
    );
    const external = await read(a);
    external.objects.api.name = 'External A';
    await writeFile(path.join(root, a.path), JSON.stringify(external));
    await open(a);
    await edit('Local A');
    await until(() =>
      sync(
        'return document.body.textContent.includes("Resolve conflict for Board A")',
      ),
    );
    await click('Resolve conflict for Board A…');
    await capture('project-save-conflict');
    const copyPath = path.join(profile, 'conflict-copy.depthplan');
    await dialogs('save', copyPath);
    await click('Save a copy…');
    await until(async () => {
      try {
        return (
          JSON.parse(await readFile(copyPath, 'utf8')).objects.api.name ===
          'Local A'
        );
      } catch {
        return false;
      }
    });
    assert.notEqual(JSON.parse(await readFile(copyPath, 'utf8')).id, a.id);
    assert.equal((await read(a)).objects.api.name, 'External A');
    await click('Keep editing');
    await open(b);
    await edit('Healthy B');
    await until(async () => (await read(b)).objects.api.name === 'Healthy B');
    await click('Menu');
    await click('Close');
    await until(() =>
      sync(
        'return !!document.querySelector(".project-board-open:not(:disabled)")',
      ),
    );
    assert.equal(
      await sync(
        'return !!document.querySelector(".project-navigation") && !document.querySelector("dialog[open]")',
      ),
      true,
    );
    assert.equal((await read(a)).objects.api.name, 'External A');
    await capture('project-save-blocked-close');
    await click('Resolve conflict for Board A…');
    await dialogs('message', 'Keep editing');
    await click('Overwrite source…');
    await until(() =>
      sync(
        'return !Array.from(document.querySelectorAll("dialog button")).find(b=>b.textContent.includes("Overwrite source"))?.disabled',
      ),
    );
    assert.equal((await read(a)).objects.api.name, 'External A');
    await dialogs('message', 'Overwrite');
    await click('Overwrite source…');
    await until(async () => (await read(a)).objects.api.name === 'Local A');
    await until(() => sync('return !document.querySelector("dialog[open]")'));
    const manifest = JSON.parse(await readFile(project.location, 'utf8'));
    manifest.description = 'External manifest change';
    await writeFile(project.location, JSON.stringify(manifest));
    await sync(
      `document.querySelector('.project-title').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));`,
    );
    await until(() =>
      sync('return !!document.querySelector("[data-inline-edit]")'),
    );
    await sync(
      `const input=document.querySelector('[data-inline-edit]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Updated Project'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`,
    );
    await until(() =>
      sync(
        'return document.querySelector(".project-notice")?.textContent.includes("manifest changed")',
      ),
    );
    await click('Reload project definition…');
    await until(() =>
      sync('return !document.querySelector(".project-notice")'),
    );
    await sync(
      `document.querySelector('[data-inline-edit]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`,
    );
    await until(() =>
      sync('return !document.querySelector("[data-inline-edit]")'),
    );
    assert.equal(
      JSON.parse(await readFile(project.location, 'utf8')).name,
      'Updated Project',
    );
    assert.equal(
      JSON.parse(await readFile(project.location, 'utf8')).autosave,
      true,
    );
    // Recovery protects accepted work when an external writer prevents autosave.
    for (const board of [a, b]) {
      const file = path.join(root, board.path);
      await writeFile(file, (await readFile(file, 'utf8')) + '\n');
    }
    await open(a);
    const crashA = await edit('Recover A');
    await open(b);
    const crashB = await edit('Recover B');
    const instance = await native('app:instance-id');
    for (const [edited, board] of [
      [crashA, a],
      [crashB, b],
    ]) {
      const checkpoint = path.join(
        profile,
        'recovery',
        `${driver.app.pid}-${instance}`,
        `${edited.state.sessionId}.json`,
      );
      await until(async () => {
        try {
          return (
            JSON.parse(await readFile(checkpoint, 'utf8')).revision ===
            edited.state.revision
          );
        } catch {
          return false;
        }
      });
      const value = JSON.parse(await readFile(checkpoint, 'utf8'));
      assert.equal(value.project.id, project.manifest.id);
      assert.equal(value.project.boardId, board.id);
      assert.equal(value.project.location, project.location);
    }
    assert.equal((await read(a)).objects.api.name, 'Local A');
    assert.equal((await read(b)).objects.api.name, 'Healthy B');
    assert.deepEqual(await sync('return window.nativeErrors'), []);
    probe.close();
    driver.app.kill('SIGKILL');
    await driver.close();
    restored = await launchNative(profile);
    await restored.until(() =>
      restored.sync(
        'return document.querySelectorAll(`dialog[aria-label="Recover unsaved work"] section`).length===2',
      ),
    );
    assert.equal(
      await restored.sync(
        'return document.querySelector("dialog").textContent.includes("Updated Project")',
      ),
      true,
    );
    await restored.sync(
      'Array.from(document.querySelectorAll(`dialog section[aria-label="Board A"] button`)).find(b=>b.textContent==="Restore").click()',
    );
    await restored.until(() =>
      restored.sync('return !document.querySelector("dialog[open]")'),
    );
    assert.equal((await read(a)).objects.api.name, 'Local A');
    const restoredPath = path.join(profile, 'recovered-board-a.depthplan');
    await restored.native('test:dialogs', [
      { kind: 'message', value: 'Save As' },
      { kind: 'save', value: restoredPath },
    ]);
    await restored.click('Save document');
    await restored.until(async () => {
      try {
        return (
          JSON.parse(await readFile(restoredPath, 'utf8')).objects.api.name ===
          'Recover A'
        );
      } catch {
        return false;
      }
    });
    assert.equal((await read(a)).objects.api.name, 'Local A');
    const remaining = await restored.native('recovery:discover');
    assert.equal(remaining.entries.length, 1);
    assert.equal(remaining.entries[0].project.boardId, b.id);
    assert.deepEqual(await restored.sync('return window.nativeErrors'), []);
    return { project: project.location, evidence: profile };
  } finally {
    probe.close();
    await restored?.close();
  }
}
