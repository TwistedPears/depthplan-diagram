import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// One continuous journey in the same native editor and stdio client as smoke.
export async function authoring(driver, probe) {
  const { click, dialogs, sync, until, profile } = driver;
  const state = async () => {
    const reply = await probe.call('depthplan_get_state');
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply.data;
  };
  const command = async (name, args) => {
    const current = await state();
    const reply = await probe.call(name, {
      handle: current.handle,
      expectedRevision: current.revision,
      expectedViewRevision: current.viewRevision,
      requestId: crypto.randomUUID(),
      ...args,
    });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply;
  };
  const edit = (...actions) => command('depthplan_edit', { actions });
  const bookmark = (type, extra = {}) =>
    command('depthplan_bookmarks', {
      action: { type, id: 'overview', ...extra },
    });
  const history = (direction) => command('depthplan_history', { direction });
  const target = path.join(profile, 'authored.depthplan.json');
  const save = async () => {
    if (!(await state()).source) await dialogs('save', target);
    await click('Save document');
    await until(async () => !(await state()).dirty && !!(await state()).source);
    return JSON.parse(await readFile(target, 'utf8'));
  };
  const contentOf = (document) => ({
    ...document,
    metadata: { ...document.metadata, modified: null },
  });
  const bookmarkOrder = () =>
    sync(
      `return [...document.querySelectorAll('.bookmark-item')].map(button=>button.dataset.bookmarkId)`,
    );

  for (const [name, view, route] of [
    ['depthplan_application_tour', 'implementation', 'dispatch-to-guard'],
    ['workflow_document', 'details', 'service-bridge'],
  ]) {
    const data = await readFile(`docs/sample/${name}.depthplan`, 'utf8');
    const sample = JSON.parse(data),
      file = path.join(profile, `${name}.depthplan`);
    await writeFile(file, data);
    await dialogs('open', file);
    await click('Menu');
    await click('Open');
    await until(async () => (await state()).source?.path === file);
    assert.deepEqual(await bookmarkOrder(), Object.keys(sample.namedViews));
    await sync(`document.querySelector('.recursive-bookmarks').open=true`);
    await click(sample.namedViews[view].name);
    await driver.js(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    assert.equal(
      await sync(
        `const stage=window.Konva.stages[0];
      return stage.find('.boundary-point').length===0 &&
        stage.findOne('#connection-'+arguments[0]).findOne('.connection-path').points().length>=4;`,
        [route],
      ),
      true,
      'sample keeps its parent-to-child route without legacy boundary dots',
    );
    await click('Save document');
    await until(async () => !(await state()).dirty);
    assert.deepEqual(
      Object.keys(JSON.parse(await readFile(file, 'utf8')).namedViews),
      Object.keys(sample.namedViews),
    );
    await sync(`document.querySelector('.recursive-bookmarks').open=true`);
    const screenshot = await driver.request(
      `/session/${driver.session}/screenshot`,
      undefined,
      'GET',
    );
    await writeFile(
      path.join(profile, `${name}-bookmarks.png`),
      Buffer.from(screenshot, 'base64'),
    );
    await sync(`document.querySelector('.recursive-bookmarks').open=false`);
  }

  await click('Menu');
  await click('New');
  await until(async () => !(await state()).source);
  const fresh = await state();
  await edit(
    ...[
      ['system', null, 350, 350, 500, 400],
      ['peer', null, 1000, 350, 250, 200],
      ['api', 'system', 280, 320, 120, 90],
      ['store', 'system', 430, 420, 120, 90],
    ].map(([id, parentId, x, y, width, height]) => ({
      type: 'create_object',
      id,
      parentId,
      shape: 'rectangle',
      name: id,
      geometry: { x, y, width, height },
    })),
    {
      type: 'edit_object',
      id: 'api',
      style: { fill: '#dbeafe' },
      content: [
        {
          type: 'paragraph',
          runs: [{ text: 'API contract', marks: { bold: true } }],
        },
        {
          type: 'code',
          text: 'return 200;',
          language: 'javascript',
          wrap: true,
        },
      ],
    },
    { type: 'arrange', ids: ['api', 'store'], action: 'align-top' },
    {
      type: 'create_connection',
      id: 'external',
      kind: 'arrow',
      start: { x: 875, y: 350 },
      end: { x: 340, y: 320 },
      startTarget: 'peer',
      endTarget: 'api',
    },
    {
      type: 'create_connection',
      id: 'internal',
      kind: 'arrow',
      start: { x: 340, y: 320 },
      end: { x: 370, y: 320 },
      startTarget: 'api',
      endTarget: 'store',
    },
  );
  // Names and IDs deliberately differ from creation order.
  await bookmark('create', { id: 'z-first', name: 'Zulu' });
  await bookmark('create', { name: 'Overview' });
  await bookmark('create', { id: 'a-last', name: 'Alpha' });
  const expectedOrder = ['z-first', 'overview', 'a-last'];
  assert.deepEqual(await bookmarkOrder(), expectedOrder);
  const authored = await save();
  assert.deepEqual(Object.keys(authored.namedViews), expectedOrder);
  assert.equal(Object.keys(authored.objects).length, 4);
  assert.equal(authored.objects.api.parentId, 'system');
  assert.equal(authored.objects.api.content[1].text, 'return 200;');
  assert.equal(Object.keys(authored.connections).length, 2);
  assert(
    Object.values(authored.objects).every((object) => !object.boundaryPoints),
  );
  for (const [id, ownerId, start, end] of [
    ['external', null, 'peer', 'api'],
    ['internal', 'system', 'api', 'store'],
  ]) {
    const connection = authored.connections[id];
    assert.equal(connection.ownerId, ownerId);
    assert.equal(connection.start.kind, 'object');
    assert.equal(connection.start.objectId, start);
    assert.equal(connection.end.kind, 'object');
    assert.equal(connection.end.objectId, end);
  }
  assert.equal(authored.rootDepths.system, 1);
  assert.equal(authored.rootDepths.peer, 0);
  assert.equal(
    authored.layouts.system[1].api.y,
    authored.layouts.system[1].store.y,
  );

  // The creation defaults must match a selected Style preset before any edits.
  for (const [id, kind] of [
    ['api', 'object'],
    ['external', 'connection'],
  ]) {
    await command('depthplan_selection', {
      action: 'set',
      objects: kind === 'object' ? [id] : [],
      connections: kind === 'connection' ? [id] : [],
    });
    assert.deepEqual(
      await sync(
        `const [id,kind]=arguments;
      const item=window.Konva.stages[0].findOne('#'+kind+'-'+id);
      const shape=item.findOne(kind==='object'?'.object-hit-area':'.connection-path');
      const group=document.querySelector('[aria-label="Thin stroke"]').closest('fieldset');
      return {width:shape.strokeWidth(), selected:[...group.querySelectorAll('[aria-pressed="true"]')].map(b=>b.getAttribute('aria-label'))};`,
        [id, kind],
      ),
      { width: 2, selected: ['Thin stroke'] },
    );
    const revision = (await state()).revision;
    await click('Thin stroke');
    assert.equal(
      (await state()).revision,
      revision,
      'selected Thin preserves the creation width',
    );
  }
  await edit({ type: 'edit_object', id: 'api', style: { strokeWidth: 1.5 } });
  await command('depthplan_selection', {
    action: 'set',
    objects: ['api'],
    connections: [],
  });
  assert.equal(
    await sync(
      `return document.querySelector('[aria-label="Thin stroke"]').getAttribute('aria-pressed');`,
    ),
    'true',
  );
  assert.equal(
    (await save()).objects.api.style.strokeWidth,
    1.5,
    'recognizing legacy Thin does not rewrite it',
  );
  await click('Undo');

  // UI history and camera actions interleave with MCP edits in this same session.
  await edit({ type: 'move', ids: ['system'], delta: { x: 30, y: 20 } });
  await click('Undo');
  assert.deepEqual(contentOf(await save()), contentOf(authored));
  await click('Redo');
  const moved = await save();
  assert.equal(
    moved.layouts.system[1].system.x,
    authored.layouts.system[1].system.x + 30,
  );
  await bookmark('apply');
  const appliedBookmark = await save();
  // Applying a bookmark seeds disclosure memory; every authored field still restores.
  assert.deepEqual(
    contentOf(appliedBookmark),
    contentOf({
      ...authored,
      extensions: {
        ...authored.extensions,
        expansionLayouts: appliedBookmark.extensions.expansionLayouts,
      },
    }),
  );
  await history('undo');
  assert.deepEqual(contentOf(await save()), contentOf(moved));
  await history('redo');
  await bookmark('rename', { name: 'Architecture' });
  await bookmark('reset');
  const updated = await save();
  await edit({ type: 'reparent', id: 'store', parentId: null });
  assert.equal((await save()).objects.store.parentId, null);
  await history('undo');
  assert.deepEqual(contentOf(await save()), contentOf(updated));
  await edit({ type: 'children', id: 'system', expanded: false });
  await edit({ type: 'children', id: 'system', expanded: true });
  const revealed = await save();
  for (const key of ['objects', 'connections', 'layouts', 'namedViews'])
    assert.deepEqual(revealed[key], updated[key]);
  await bookmark('delete');
  assert.equal((await save()).namedViews?.overview, undefined);
  await history('undo');
  const beforeOpen = await save();
  assert.deepEqual(
    await bookmarkOrder(),
    expectedOrder,
    'rename/reset/delete/Undo preserve bookmark order',
  );
  assert.deepEqual(Object.keys(beforeOpen.namedViews), expectedOrder);
  const previous = await state();
  await click('Menu');
  await click('New');
  await until(
    async () => (await state()).handle.sessionId !== previous.handle.sessionId,
  );
  await dialogs('open', target);
  await click('Menu');
  await click('Open');
  await until(async () => (await state()).source?.path === target);
  assert.equal((await state()).canUndo, false);
  assert.deepEqual(
    await bookmarkOrder(),
    expectedOrder,
    'reopening preserves creation order',
  );
  // Save from the reopened renderer, not just a second read of the original file.
  await edit({ type: 'move', ids: ['peer'], delta: { x: 1, y: 0 } });
  await history('undo');
  assert.deepEqual(contentOf(await save()), contentOf(beforeOpen));
  await bookmark('apply');
  const reopened = await save();
  assert.deepEqual(reopened.objects, beforeOpen.objects);
  assert.deepEqual(reopened.connections, beforeOpen.connections);

  const rejected = await probe.call('depthplan_edit', {
    handle: fresh.handle,
    expectedRevision: fresh.revision,
    expectedViewRevision: fresh.viewRevision,
    requestId: 'replaced-session',
    actions: [{ type: 'delete', objects: ['system'] }],
  });
  assert.equal(rejected.error.code, 'STALE_SESSION');
  assert.deepEqual(contentOf(await save()), contentOf(reopened));
  await command('depthplan_selection', { action: 'set', objects: ['system'] });
  await dialogs('folder', profile);
  await driver.native('mcp:approve-folder');
  for (const scope of ['whole', 'selection']) {
    for (const format of ['svg', 'png']) {
      const file = path.join(profile, `authored-${scope}.${format}`);
      const started = await command('depthplan_export', {
        path: file,
        scope,
        format,
      });
      let receipt;
      await until(async () => {
        receipt = await probe.call('depthplan_get_operation', {
          appInstanceId: (await state()).handle.appInstanceId,
          operationId: started.data.operationId,
        });
        assert.equal(receipt.ok, true, JSON.stringify(receipt));
        return receipt.data.status !== 'running';
      });
      assert.equal(receipt.data.status, 'completed', JSON.stringify(receipt));
      const bytes = await readFile(file);
      assert(bytes.length > 100);
      if (format === 'png')
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      else assert.match(bytes.toString(), /<svg/);
    }
  }
  // A canceled Quit must keep this exact session; a clean Quit exits normally.
  await edit({ type: 'edit_object', id: 'peer', name: 'Retain on cancel' });
  const dirty = await state();
  await dialogs('message', 'Cancel');
  await driver.native('test:quit');
  await until(async () => !(await state()).busyReasons.length);
  assert.deepEqual(await state(), dirty);
  await save();
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  probe.close();
  await sync(
    'setTimeout(()=>window.__TAURI_INTERNALS__.invoke("desktop",{method:"test:quit",args:[]}),100)',
  );
  await until(() => driver.app.exitCode !== null);
  assert.equal(driver.app.exitCode, 0);
}
