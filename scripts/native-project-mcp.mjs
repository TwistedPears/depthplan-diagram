import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import client from './mcp/native-client.cjs';

export async function projectMcp(driver) {
  const { native, dialogs, click, sync, until, profile } = driver;
  const sample = JSON.parse(
    await readFile('docs/sample/recursive_document.depthplan', 'utf8'),
  );
  sample.metadata.title = 'Same name';
  await dialogs('folder', profile);
  let project = (
    await native('project:create', 'MCP Project', 'MCP-Project', sample)
  ).project;
  project = (
    await native('project:apply', project.sessionId, project.fingerprint, {
      kind: 'duplicateBoard',
      boardId: project.manifest.boards[0].id,
      name: 'Same name',
      path: 'Board-B.depthplan',
    })
  ).project;
  const [a, b] = project.manifest.boards;
  const root = path.dirname(project.location);
  const read = async (board) =>
    JSON.parse(await readFile(path.join(root, board.path), 'utf8'));
  const originalB = await readFile(path.join(root, b.path));
  await native('project:close', project.sessionId);
  // This journey exercises explicit MCP saves, controlled by the app setting.
  await click('Menu');
  await click('Settings');
  const autosave = await sync(
    `const button=document.querySelector('[aria-label="Autosave"]'), enabled=button.getAttribute('aria-checked')==='true'; if(enabled) button.click(); return enabled;`,
  );
  if (!(await native('automation:status')).enabled) {
    await sync(
      `document.querySelector('[role=menuitemcheckbox][aria-label="MCP Server"]').click()`,
    );
    await until(async () => (await native('automation:status')).enabled);
  }
  await click('Menu');
  const probe = client(
    driver.adapter,
    (await native('automation:status')).descriptor,
  );
  await probe.initialize();
  try {
    await click('Menu');
    await dialogs('project-open', project.location);
    await click('Open Project…');
    await until(
      async () =>
        (await probe.call('depthplan_get_project')).data?.project?.id ===
        project.manifest.id,
    );
    const discovery = (await probe.call('depthplan_get_project')).data.project;
    assert.deepEqual(
      discovery.boards.map((x) => x.name),
      ['Same name', 'Same name'],
    );
    assert.notEqual(discovery.boards[0].id, discovery.boards[1].id);
    const handleA = discovery.boards[0].handle;
    let sequence = 0;
    const state = async (handle = handleA) => {
      const result = await probe.call('depthplan_get_state', { handle });
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.data;
    };
    const args = async (handle = handleA) => {
      const s = await state(handle);
      return {
        handle,
        expectedRevision: s.revision,
        expectedViewRevision: s.viewRevision,
        requestId: `project-mcp-${sequence++}`,
      };
    };
    const activate = async (boardId) => {
      await sync('document.getElementById(arguments[0]).click()', [
        `board-link-${boardId}`,
      ]);
      await until(() =>
        sync(
          'return document.querySelector("[data-board-session][data-active=true]:not(:has(> [inert]))")?.id === arguments[0]',
          [`board-${boardId}`],
        ),
      );
    };
    const openB = {
      handle: discovery.handle,
      boardId: b.id,
      requestId: 'open-b',
    };
    for (const grant of await native('mcp:folders'))
      await native('mcp:revoke-folder', grant.id);
    assert.equal((await probe.call('depthplan_open_board', openB)).ok, false);
    assert.equal(
      (await probe.call('depthplan_get_project')).data.project.boards[1].handle,
      null,
    );
    await dialogs('folder', profile);
    await native('mcp:approve-folder');
    const opened = await probe.call('depthplan_open_board', openB);
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const handleB = opened.data.handle;
    const editInput = {
      ...(await args()),
      actions: [{ type: 'edit_object', id: 'api', name: 'MCP A only' }],
    };
    assert.equal((await probe.call('depthplan_edit', editInput)).ok, true);
    assert.equal((await state(handleB)).dirty, false);
    assert.equal(
      (await probe.call('depthplan_edit', editInput)).data.replayed,
      true,
    );
    assert.deepEqual(await readFile(path.join(root, b.path)), originalB);
    const external = await read(a);
    external.objects.api.name = 'External A';
    await writeFile(path.join(root, a.path), JSON.stringify(external));
    if (!(await sync('return !!document.querySelector("#project-drawer")')))
      await click('Toggle project boards');
    await activate(a.id);
    const saveInput = { ...(await args()), action: { type: 'save' } };
    const started = await probe.call('depthplan_files', saveInput);
    assert.equal(started.ok, true, JSON.stringify(started));
    const operationId = started.data.operationId;
    const receipt = async (id = operationId) => {
      const result = await probe.call('depthplan_get_operation', {
        appInstanceId: handleA.appInstanceId,
        operationId: id,
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.data;
    };
    await until(async () => (await receipt()).status === 'needs-decision');
    await activate(b.id);
    const pending = await receipt();
    assert.equal(pending.target.sessionId, handleA.sessionId);
    assert.equal(
      (await probe.call('depthplan_files', saveInput)).data.operationId,
      operationId,
    );
    assert.equal((await read(a)).objects.api.name, 'External A');
    const decided = await probe.call('depthplan_decide', {
      ...(await args()),
      operationId,
      decisionId: pending.decision.id,
      choice: 'overwrite',
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    await until(
      async () =>
        !['running', 'needs-decision'].includes((await receipt()).status),
    );
    assert.equal(
      (await receipt()).status,
      'completed',
      JSON.stringify(await receipt()),
    );
    assert.equal((await read(a)).objects.api.name, 'MCP A only');
    assert.deepEqual(await readFile(path.join(root, b.path)), originalB);
    const exportPath = path.join(profile, 'export.json');
    const exported = await probe.call('depthplan_export', {
      ...(await args()),
      path: exportPath,
      format: 'json',
    });
    assert.equal(exported.ok, true, JSON.stringify(exported));
    await until(
      async () =>
        !['running', 'needs-decision'].includes(
          (await receipt(exported.data.operationId)).status,
        ),
    );
    assert.equal(
      (await receipt(exported.data.operationId)).status,
      'completed',
      JSON.stringify(await receipt(exported.data.operationId)),
    );
    assert.equal(JSON.parse(await readFile(exportPath, 'utf8')).id, a.id);
    const image = await probe.call('depthplan_export', {
      ...(await args()),
      path: path.join(profile, 'hidden.svg'),
      format: 'svg',
    });
    assert.equal(image.error.code, 'BUSY');
    await driver.boardAction(b.id, 'Close board');
    // Closing and reopening invalidates only B's handle.
    await until(
      async () =>
        (await probe.call('depthplan_get_state', { handle: handleB })).error
          ?.code === 'STALE_SESSION',
    );
    assert.equal(
      (await probe.call('depthplan_get_state', { handle: handleB })).error.code,
      'STALE_SESSION',
    );
    const reopened = await probe.call('depthplan_open_board', {
      ...openB,
      requestId: 'reopen-b',
    });
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    assert.notEqual(reopened.data.handle.sessionId, handleB.sessionId);
    assert.equal((await receipt()).status, 'completed');
    assert.equal(
      (await probe.call('depthplan_edit', editInput)).data.replayed,
      true,
    );
    const edit2 = {
      ...(await args()),
      actions: [{ type: 'edit_object', id: 'api', name: 'Revoked A' }],
    };
    assert.equal((await probe.call('depthplan_edit', edit2)).ok, true);
    const beforeRevoke = await readFile(path.join(root, a.path));
    const denied = await probe.call('depthplan_files', {
      ...(await args()),
      action: { type: 'save' },
    });
    const grant = (await native('mcp:folders'))[0];
    await native('mcp:revoke-folder', grant.id);
    await until(
      async () =>
        !['running', 'needs-decision'].includes(
          (await receipt(denied.data.operationId)).status,
        ),
    );
    // Revocation can race a completed atomic write; a subsequent revoked save must fail without a write.
    const afterRace = await readFile(path.join(root, a.path));
    assert.ok(
      afterRace.equals(beforeRevoke) ||
        JSON.parse(afterRace).objects.api.name === 'Revoked A',
    );
    const rejected = await probe.call('depthplan_files', {
      ...(await args()),
      action: { type: 'save' },
    });
    assert.equal(rejected.ok, true, JSON.stringify(rejected));
    await until(
      async () =>
        (await receipt(rejected.data.operationId)).status === 'failed',
    );
    assert.deepEqual(await readFile(path.join(root, a.path)), afterRace);
    assert.deepEqual(await readFile(path.join(root, b.path)), originalB);
    await dialogs('folder', profile);
    await native('mcp:approve-folder');
    const finalSave = await probe.call('depthplan_files', {
      ...(await args()),
      action: { type: 'save' },
    });
    assert.equal(finalSave.ok, true, JSON.stringify(finalSave));
    await until(
      async () =>
        (await receipt(finalSave.data.operationId)).status === 'completed',
    );
    await click('Menu');
    await click('Close All');
    await until(
      async () =>
        (await probe.call('depthplan_get_project')).data?.project === null,
    );
    assert.equal((await probe.call('depthplan_get_state')).ok, true);
    assert.equal((await receipt()).status, 'completed');
    if (autosave) {
      await click('Menu');
      await click('Settings');
      await click('Autosave');
      await click('Menu');
    }
    console.log(
      `PASS project MCP: explicit same-name targets, grants, delayed overwrite after tab switch, export, stale handles, receipts and retries. Evidence: ${profile}`,
    );
  } finally {
    probe.close();
  }
}
