import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function connectors(driver, probe) {
  const { sync, js, click, dialogs, until, profile } = driver;
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
  };
  const document = {
    formatVersion: 2,
    id: 'connector-snapping',
    metadata: {
      title: 'Connector snapping',
      created: '2026-09-25',
      modified: '2026-09-25',
    },
    objects: {},
    rootDepths: {},
    layouts: {},
    connections: {},
  };
  for (const [id, type, x, y] of [
    ['a', 'rectangle', 400, 300],
    ['b', 'rectangle', 780, 300],
    ['c', 'ellipse', 780, 550],
    ['d', 'diamond', 1050, 550],
  ]) {
    const geometry = { x, y, width: 180, height: 120, rotation: 0, z: 0 };
    document.objects[id] = {
      id,
      parentId: null,
      name: id,
      type,
      geometry,
      content: [],
      style: { fill: '#dbeafe', strokeWidth: 2 },
    };
    document.rootDepths[id] = 0;
    document.layouts[id] = { 0: { [id]: geometry } };
  }
  document.objects.b.boundaryPoints = { port: { side: 'left', offset: 0.5 } };
  document.connections.legacy = {
    id: 'legacy',
    ownerId: null,
    kind: 'arrow',
    z: 0,
    start: { kind: 'free', x: 550, y: 220 },
    end: { kind: 'boundary', objectId: 'b', pointId: 'port' },
  };
  const file = path.join(profile, 'connector-snapping.depthplan');
  await writeFile(file, JSON.stringify(document));
  await dialogs('open', file);
  await click('Menu');
  await click('Open');
  await until(async () => (await state()).source?.path === file);
  await click('Reset view');
  const save = async () => {
    await click('Save document');
    await until(async () => {
      const current = await state();
      return !current.dirty && !current.busyReasons.includes('file-operation');
    });
    return JSON.parse(await readFile(file, 'utf8'));
  };
  const pointer = async (type, x, y, modifiers = {}) => {
    await sync(
      `const [type,x,y,modifiers]=arguments;
      document.elementFromPoint(x,y).dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:type==='mouseup'?0:1,...modifiers}));`,
      [type, x, y, modifiers],
    );
    await js(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
  };
  const endHandle = () =>
    sync(
      `return window.Konva.stages[0].find('.connector-point-handle').find(n=>n.getAttr('connectorHandle').index===1).getAbsolutePosition();`,
    );
  const select = (id) =>
    command('depthplan_selection', { action: 'set', connections: [id] });
  await click('Arrow');
  for (const [x, y] of [
    [400, 300],
    [780, 550],
    [1050, 550],
  ]) {
    await pointer('mousemove', x, y);
    assert.deepEqual(
      await sync(
        `return window.Konva.stages[0].find('.connection-anchor').map(n=>n.getAbsolutePosition());`,
      ),
      [
        { x, y: y - 60 },
        { x: x + 90, y },
        { x, y: y + 60 },
        { x: x - 90, y },
      ],
    );
  }
  await pointer('mousedown', 490, 300);
  await pointer('mousemove', 690, 300);
  await pointer('mouseup', 690, 300);
  let saved = await save();
  const id = Object.keys(saved.connections).find((key) => key !== 'legacy');
  assert(id, 'drawing creates an arrow');
  assert.deepEqual(saved.connections[id].start, {
    kind: 'object',
    objectId: 'a',
    side: 'right',
    offset: 0.5,
    binding: 'fixed',
  });
  assert.deepEqual(saved.connections[id].end, {
    kind: 'object',
    objectId: 'b',
    side: 'left',
    offset: 0.5,
    binding: 'fixed',
  });

  // The start handle supports the same reattachment and Undo flow.
  const start = await sync(
    `return window.Konva.stages[0].find('.connector-point-handle').find(n=>n.getAttr('connectorHandle').index===0).getAbsolutePosition();`,
  );
  await pointer('mousedown', start.x, start.y);
  await pointer('mousemove', 1050, 490);
  await pointer('mouseup', 1050, 490);
  assert.deepEqual((await save()).connections[id].start, {
    kind: 'object',
    objectId: 'd',
    side: 'top',
    offset: 0.5,
    binding: 'fixed',
  });
  await click('Undo');
  assert.deepEqual(
    (await save()).connections[id].start,
    saved.connections[id].start,
  );

  // Leaving the snap radius follows the pointer along the outline in one drag.
  let handle = await endHandle();
  await pointer('mousedown', handle.x, handle.y);
  await pointer('mousemove', 690, 311);
  assert.deepEqual(await endHandle(), { x: 682, y: 300 });
  await pointer('mousemove', 690, 326);
  assert((await endHandle()).y > 320, 'endpoint releases the side midpoint');
  await pointer('mouseup', 690, 326);
  saved = await save();
  assert(saved.connections[id].end.offset > 0.6);
  assert.deepEqual(
    saved.objects.b.boundaryPoints,
    document.objects.b.boundaryPoints,
  );
  await click('Undo');
  assert.deepEqual((await save()).connections[id].end, {
    kind: 'object',
    objectId: 'b',
    side: 'left',
    offset: 0.5,
    binding: 'fixed',
  });

  // Stored ports must never intercept a selected arrow's endpoint drag.
  await select('legacy');
  await js(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  handle = await endHandle();
  await pointer('mousedown', handle.x, handle.y);
  await pointer('mousemove', 780, 490);
  await pointer('mouseup', 780, 490);
  saved = await save();
  assert.deepEqual(saved.connections.legacy.end, {
    kind: 'object',
    objectId: 'c',
    side: 'top',
    offset: 0.5,
    binding: 'fixed',
  });
  assert.deepEqual(
    saved.objects.b.boundaryPoints,
    document.objects.b.boundaryPoints,
  );
  handle = await endHandle();
  await pointer('mousedown', handle.x, handle.y);
  await pointer('mousemove', 1150, 720);
  await pointer('mouseup', 1150, 720);
  assert.deepEqual((await save()).connections.legacy.end, {
    kind: 'free',
    x: 1150,
    y: 720,
  });

  // A preferred point returns after the shapes move back into view of each other.
  await select(id);
  await command('depthplan_edit', {
    actions: [{ type: 'geometry', id: 'a', patch: { x: 1050 } }],
  });
  await js(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  assert(
    (await endHandle()).x > 780,
    'hidden left attachment slides to the visible right edge',
  );
  await click('Undo');
  await js(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  assert.deepEqual(await endHandle(), { x: 682, y: 300 });
  saved = await save();
  assert.equal(saved.connections[id].end.side, 'left');
  await dialogs('open', file);
  await click('Menu');
  await click('Open');
  await until(
    async () =>
      (await state()).source?.path === file &&
      !(await state()).busyReasons.length,
  );
  await select(id);
  await js(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  assert.deepEqual(await endHandle(), { x: 682, y: 300 });
  assert.equal(
    await sync(
      'return !!document.querySelector(`[aria-label="Add boundary point"]`)',
    ),
    false,
  );
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  await click('Arrow');
  await pointer('mousemove', 400, 300);
  const screenshot = await driver.request(
    `/session/${driver.session}/screenshot`,
    undefined,
    'GET',
  );
  await writeFile(
    path.join(profile, 'connector-snapping.png'),
    Buffer.from(screenshot, 'base64'),
  );
  await click('Pointer (Select/Edit)');
  console.log(
    'PASS connector snapping: four shape anchors, creation, snap/release in one drag, boundary endpoint priority, reattachment/detachment, visible-side fallback, Undo and reopen.',
  );
}
