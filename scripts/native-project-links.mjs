import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import client from './mcp/native-client.cjs';

export async function projectLinks(driver) {
  const { profile, click, native, sync, until } = driver;
  const root = path.join(profile, 'Linked project');
  await mkdir(root);
  const sample = JSON.parse(
    await readFile('docs/sample/recursive_document.depthplan', 'utf8'),
  );
  sample.rootDepths.app = 0;
  sample.namedViews = {
    detail: {
      id: 'detail',
      name: 'Implementation',
      rootDepths: { ...sample.rootDepths, app: 3 },
      camera: { x: -250, y: 60, scale: 1.4 },
    },
  };
  const boards = [
    { id: 'a', name: 'Overview', path: 'a.depthplan' },
    { id: 'b', name: 'Detail', path: 'b.depthplan' },
  ];
  for (const board of boards)
    await writeFile(
      path.join(root, board.path),
      JSON.stringify({ ...sample, id: board.id }),
    );
  const file = path.join(root, 'links.depthproject');
  await writeFile(
    file,
    JSON.stringify({
      projectVersion: 1,
      id: 'linked-project',
      name: 'Linked project',
      description: '',
      homeBoardId: 'a',
      autosave: false,
      boards,
    }),
  );
  if (!(await native('automation:status')).enabled) {
    await click('Menu');
    await sync(
      `document.querySelector('[role=switch][aria-label="MCP Server"]').click()`,
    );
    await until(async () => (await native('automation:status')).enabled);
    await click('Menu');
  }
  const probe = client(
    driver.adapter,
    (await native('automation:status')).descriptor,
  );
  let sequence = 0;
  const state = async () => {
    const reply = await probe.call('depthplan_get_state');
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply.data;
  };
  const command = async (tool, args) => {
    const current = await state();
    const reply = await probe.call(tool, {
      handle: current.handle,
      expectedRevision: current.revision,
      expectedViewRevision: current.viewRevision,
      requestId: `links-${sequence++}`,
      ...args,
    });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply.data;
  };
  const active = (id) =>
    until(() =>
      sync(
        `return document.getElementById('board-${id}')?.getAttribute('data-active') === 'true'`,
      ),
    );
  const select = () =>
    command('depthplan_selection', { action: 'set', objects: ['app'] });
  const save = async () => {
    await click('Menu');
    await click('Save All');
    await until(async () => {
      const reply = await probe.call('depthplan_get_state');
      return reply.ok && !reply.data.dirty;
    });
  };
  const close = async () => {
    await click('Menu');
    await click('Close Project');
    await until(() =>
      sync('return !document.querySelector(".project-navigation")'),
    );
  };
  const back = async () => {
    await click('Menu');
    await click('Back to previous board');
    await active('a');
    await until(() => sync('return document.activeElement.id === "board-a"'));
  };
  const capture = async (name) => {
    await until(() =>
      sync(
        'return document.getAnimations().every(a=>a.playState!=="running" || a.effect.getTiming().iterations===Infinity)',
      ),
    );
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
        'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
      );
      if (name === 'project-link-destination') {
        assert.equal(
          await sync(
            'return !!document.querySelector("[role=tab], .select-visible-control")',
          ),
          false,
        );
        assert.equal(
          await sync(
            `const toggle=document.querySelector('.project-drawer-toggle'); const rect=toggle.getBoundingClientRect(); return Math.abs(rect.right-innerWidth)<1 && rect.height>rect.width && getComputedStyle(toggle).writingMode==='vertical-rl'`,
          ),
          true,
        );
      }
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
  try {
    await probe.initialize();
    await native('test:open-files', [file]);
    await active('a');
    await select();
    await command('depthplan_camera', {
      action: { type: 'set', camera: { x: 120, y: -25, scale: 0.75 } },
    });
    await click('Add project link');
    assert.equal(
      await sync('return document.activeElement.getAttribute("aria-label")'),
      'Target board',
    );
    await sync(
      `const input=document.querySelector('select[aria-label="Target board"]'); input.value='b'; input.dispatchEvent(new Event('change',{bubbles:true}));`,
    );
    await until(() =>
      sync(
        `return !!document.querySelector('select[aria-label="Target bookmark"] option[value="detail"]')`,
      ),
    );
    await sync(
      `const input=document.querySelector('select[aria-label="Target bookmark"]'); input.value='detail'; input.dispatchEvent(new Event('change',{bubbles:true}));`,
    );
    await until(() =>
      sync(
        'return !document.querySelector("dialog button[type=submit]").disabled',
      ),
    );
    assert.equal(
      await sync(
        'return document.querySelectorAll("[data-board-session]").length',
      ),
      1,
    );
    assert.equal(
      await sync('return document.querySelectorAll(".konvajs-content").length'),
      1,
    );
    await capture('project-link-picker');
    await click('Save link');
    await until(() => sync('return !document.querySelector("dialog[open]")'));
    await until(() =>
      sync(
        'return document.activeElement.getAttribute("aria-label") === "Change project link"',
      ),
    );
    await save();
    const reference = {
      projectId: 'linked-project',
      boardId: 'b',
      bookmarkId: 'detail',
    };
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, 'a.depthplan'), 'utf8')).objects
        .app.projectLink,
      reference,
    );
    const origin = await state();
    await click('Open project link');
    await active('b');
    await until(() => sync('return document.activeElement.id === "board-b"'));
    const destination = await state();
    assert.deepEqual(destination.camera, sample.namedViews.detail.camera);
    assert.notEqual(destination.handle.sessionId, origin.handle.sessionId);
    assert.equal(
      await sync('return document.querySelectorAll(".konvajs-content").length'),
      1,
    );
    await click('Menu');
    await capture('project-link-destination');
    await click('Menu');
    await back();
    assert.deepEqual((await state()).camera, origin.camera);
    assert.deepEqual((await state()).canvas.selected, origin.canvas.selected);
    await save();
    await close();

    const copied = path.join(profile, 'Copied linked project');
    await cp(root, copied, { recursive: true });
    await rename(root, `${root} moved`);
    await native('test:open-files', [path.join(copied, 'links.depthproject')]);
    await active('a');
    await select();
    await click('Open project link');
    await active('b');
    assert.equal(
      await realpath((await state()).source.path),
      await realpath(path.join(copied, 'b.depthplan')),
    );
    await back();
    await save();
    await close();
    await native('test:open-files', [path.join(copied, 'a.depthplan')]);
    await until(async () => {
      const reply = await probe.call('depthplan_get_state');
      return (
        reply.ok &&
        reply.data.source?.path &&
        (await realpath(reply.data.source.path)) ===
          (await realpath(path.join(copied, 'a.depthplan')))
      );
    });
    await select();
    assert.equal(
      await sync(
        `return document.querySelector('button[aria-label="Open project link"]').disabled`,
      ),
      true,
    );
    await click('Change project link');
    assert.equal(
      await sync(
        'return document.querySelector("dialog button[type=submit]").disabled',
      ),
      true,
    );
    assert.match(
      await sync('return document.querySelector("dialog").textContent'),
      /open standalone/,
    );
    await capture('project-link-standalone');
    await click('Cancel');
    assert.equal((await state()).dirty, false);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(copied, 'a.depthplan'), 'utf8'))
        .objects.app.projectLink,
      reference,
    );
    assert.deepEqual(await sync('return window.nativeErrors'), []);
    console.log(
      `PASS project links: picker, bookmark, back camera/selection/focus, copied-folder isolation, standalone unresolved. Evidence: ${profile}`,
    );
  } catch (error) {
    console.log(
      await sync(
        'return {active:document.activeElement?.outerHTML.slice(0,500), dialog:document.querySelector("dialog[open]")?.textContent, errors:window.nativeErrors}',
      ),
    );
    throw error;
  } finally {
    probe.close();
  }
}
