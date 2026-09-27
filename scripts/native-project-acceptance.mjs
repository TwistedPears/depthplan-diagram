import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import client from './mcp/native-client.cjs';

export async function projectAcceptance(driver) {
  const { profile, click, sync, dialogs, native, until } = driver;
  const root = path.join(profile, 'Empty-Project');
  await mkdir(root);
  const file = path.join(root, 'Empty.depthproject');
  await writeFile(
    file,
    JSON.stringify({
      projectVersion: 1,
      id: 'empty-project',
      name: 'Empty project',
      description: '',
      homeBoardId: null,
      autosave: true,
      boards: [],
    }),
  );
  await dialogs('project-open', file);
  await click('Menu');
  await click('Open Project…');
  await until(() =>
    sync('return !!document.querySelector(".project-empty-identity")'),
  );
  await sync(`document.querySelector('[aria-label="Project menu"]').click()`);
  const enabled = await native('automation:status');
  if (!enabled.enabled) {
    await click('Settings');
    await sync(
      `document.querySelector('[role=menuitemcheckbox][aria-label="MCP Server"]').click()`,
    );
    await until(async () => (await native('automation:status')).enabled);
  }
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
        'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
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
  await click('Settings');
  await capture('project-empty-menu');
  await click('MCP Details');
  await until(() =>
    sync(
      `return !!document.querySelector('dialog[aria-label="MCP Details"][open]')`,
    ),
  );
  await capture('project-empty-mcp');
  await click('Close');
  assert.equal(
    await sync('return document.activeElement?.getAttribute("aria-label")'),
    'Project menu',
  );
  const probe = client(
    driver.adapter,
    (await native('automation:status')).descriptor,
  );
  try {
    await probe.initialize();
    const discovery = await probe.call('depthplan_get_project');
    assert.equal(discovery.ok, true, JSON.stringify(discovery));
    assert.deepEqual(discovery.data.project.boards, []);
    assert.equal(discovery.data.project.active, null);
    assert.equal((await probe.call('depthplan_get_access')).ok, true);
  } finally {
    probe.close();
  }
  await sync(`document.querySelector('[aria-label="Project menu"]').click()`);
  await click('Close All');
  await until(() =>
    sync('return !document.querySelector(".project-navigation")'),
  );
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    `PASS empty-project MCP controls and 1440/1024/900 layouts. Evidence: ${profile}`,
  );
}
