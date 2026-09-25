import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import client from './mcp/native-client.cjs';
import { launchNative } from './native-driver.mjs';

// Exercises reviewed example plans, not an automatic architecture inference engine.
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const fileHash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const paragraph = (text) => ({ type: 'paragraph', runs: [{ text }] });
const jsonBlock = (value) => ({
  type: 'code',
  language: 'json',
  text: JSON.stringify(value, null, 2),
});
const driver = await launchNative();
let probe;
try {
  await driver.click('Menu');
  await driver.sync(
    'document.querySelector(`[role=switch][aria-label="MCP Server"]`).click()',
  );
  await driver.until(() =>
    driver.sync(
      'return document.querySelector(`[role=switch][aria-label="MCP Server"]`).getAttribute("aria-checked") === "true"',
    ),
  );
  const status = await driver.native('automation:status');
  await driver.dialogs('folder', driver.profile);
  await driver.native('mcp:approve-folder');
  await driver.click('Menu');
  probe = client(driver.adapter, status.descriptor);
  await probe.initialize();
  const call = async (name, args = {}) => {
    const reply = await probe.call(name, args);
    assert(reply.ok, `${name}: ${JSON.stringify(reply)}`);
    return reply.data;
  };
  const state = () => call('depthplan_get_state');
  const command = async (name, extra) => {
    const s = await state();
    const args = {
      handle: s.handle,
      expectedRevision: s.revision,
      expectedViewRevision: s.viewRevision,
      requestId: randomUUID(),
      ...extra,
    };
    assert(Buffer.byteLength(JSON.stringify(args)) < 48 * 1024);
    return call(name, args);
  };
  const edit = (actions) => command('depthplan_edit', { actions });
  const query = async (collection, extra = {}) =>
    call('depthplan_query', {
      handle: (await state()).handle,
      collection,
      ...extra,
    });
  const objects = async () => (await query('objects', { pageSize: 200 })).items;
  const file = async (action) => {
    const { operationId } = await command('depthplan_files', { action });
    const { handle } = await state();
    let receipt;
    await driver.until(async () => {
      receipt = await call('depthplan_get_operation', {
        appInstanceId: handle.appInstanceId,
        operationId,
      });
      assert(
        !['failed', 'canceled', 'needs-decision'].includes(receipt.status),
        JSON.stringify(receipt),
      );
      return receipt.status === 'completed';
    });
    return receipt;
  };
  const bookmark = (type, id, name) =>
    command('depthplan_bookmarks', {
      action: { type, id, ...(name ? { name } : {}) },
    });
  const frame = async (ids) => {
    const s = await state();
    const items = (await query('objects', { ids })).items;
    const boxes = items.map(({ visible, worldGeometry: g }) => {
      assert(visible && g);
      return {
        left: g.x - g.width / 2,
        right: g.x + g.width / 2,
        top: g.y - g.height / 2,
        bottom: g.y + g.height / 2,
      };
    });
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.right));
    const top = Math.min(...boxes.map((b) => b.top));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    const { width, height } = s.canvas.viewport;
    const scale = Math.min(
      1,
      (width - 100) / (right - left),
      (height - 100) / (bottom - top),
    );
    await command('depthplan_camera', {
      action: {
        type: 'set',
        camera: {
          scale,
          x: width / 2 - ((left + right) / 2) * scale,
          y: height / 2 - ((top + bottom) / 2) * scale,
        },
      },
    });
  };
  const checkView = async (view) => {
    await bookmark('apply', view.id);
    const s = await state();
    for (const { visible, worldGeometry: g } of (
      await query('objects', { ids: view.targets })
    ).items) {
      assert(visible && g, view.id);
      const { x, y, scale } = s.camera;
      assert((g.x - g.width / 2) * scale + x >= -1, view.id);
      assert((g.y - g.height / 2) * scale + y >= -1, view.id);
      assert(
        (g.x + g.width / 2) * scale + x <= s.canvas.viewport.width + 1,
        view.id,
      );
      assert(
        (g.y + g.height / 2) * scale + y <= s.canvas.viewport.height + 1,
        view.id,
      );
    }
  };

  for (const example of ['rails', 'no-db']) {
    const plan = JSON.parse(
      await readFile(`skills/examples/${example}/map-plan.json`, 'utf8'),
    );
    const sourceHashes = new Map();
    const target = path.join(driver.profile, `${example}.depthplan`);
    await file({ type: 'new' });
    const positions = new Map();
    const actions = [];
    for (const [index, node] of plan.nodes.entries()) {
      assert(!positions.has(node.id));
      if (node.parentId)
        assert(positions.has(node.parentId), 'Parents must precede children');
      const geometry = {
        x: (index % 6) * 360,
        y: Math.floor(index / 6) * 260,
        width: 300,
        height: 190,
        rotation: 0,
        z: index,
      };
      positions.set(node.id, geometry);
      const sources = [];
      for (const source of node.sources) {
        const sourcePath = path.join(plan.sourceRoot, source.path);
        const sha256 = await fileHash(sourcePath);
        sourceHashes.set(sourcePath, sha256);
        sources.push({ ...source, sha256, worktree: 'static-fixture' });
      }
      const relationships = plan.connections
        .filter((edge) => edge.source === node.id)
        .map((edge) => ({
          ...edge,
          connectionId: edge.id,
          targetKey: `${plan.repository}:${edge.target}`,
        }));
      for (const edge of relationships)
        for (const source of edge.evidence) {
          const sourcePath = path.join(plan.sourceRoot, source);
          sourceHashes.set(sourcePath, await fileHash(sourcePath));
        }
      actions.push({
        type: 'create_object',
        id: node.id,
        shape: 'rectangle',
        parentId: node.parentId,
        name: node.name,
        geometry,
      });
      actions.push({
        type: 'edit_object',
        id: node.id,
        content: [
          paragraph(node.summary),
          jsonBlock({
            convention: 'depthplan-source/v1',
            key: `${plan.repository}:${node.id}`,
            repository: plan.repository,
            revision: plan.revision,
            framework: plan.framework,
            status: node.status,
            sources,
            terms: node.terms,
            relationships,
          }),
        ],
      });
    }
    const parents = new Map(plan.nodes.map((node) => [node.id, node.parentId]));
    const ancestors = (id) => {
      const values = [];
      for (
        let parent = parents.get(id);
        parent !== undefined;
        parent = parents.get(parent)
      )
        values.push(parent);
      return values;
    };
    const segments = [];
    actions.push(
      ...plan.nodes
        .filter((node) => !node.parentId)
        .map((node) => ({ type: 'depth', rootId: node.id, depth: 'all' })),
    );
    for (const edge of plan.connections) {
      const common = ancestors(edge.source).find((id) =>
        ancestors(edge.target).includes(id),
      );
      const lift = (id, side) => {
        let target = id,
          child = id;
        for (
          let parent = parents.get(id);
          parent !== common;
          parent = parents.get(parent)
        ) {
          const pointId = `${edge.id}-${side}-${parent}`;
          actions.push({
            type: 'boundary',
            objectId: parent,
            pointId,
            action: 'create',
            point: { side: side === 'source' ? 'right' : 'left', offset: 0.5 },
          });
          actions.push({
            type: 'bridge',
            id: pointId,
            kind: 'line',
            source: { objectId: parent, pointId },
            target,
            point: { x: positions.get(child).x, y: positions.get(child).y },
          });
          const label = `${edge.label} (boundary segment)`;
          actions.push({ type: 'edit_connection', id: pointId, label });
          segments.push({ id: pointId, source: parent, target: child, label });
          target = { objectId: parent, pointId };
          child = parent;
        }
        return target;
      };
      const startTarget = lift(edge.source, 'source'),
        endTarget = lift(edge.target, 'target');
      const startId =
        typeof startTarget === 'string' ? startTarget : startTarget.objectId;
      const endId =
        typeof endTarget === 'string' ? endTarget : endTarget.objectId;
      actions.push({
        type: 'create_connection',
        id: edge.id,
        kind: 'arrow',
        start: { x: positions.get(startId).x, y: positions.get(startId).y },
        end: { x: positions.get(endId).x, y: positions.get(endId).y },
        startTarget,
        endTarget,
      });
      actions.push({ type: 'edit_connection', id: edge.id, label: edge.label });
      segments.push({
        id: edge.id,
        source: startId,
        target: endId,
        label: edge.label,
      });
    }
    let batch = [];
    for (const action of actions) {
      if (
        batch.length &&
        (batch.length === 30 ||
          Buffer.byteLength(JSON.stringify([...batch, action])) > 44 * 1024)
      ) {
        await edit(batch);
        batch = [];
      }
      batch.push(action);
    }
    if (batch.length) await edit(batch);
    const manifest = {
      mapKey: plan.repository,
      repository: plan.repository,
      revision: null,
      relationships: plan.connections.map((edge) => ({
        connectionId: edge.id,
        source: edge.source,
        target: edge.target,
        segments: segments
          .filter(
            (segment) =>
              segment.id === edge.id || segment.id.startsWith(edge.id + '-'),
          )
          .map((segment) => segment.id),
      })),
      connections: Object.fromEntries(
        (await query('connections', { pageSize: 200 })).items.map(
          ({ id, value }) => [
            id,
            {
              label: hash(value.label),
              start: hash(value.start),
              end: hash(value.end),
            },
          ],
        ),
      ),
      entries: Object.fromEntries(
        (await objects()).map(({ id, value }) => [
          id,
          {
            key: `${plan.repository}:${id}`,
            name: hash(value.name),
            content: hash(value.content),
          },
        ]),
      ),
    };
    await edit([
      {
        type: 'create_object',
        id: 'map-manifest',
        parentId: plan.nodes[0].id,
        shape: 'rectangle',
        name: 'Map provenance and refresh manifest',
        geometry: {
          x: 0,
          y: -260,
          width: 300,
          height: 190,
          rotation: 0,
          z: 100,
        },
      },
      {
        type: 'edit_object',
        id: 'map-manifest',
        content: [jsonBlock(manifest)],
      },
    ]);
    for (const view of plan.bookmarks) {
      await edit(
        Object.entries(view.depths).map(([rootId, depth]) => ({
          type: 'depth',
          rootId,
          depth,
        })),
      );
      await frame(view.targets);
      await bookmark('create', view.id, view.name);
      await checkView(view);
      const screenshot = await driver.request(
        `/session/${driver.session}/screenshot`,
        undefined,
        'GET',
      );
      await writeFile(
        path.join(driver.profile, `${example}-${view.id}.png`),
        Buffer.from(screenshot, 'base64'),
      );
    }
    await bookmark('apply', plan.bookmarks[0].id);
    await file({ type: 'save_as', path: target });
    const saved = JSON.parse(await readFile(target, 'utf8'));
    const previousHandle = (await state()).handle;
    await file({ type: 'open', path: target });
    assert.notEqual((await state()).handle.sessionId, previousHandle.sessionId);
    for (const { id, value } of await objects())
      assert.deepEqual(value, saved.objects[id]);
    for (const edge of segments) {
      const { value } = (await query('connections', { ids: [edge.id] }))
        .items[0];
      assert.equal(value.start.objectId, edge.source);
      assert.equal(value.end.objectId, edge.target);
      assert.equal(value.label, edge.label);
    }
    for (const view of plan.bookmarks) await checkView(view);
    await bookmark('apply', plan.bookmarks[0].id);

    const before = await state();
    const search = (query, extra = {}) =>
      call('depthplan_search', {
        handle: before.handle,
        query,
        collection: 'objects',
        pageSize: 50,
        ...extra,
      });
    const term = example === 'rails' ? 'Person' : 'Health';
    const found = await search(term);
    assert(
      found.items.some((item) => !item.visible),
      'Hidden detail must be discoverable',
    );
    if (example === 'rails') {
      const scoped = await search('crm_members', { subtreeId: 'domain' });
      assert(scoped.items.some((item) => item.id === 'person'));
      assert(!scoped.items.some((item) => item.id === 'admin-person'));
      assert(
        (await search('cacti', { subtreeId: 'domain' })).items.some(
          (item) => item.id === 'cactus',
        ),
      );
      assert.equal((await search('imaginary-feature')).items.length, 0);
    } else assert(!plan.nodes.some((node) => node.id.includes('table')));
    let cursor,
      pages = 0,
      ids = [];
    do {
      const result = await query('objects', {
        pageSize: 2,
        ...(cursor ? { cursor } : {}),
      });
      ids.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    if (example === 'rails')
      assert(cursor, 'Bounded fallback must report incomplete coverage');
    else assert.equal(ids.length, plan.nodes.length + 1);
    let offset = 0,
      text = '';
    do {
      const result = await call('depthplan_read_chunk', {
        handle: before.handle,
        collection: 'objects',
        id: plan.nodes[0].id,
        expectedRevision: before.revision,
        offset,
        length: 256,
      });
      text += result.text;
      offset = result.nextOffset;
    } while (offset !== null);
    assert.equal(JSON.parse(text).id, plan.nodes[0].id);
    assert.deepEqual(
      await state(),
      before,
      'Placement reads must preserve document/view state',
    );

    // An unmodified generated field can change; a user-edited field must not.
    const managedId = plan.nodes[1].id,
      conflictId = plan.nodes[2].id;
    await edit([
      {
        type: 'create_object',
        id: 'user-note',
        shape: 'rectangle',
        name: 'Keep my note',
        geometry: { x: 0, y: 0, width: 150, height: 100, rotation: 0, z: 99 },
      },
      { type: 'edit_object', id: conflictId, name: 'User-customized name' },
    ]);
    await bookmark('create', 'user-bookmark', 'Keep my view');
    const unrelated = (await query('bookmarks', { ids: ['user-bookmark'] }))
      .items[0].value;
    const current = (await query('objects', { ids: [managedId, conflictId] }))
      .items;
    const refreshed = [],
      conflicts = [];
    for (const { id, value } of current) {
      if (hash(value.name) !== manifest.entries[id].name) {
        conflicts.push(id);
        continue;
      }
      const name = `${value.name} (reviewed)`;
      refreshed.push({ type: 'edit_object', id, name });
      manifest.entries[id].name = hash(name);
    }
    assert.deepEqual(conflicts, [conflictId]);
    await edit([
      ...refreshed,
      {
        type: 'edit_object',
        id: 'map-manifest',
        content: [jsonBlock(manifest)],
      },
    ]);
    for (const { id, value } of current) {
      const actual = (await query('objects', { ids: [id] })).items[0].value;
      assert.deepEqual(
        { ...actual, name: value.name },
        value,
        'Refresh must preserve content, style and geometry',
      );
    }
    assert.equal(
      (await objects()).length,
      plan.nodes.length + 2,
      'Refresh must not duplicate managed objects',
    );
    assert.equal(
      (await query('objects', { ids: [conflictId] })).items[0].value.name,
      'User-customized name',
    );
    assert.equal(
      (await query('objects', { ids: ['user-note'] })).items[0].value.name,
      'Keep my note',
    );
    assert.deepEqual(
      (await query('bookmarks', { ids: ['user-bookmark'] })).items[0].value,
      unrelated,
    );
    await bookmark('apply', plan.bookmarks[0].id);
    await file({ type: 'save' });
    await file({ type: 'open', path: target });
    assert.equal(
      (await query('objects', { ids: [conflictId] })).items[0].value.name,
      'User-customized name',
    );
    for (const [source, expected] of sourceHashes)
      assert.equal(
        await fileHash(source),
        expected,
        'Source must stay unchanged',
      );
    console.log(
      `PASS ${example}: source evidence, hierarchy, ${plan.bookmarks.length} bookmarks, scoped reads, bounded fallback/chunks, refresh conflicts, save/reopen. ${target}`,
    );
  }
} finally {
  probe?.close();
  await driver.close();
}
