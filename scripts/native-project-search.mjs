import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import client from './mcp/native-client.cjs';

export async function projectSearch(driver) {
  const { profile, click, dialogs, native, sync, until } = driver;
  const root = path.join(profile, 'Search project');
  await mkdir(root);
  const sample = JSON.parse(
    await readFile('docs/sample/recursive_document.depthplan', 'utf8'),
  );
  sample.rootDepths.app = 0;
  sample.objects.handler.content = [
    { type: 'code', text: 'needle inside hidden code', language: 'sql' },
  ];
  const boards = ['a', 'b', 'c'].map((id) => ({
    id,
    name: id === 'a' ? 'Overview' : 'Same name',
    path: `${id}.depthplan`,
  }));
  const original = [];
  for (const board of boards) {
    const text = JSON.stringify({ ...sample, id: board.id });
    original.push(text);
    await writeFile(path.join(root, board.path), text);
  }
  const file = path.join(root, 'search.depthproject');
  await writeFile(
    file,
    JSON.stringify({
      projectVersion: 1,
      id: 'search-project',
      name: 'Search project',
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
  try {
    await probe.initialize();
    await dialogs('project-open', file);
    await click('Menu');
    await click('Open Project…');
    await until(() => sync('return !!document.getElementById("tab-a")'));
    const before = await probe.call('depthplan_get_state');
    await click('Menu');
    await click('Search Project…');
    assert.equal(await sync('return document.activeElement.type'), 'search');
    await sync(
      `const input=document.querySelector('dialog input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'needle'); input.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    await sync(`document.querySelector('dialog form').requestSubmit()`);
    await until(() =>
      sync(
        'return document.querySelector("dialog")?.textContent.includes("Search complete.")',
      ),
    );
    assert.equal(
      await sync(
        'return document.querySelectorAll(".project-search-results button").length',
      ),
      3,
    );
    assert.equal(
      await sync('return document.querySelectorAll("[role=tab]").length'),
      1,
    );
    assert.equal(
      await sync('return document.querySelectorAll(".konvajs-content").length'),
      1,
    );
    await click('Close');
    const after = await probe.call('depthplan_get_state');
    assert.deepEqual(
      after,
      before,
      'Search must not change accepted content, history or camera',
    );
    await click('Menu');
    await click('Search Project…');
    await sync(
      `const input=document.querySelector('dialog input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'needle'); input.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    await sync(`document.querySelector('dialog form').requestSubmit()`);
    await until(() =>
      sync(
        'return document.querySelector("dialog")?.textContent.includes("Search complete.")',
      ),
    );
    await until(() =>
      sync(
        'return [...document.querySelectorAll(".project-search-results button")].every(b=>!b.disabled)',
      ),
    );
    await driver.js(
      'Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))',
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
      await writeFile(
        path.join(profile, `project-search-${width}.png`),
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
    await sync(
      `document.querySelector('section[aria-label="Same name, b.depthplan"] button').focus()`,
    );
    // The embedded driver's synthetic key actions omit native button defaults.
    // Exercise the focused semantic button; physical keyboard certification is separate.
    assert.equal(await sync('return document.activeElement.tagName'), 'BUTTON');
    await sync('document.activeElement.click()');
    await until(() =>
      sync(
        'return document.getElementById("tab-b")?.getAttribute("aria-selected")==="true" && !document.querySelector("dialog[open]")',
      ),
    );
    const shown = await probe.call('depthplan_get_state');
    assert.notEqual(shown.data.handle.sessionId, before.data.handle.sessionId);
    assert(
      shown.data.canvas.selected.includes('object-handler'),
      JSON.stringify(shown),
    );
    assert.equal(await sync('return document.activeElement.id'), 'tab-b');
    assert.equal(
      (
        await probe.call('depthplan_history', {
          handle: shown.data.handle,
          expectedRevision: shown.data.revision,
          expectedViewRevision: shown.data.viewRevision,
          requestId: 'undo-search-reveal',
          direction: 'undo',
        })
      ).ok,
      true,
    );
    assert.equal((await probe.call('depthplan_get_state')).data.dirty, false);
    await click('Menu');
    await click('Close Project');
    await until(() =>
      sync('return !document.querySelector(".project-navigation")'),
    );
    for (let i = 0; i < boards.length; i++)
      assert.equal(
        await readFile(path.join(root, boards[i].path), 'utf8'),
        original[i],
      );
    assert.deepEqual(await sync('return window.nativeErrors'), []);
    console.log(
      `PASS project search: hidden unopened target, same names, focus/button activation, immutable search, one canvas. Evidence: ${profile}`,
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
