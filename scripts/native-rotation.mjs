import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function rotation(driver, probe) {
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
  const edit = (...actions) => command('depthplan_edit', { actions });
  const select = (id) =>
    command('depthplan_selection', {
      action: 'set',
      objects: [id],
      connections: [],
    });
  const camera = (scale) =>
    command('depthplan_camera', {
      action: {
        type: 'set',
        camera: { x: 650 - 520 * scale, y: 400 - 280 * scale, scale },
      },
    });
  let file;
  const open = async (document) => {
    file = path.join(profile, `${document.id}.depthplan`);
    await writeFile(file, JSON.stringify(document));
    await dialogs('open', file);
    await click('Menu');
    await click('Open');
    await until(async () => (await state()).source?.path === file);
    await click('Reset view');
  };
  const save = async () => {
    await click('Save document');
    await until(async () => !(await state()).dirty);
    return JSON.parse(await readFile(file, 'utf8'));
  };
  const pointer = async (type, point, buttons = type === 'mouseup' ? 0 : 1) => {
    await sync(
      `const [type,p,buttons]=arguments;
      document.elementFromPoint(p.x,p.y).dispatchEvent(new MouseEvent(type, {
        bubbles:true,cancelable:true,clientX:Math.round(p.x),clientY:Math.round(p.y),button:0,buttons
      }));`,
      [type, point, buttons],
    );
    await js(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
  };
  const pose = (id) =>
    sync(
      `const n=window.Konva.stages[0].findOne('#object-'+arguments[0]);
    return {...n.getAbsolutePosition(), width:n.width(), height:n.height(), rotation:n.getAbsoluteRotation()};`,
      [id],
    );
  const handles = () =>
    sync(`const stage=window.Konva.stages[0], box=stage.container().getBoundingClientRect();
    return stage.find('.resize-handle').map(n=>{
      const x=n.x()+n.width()/2,y=n.y()+n.height()/2;
      const dx=Math.sign(x),dy=Math.sign(y),offset=14/(Math.hypot(dx,dy)*stage.scaleX());
      const p=n.getParent().getAbsoluteTransform().point({x:x+dx*offset,y:y+dy*offset});
      return {x:Math.round(p.x+box.left),y:Math.round(p.y+box.top)};});`);
  const cursor = () =>
    sync(
      `return getComputedStyle(window.Konva.stages[0].container().querySelector('canvas')).cursor;`,
    );
  const hint = () =>
    sync(
      `return document.querySelector('.connection-editing-hint')?.textContent;`,
    );
  const around = (center, start, degrees, extra = 0) => {
    const angle =
      Math.atan2(start.y - center.y, start.x - center.x) +
      (degrees * Math.PI) / 180;
    const radius = Math.hypot(start.x - center.x, start.y - center.y) + extra;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  };
  const capture = async (name) => {
    const bytes = await driver.request(
      `/session/${driver.session}/screenshot`,
      undefined,
      'GET',
    );
    await writeFile(path.join(profile, name), Buffer.from(bytes, 'base64'));
  };
  const document = {
    formatVersion: 2,
    id: 'rotation',
    metadata: {
      title: 'Rotation',
      created: '2026-09-25',
      modified: '2026-09-25',
    },
    objects: {},
    layouts: {},
    rootDepths: {},
    connections: {},
  };
  for (const [i, type] of [
    'rectangle',
    'ellipse',
    'diamond',
    'frame',
  ].entries()) {
    const geometry = {
      x: i % 2 ? 930 : 520,
      y: i < 2 ? 280 : 550,
      width: 180,
      height: 120,
      rotation: 0,
      z: 0,
    };
    document.objects[type] = {
      id: type,
      parentId: null,
      type,
      name: type,
      content: [],
      geometry,
      style: { fill: '#ffffff', strokeWidth: 2 },
    };
    document.layouts[type] = { 0: { [type]: geometry } };
    document.rootDepths[type] = 0;
  }
  await open(document);
  // Every shape and all eight external handle zones support rotation.
  for (const id of Object.keys(document.objects)) {
    await select(id);
    const before = await pose(id);
    const zones = await handles();
    assert.equal(zones.length, 8);
    const initialRevision = (await state()).revision;
    await pointer('mousedown', zones[0]);
    await pointer('mouseup', zones[0]);
    assert.equal(
      (await handles()).length,
      8,
      'click without rotation keeps selection',
    );
    assert.equal((await state()).revision, initialRevision);
    for (const start of id === 'rectangle' ? zones : [zones[6]]) {
      await pointer('mousemove', start, 0);
      assert.match(
        await cursor(),
        /url\(/,
        'rotation cursor outside resize handle',
      );
      const revision = (await state()).revision;
      await pointer('mousedown', start);
      const end = around(before, start, 17);
      await pointer('mousemove', end);
      assert.equal(Math.round((await pose(id)).rotation), 17);
      assert.equal(
        (await state()).revision,
        revision,
        'preview does not commit',
      );
      assert.match(await hint(), /17°.*1° steps/);
      await pointer('mouseup', end);
      assert.equal(
        (await state()).revision,
        revision + 1,
        'one gesture, one commit',
      );
      const saved = await save();
      assert.deepEqual(saved.layouts[id][0][id], {
        ...document.objects[id].geometry,
        rotation: 17,
      });
      await click('Undo');
      assert.deepEqual(await pose(id), before);
      await click('Redo');
      assert.equal(Math.round((await pose(id)).rotation), 17);
      await click('Undo');
    }
  }
  for (const scale of [0.5, 2]) {
    await select('rectangle');
    await camera(scale);
    const before = await pose('rectangle'),
      start = (await handles())[6];
    await pointer('mousedown', start);
    const far = around(before, start, 22, 45);
    await pointer('mousemove', far);
    assert.equal(Math.round((await pose('rectangle')).rotation), 15);
    assert.match(await hint(), /15°.*15° steps/);
    await capture(`rotation-snapped-${scale}.png`);
    const near = around(before, start, 22, 20);
    await pointer('mousemove', near);
    assert.equal(Math.round((await pose('rectangle')).rotation), 22);
    assert.match(await hint(), /22°.*1° steps/);
    await pointer('mouseup', near);
    await click('Undo');
    assert.deepEqual(await pose('rectangle'), before);
  }
  await camera(1);
  await edit({ type: 'geometry', id: 'rectangle', patch: { rotation: 350 } });
  await select('rectangle');
  let before = await pose('rectangle'),
    start = (await handles())[6];
  await pointer('mousedown', start);
  let end = around(before, start, 17);
  await pointer('mousemove', end);
  await pointer('mouseup', end);
  assert.equal(
    Math.round((await pose('rectangle')).rotation),
    7,
    'wraps through zero',
  );

  // Resize remains available on the square handle after rotation.
  before = await pose('rectangle');
  start = await sync(`const stage=window.Konva.stages[0];
    const n=stage.find('.resize-handle').find(n=>n.x()+n.width()/2>0 && Math.abs(n.y()+n.height()/2)<1e-6);
    return n.getAbsoluteTransform().point({x:n.width()/2,y:n.height()/2});`);
  await pointer('mousemove', start, 0);
  assert.doesNotMatch(await cursor(), /url\(/);
  await pointer('mousedown', start);
  end = {
    x: start.x + 30 * Math.cos((7 * Math.PI) / 180),
    y: start.y + 30 * Math.sin((7 * Math.PI) / 180),
  };
  await pointer('mousemove', end);
  await pointer('mouseup', end);
  assert(Math.abs((await pose('rectangle')).width - before.width - 30) < 1);
  assert.equal(Math.round((await pose('rectangle')).rotation), 7);
  await click('Undo');

  for (const cancel of ['Escape', 'blur']) {
    await select('rectangle');
    before = await pose('rectangle');
    start = (await handles())[6];
    const revision = (await state()).revision;
    await pointer('mousedown', start);
    end = around(before, start, 53);
    await pointer('mousemove', end);
    await sync(
      `window.dispatchEvent(arguments[0]==='Escape'?new KeyboardEvent('keydown',{key:'Escape',bubbles:true}):new Event('blur'));`,
      [cancel],
    );
    await pointer('mouseup', end);
    assert.deepEqual(await pose('rectangle'), before);
    assert.equal(
      (await state()).revision,
      revision,
      'cancellation does not commit',
    );
    assert.doesNotMatch(await cursor(), /url\(/);
  }
  await save();

  const nested = structuredClone(document);
  nested.id = 'rotation-nested';
  const parent = nested.objects.frame;
  parent.geometry = {
    x: 650,
    y: 400,
    width: 500,
    height: 400,
    rotation: 30,
    z: 0,
  };
  const child = nested.objects.rectangle;
  child.parentId = 'frame';
  child.geometry = {
    x: 30,
    y: -20,
    width: 160,
    height: 100,
    rotation: 10,
    z: 0,
  };
  const grandchild = nested.objects.ellipse;
  grandchild.parentId = 'rectangle';
  grandchild.geometry = {
    x: 35,
    y: 15,
    width: 30,
    height: 20,
    rotation: 5,
    z: 0,
  };
  nested.layouts = { frame: {}, diamond: document.layouts.diamond };
  nested.rootDepths = { frame: 2, diamond: 0 };
  for (const depth of [0, 1, 2])
    nested.layouts.frame[depth] = Object.fromEntries(
      [parent, child, grandchild]
        .slice(0, depth + 1)
        .map((o) => [o.id, { ...o.geometry }]),
    );
  nested.connections.arrow = {
    id: 'arrow',
    kind: 'arrow',
    ownerId: null,
    z: 0,
    start: {
      kind: 'object',
      objectId: 'rectangle',
      side: 'right',
      offset: 0.5,
      binding: 'fixed',
    },
    end: {
      kind: 'object',
      objectId: 'diamond',
      side: 'top',
      offset: 0.5,
      binding: 'auto',
    },
  };
  await open(nested);
  await select('rectangle');
  before = await pose('rectangle');
  start = (await handles())[6];
  const parentBefore = await pose('frame');
  const route = () =>
    sync(
      `return window.Konva.stages[0].findOne('#connection-arrow').findOne('.connection-path').points();`,
    );
  const routeBefore = await route();
  await pointer('mousedown', start);
  end = around(before, start, 17);
  await pointer('mousemove', end);
  assert.equal(Math.round((await pose('rectangle')).rotation), 57);
  assert.equal(Math.round((await pose('ellipse')).rotation), 62);
  assert.deepEqual(await pose('frame'), parentBefore);
  assert.notDeepEqual(
    await route(),
    routeBefore,
    'bound arrow follows rotation',
  );
  await capture('rotation-nested-preview.png');
  await pointer('mouseup', end);
  const saved = await save();
  assert.equal(saved.layouts.frame[2].rectangle.rotation, 27);
  assert.deepEqual(
    saved.layouts.frame[2].ellipse,
    nested.layouts.frame[2].ellipse,
  );
  assert.deepEqual(saved.layouts.frame[0], nested.layouts.frame[0]);
  assert.deepEqual(saved.layouts.frame[1], nested.layouts.frame[1]);
  assert.deepEqual(saved.objects, nested.objects);
  assert.deepEqual(saved.connections, nested.connections);
  await click('Undo');
  assert.deepEqual((await save()).layouts, nested.layouts);
  await click('Redo');
  await save();
  await dialogs('open', file);
  await click('Menu');
  await click('Open');
  await until(async () => !(await state()).canUndo);
  assert.equal(Math.round((await pose('rectangle')).rotation), 57);
  assert.equal(Math.round((await pose('ellipse')).rotation), 62);
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    'PASS rotation: all shapes/eight handle zones, cursor, whole degrees, outward 15° snapping and release at different zooms, one-step Undo/Redo, resize, wraparound, Escape/blur cancellation, nested children/arrows and reopen.',
  );
}
