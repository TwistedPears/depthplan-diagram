import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function shiftInteractions(driver, probe) {
  const { sync, js, click, dialogs, until, profile } = driver;
  const paint = () =>
    js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
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
    await paint();
  };
  const select = (objects) =>
    command('depthplan_selection', { action: 'set', objects });
  const pointer = async (type, point, modifiers = {}) => {
    await sync(
      `const [type,p,modifiers]=arguments;
      document.elementFromPoint(p.x,p.y).dispatchEvent(new MouseEvent(type,{
      bubbles:true,cancelable:true,clientX:p.x,clientY:p.y,button:0,buttons:type==='mouseup'?0:1,...modifiers}));`,
      [type, point, modifiers],
    );
    await paint();
  };
  const key = async (type, key, shiftKey = false) => {
    await sync(
      `window.dispatchEvent(new KeyboardEvent(arguments[0],{key:arguments[1],shiftKey:arguments[2],bubbles:true}));`,
      [type, key, shiftKey],
    );
    await paint();
  };
  const geometry = (id) =>
    sync(
      `const n=window.Konva.stages[0].findOne('#object-'+arguments[0]);
    return {...n.getAbsolutePosition(),width:n.width(),height:n.height(),rotation:n.getAbsoluteRotation()};`,
      [id],
    );
  const capture = async (name) => {
    await paint();
    const bytes = await driver.request(
      `/session/${driver.session}/screenshot`,
      undefined,
      'GET',
    );
    await writeFile(path.join(profile, name), Buffer.from(bytes, 'base64'));
  };
  const document = {
    formatVersion: 2,
    id: 'shift-interactions',
    metadata: {
      title: 'Shift interactions',
      created: '2026-09-28',
      modified: '2026-09-28',
    },
    objects: {},
    layouts: {},
    rootDepths: {},
    connections: {},
  };
  for (const [id, parentId, x, y, width, height, rotation] of [
    ['a', null, 400, 300, 120, 80, 25],
    ['leaf', 'a', 0, 0, 30, 20, 0],
    ['parent', null, 930, 470, 340, 300, 20],
    ['nested', 'parent', 0, 0, 120, 100, 17],
    ['inside', 'nested', -20, 0, 20, 16, 0],
  ]) {
    const g = { x, y, width, height, rotation, z: 0 };
    document.objects[id] = {
      id,
      parentId,
      name: id,
      type: 'rectangle',
      content: [],
      geometry: g,
      style: { fill: '#ffffff', strokeWidth: 2 },
    };
  }
  const g = (id) => ({ ...document.objects[id].geometry });
  document.objects.a.style.fillType = 'hachure';
  document.rootDepths = { a: 0, parent: 2 };
  document.layouts = {
    a: { 0: { a: g('a') }, 1: { a: g('a'), leaf: g('leaf') } },
    parent: {
      0: { parent: g('parent') },
      2: { parent: g('parent'), nested: g('nested'), inside: g('inside') },
    },
  };
  document.connections.internal = {
    id: 'internal',
    kind: 'arrow',
    ownerId: 'a',
    z: 0,
    start: { kind: 'object', objectId: 'a', side: 'left', offset: 0.5 },
    end: { kind: 'object', objectId: 'leaf', side: 'left', offset: 0.5 },
  };
  let file;
  const save = async () => {
    await click('Save document');
    await until(async () => {
      const s = await state();
      return !s.dirty && !s.busyReasons.includes('file-operation');
    });
    return JSON.parse(await readFile(file, 'utf8'));
  };
  for (const type of ['rectangle', 'diamond', 'ellipse', 'frame']) {
    document.id = `shift-${type}`;
    document.objects.a.type = type;
    file = path.join(profile, `shift-${type}.depthplan`);
    await writeFile(file, JSON.stringify(document));
    await dialogs('open', file);
    await click('Menu');
    await click('Open Board…');
    await until(async () => (await state()).source?.path === file);
    await click('Reset view');
    const before = await save(),
      original = await geometry('a');
    await select(['a']);
    const revision = (await state()).revision;
    const end = { x: original.x + 180, y: original.y + 40 };
    await pointer('mousedown', original, { shiftKey: true });
    await pointer('mousemove', end, { shiftKey: true });
    assert.equal(
      (await state()).revision,
      revision,
      'preview creates no document edit',
    );
    assert.deepEqual(await geometry('a'), original, 'source stays in place');
    const ghost =
      await sync(`const n=window.Konva.stages[0].findOne('.duplicate-preview');
      return n&&{type:n.getClassName(),filled:n.fillEnabled(),dash:n.dash(),center:n.getParent().getAbsolutePosition()};`);
    assert.equal(
      ghost.type,
      { rectangle: 'Rect', diamond: 'Line', ellipse: 'Ellipse', frame: 'Rect' }[
        type
      ],
    );
    assert.equal(ghost.filled, false);
    assert.deepEqual(ghost.dash, [1, 4]);
    assert.deepEqual(ghost.center, end);
    if (type === 'diamond') await capture('shift-duplicate-shadow.png');
    await pointer('mouseup', end, { shiftKey: true });
    const after = await save();
    assert.equal((await state()).revision, revision + 1, 'drop is one edit');
    const copy = Object.values(after.objects).find(
      (o) => !before.objects[o.id] && o.parentId === null,
    );
    assert(copy);
    assert.deepEqual(await geometry(copy.id), { ...original, ...end });
    assert.deepEqual(after.objects.a, before.objects.a);
    assert.deepEqual(await geometry('a'), original);
    assert.deepEqual(copy.style, before.objects.a.style);
    assert(
      Object.values(after.objects).some(
        (o) => o.parentId === copy.id && o.name === 'leaf',
      ),
      'hidden child copied',
    );
    assert(
      Object.values(after.connections).some((c) => c.ownerId === copy.id),
      'internal arrow copied',
    );
    assert.equal(
      await sync(
        `return window.Konva.stages[0].find('.duplicate-preview').length;`,
      ),
      0,
    );
    await click('Undo');
    assert.deepEqual((await save()).objects, before.objects);
    await click('Redo');
    assert.deepEqual((await save()).objects, after.objects);
    await click('Undo');
    await save();
  }
  await select(['a']);
  const original = await geometry('a'),
    before = await save();
  await pointer('mousedown', original, { shiftKey: true });
  await pointer(
    'mousemove',
    { x: original.x + 100, y: original.y },
    { shiftKey: true },
  );
  await key('keydown', 'Escape');
  await pointer('mouseup', { x: original.x + 100, y: original.y });
  assert.deepEqual(
    (await save()).objects,
    before.objects,
    'Escape discards the copy',
  );
  await pointer('mousedown', original, { shiftKey: true });
  await pointer('mouseup', original, { shiftKey: true });
  assert.deepEqual(
    (await save()).objects,
    before.objects,
    'Shift-click never duplicates',
  );

  await select(['nested']);
  const base = await geometry('nested'),
    child = await geometry('inside');
  const beforeNested = await save();
  const copyEnd = { x: base.x + 80, y: base.y - 15 };
  await pointer('mousedown', base, { shiftKey: true });
  await pointer('mousemove', copyEnd, { shiftKey: true });
  await key('keyup', 'Shift');
  await pointer('mouseup', copyEnd);
  const afterNested = await save();
  const nestedCopy = Object.values(afterNested.objects).find(
    (o) => !beforeNested.objects[o.id] && o.parentId === 'parent',
  );
  assert(
    nestedCopy,
    'copy stays in its rotated parent after Shift is released',
  );
  const copyGeometry = await geometry(nestedCopy.id);
  assert(
    Math.hypot(copyGeometry.x - copyEnd.x, copyGeometry.y - copyEnd.y) < 0.001,
  );
  assert.deepEqual(await geometry('nested'), base);
  await click('Undo');
  await save();
  const radians = (base.rotation * Math.PI) / 180;
  const world = (x, y) => ({
    x: base.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: base.y + x * Math.sin(radians) + y * Math.cos(radians),
  });
  for (const x of [-1, 0, 1])
    for (const y of [-1, 0, 1]) {
      if (!x && !y) continue;
      await select(['nested']);
      const start = world((x * base.width) / 2, (y * base.height) / 2),
        end = world(x * (base.width / 2 + 20), y * (base.height / 2 + 12));
      await pointer('mousedown', start, { shiftKey: true });
      await pointer('mousemove', end, { shiftKey: true });
      const resized = await geometry('nested');
      assert(Math.hypot(resized.x - base.x, resized.y - base.y) < 0.001);
      // WebKit truncates synthetic pointer coordinates to whole screen pixels.
      assert(
        Math.abs(resized.width - base.width - (x ? 40 : 0)) < 3,
        JSON.stringify({ x, y, start, end, base, resized }),
      );
      assert(Math.abs(resized.height - base.height - (y ? 24 : 0)) < 3);
      assert.deepEqual(
        await geometry('inside'),
        child,
        'resize does not move children',
      );
      if (x === 1 && y === 1) await capture('shift-centered-resize.png');
      await pointer('mouseup', end, { shiftKey: true });
      assert.deepEqual(await geometry('nested'), resized);
      await click('Undo');
      await paint();
      assert.deepEqual(await geometry('nested'), base);
    }
  await select(['nested']);
  const start = world(base.width / 2, 0),
    end = world(base.width / 2 + 20, 0);
  await pointer('mousedown', start);
  await pointer('mousemove', end);
  const anchored = await geometry('nested');
  await key('keydown', 'Shift', true);
  assert(
    Math.abs(
      (await geometry('nested')).width -
        base.width -
        2 * (anchored.width - base.width),
    ) < 0.001,
  );
  await key('keyup', 'Shift');
  assert.deepEqual(await geometry('nested'), anchored);
  await key('keydown', 'Escape');
  await pointer('mouseup', end);
  assert.deepEqual(await geometry('nested'), base);
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    'PASS Shift interactions: four outline types, stationary originals, full subtree/wiring copies, atomic Undo/Redo, Escape and Shift-click; all eight centered resize handles under rotated ancestors and live Shift changes.',
  );
}
