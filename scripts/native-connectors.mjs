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
  let file = path.join(profile, 'connector-snapping.depthplan');
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
      const target=document.elementFromPoint(x,y);
      if(!target)throw new Error('Pointer '+x+','+y+' outside viewport '+innerWidth+'x'+innerHeight);
      target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:type==='mouseup'?0:1,...modifiers}));`,
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
  const capture = async (name) => {
    const bytes = await driver.request(
      `/session/${driver.session}/screenshot`,
      undefined,
      'GET',
    );
    await writeFile(path.join(profile, name), Buffer.from(bytes, 'base64'));
  };
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
  // Hosted macOS can clamp the window below its requested height.
  // Stay clear of both the bottom toolbar and the diamond's snap radius.
  const free = await sync(
    'return {x:Math.min(1200,innerWidth-40),y:Math.min(720,innerHeight-130)}',
  );
  await pointer('mousedown', handle.x, handle.y);
  await pointer('mousemove', free.x, free.y);
  await pointer('mouseup', free.x, free.y);
  assert.deepEqual((await save()).connections.legacy.end, {
    kind: 'free',
    ...free,
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
  // Check the removed action in the shape Style panel, including a legacy port.
  for (const object of ['a', 'b']) {
    await command('depthplan_selection', {
      action: 'set',
      objects: [object],
      connections: [],
    });
    await until(() =>
      sync(
        'return !!document.querySelector(`#selection-controls [aria-label="Sharp corners"]`)',
      ),
    );
    assert.equal(
      await sync(
        'return !!document.querySelector(`[aria-label="Add boundary point"]`)',
      ),
      false,
      'Style must not offer custom boundary-point creation',
    );
  }
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  await click('Arrow');
  await pointer('mousemove', 400, 300);
  await capture('connector-snapping.png');
  await click('Pointer (Select/Edit)');
  console.log(
    'PASS connector snapping: four fixed anchors, snap/release, reattachment/detachment, visible-side fallback, Undo and reopen. Legacy endpoint compatibility retained; Add boundary point absent from shape Style controls.',
  );

  const nested = structuredClone(document);
  nested.id = 'parent-connectors';
  nested.metadata.title = 'Parent connections';
  nested.connections = {};
  for (const id of ['c', 'd']) {
    delete nested.objects[id];
    delete nested.layouts[id];
    delete nested.rootDepths[id];
  }
  const parent = { x: 600, y: 420, width: 400, height: 300, rotation: 0, z: 0 };
  const child = { x: 0, y: 0, width: 100, height: 80, rotation: 0, z: 0 };
  nested.objects.a.geometry = parent;
  nested.objects.a.style.fill = '#ffffff';
  nested.objects.child = {
    ...nested.objects.a,
    id: 'child',
    parentId: 'a',
    name: 'child',
    geometry: child,
  };
  nested.layouts.a = { 0: { a: parent }, 1: { a: parent, child } };
  nested.rootDepths.a = 1;
  nested.layouts.b[0].b = { ...nested.layouts.b[0].b, x: 950, y: 420 };
  delete nested.objects.b.boundaryPoints;
  file = path.join(profile, 'parent-connectors.depthplan');
  await writeFile(file, JSON.stringify(nested));
  await dialogs('open', file);
  await click('Menu');
  await click('Open');
  await until(async () => (await state()).source?.path === file);
  await click('Reset view');
  const draw = async (from, to) => {
    await click('Arrow');
    await pointer('mousedown', ...from);
    await pointer('mousemove', ...to);
    assert.equal(
      await sync(
        `return window.Konva.stages[0].find('.connection-path').some(n=>n.stroke()==='#dc2626')`,
      ),
      false,
      'parent-child preview is valid',
    );
    await pointer('mouseup', ...to);
    return save();
  };
  saved = await draw([860, 420], [800, 420]);
  const outside = Object.keys(saved.connections)[0];
  assert.equal(saved.connections[outside].ownerId, null);
  saved = await draw([800, 420], [650, 420]);
  const inside = Object.keys(saved.connections).find((key) => key !== outside);
  assert.equal(saved.connections[inside].ownerId, 'a');
  assert.deepEqual(
    saved.connections[inside].start,
    saved.connections[outside].end,
  );
  assert.deepEqual(await endHandle(), { x: 658, y: 420 });
  const startHandle = () =>
    sync(
      `return window.Konva.stages[0].find('.connector-point-handle').find(n=>n.getAttr('connectorHandle').index===0).getAbsolutePosition();`,
    );
  assert.deepEqual(await startHandle(), { x: 792, y: 420 });

  handle = await startHandle();
  await pointer('mousedown', handle.x, handle.y);
  await pointer('mousemove', 606, 273);
  assert.deepEqual(await startHandle(), { x: 600, y: 278 });
  await pointer('mouseup', 606, 273);
  assert.equal((await save()).connections[inside].start.side, 'top');
  await click('Undo');
  assert.deepEqual(
    (await save()).connections[inside].start,
    saved.connections[inside].start,
  );
  await click('Redo');
  assert.equal((await save()).connections[inside].start.side, 'top');
  await click('Undo');
  await save();

  // An internal arrow can reattach to its own parent's border, then detach inside.
  handle = await endHandle();
  await pointer('mousedown', handle.x, handle.y);
  await pointer('mousemove', 400, 420);
  await pointer('mouseup', 400, 420);
  assert.equal((await save()).connections[inside].end.objectId, 'a');
  assert.deepEqual(await endHandle(), { x: 408, y: 420 });
  handle = await endHandle();
  await pointer('mousedown', handle.x, handle.y);
  await pointer('mousemove', 480, 330);
  await pointer('mouseup', 480, 330);
  assert.deepEqual((await save()).connections[inside].end, {
    kind: 'free',
    x: -120,
    y: -90,
  });
  await click('Undo');
  await click('Undo');
  await save();

  saved = await draw([600, 380], [600, 270]);
  const reverse = Object.keys(saved.connections).find(
    (key) => key !== outside && key !== inside,
  );
  assert.equal(saved.connections[reverse].ownerId, 'a');
  assert.deepEqual(await endHandle(), { x: 600, y: 278 });
  assert.equal(saved.objects.a.boundaryPoints, undefined);
  await click('Hide children of a');
  assert.equal(
    await sync(`return !!window.Konva.stages[0].findOne(arguments[0])`, [
      `#connection-${inside}`,
    ]),
    false,
  );
  assert.equal(
    await sync(`return !!window.Konva.stages[0].findOne(arguments[0])`, [
      `#connection-${outside}`,
    ]),
    true,
  );
  await click('Undo');
  await save();
  await dialogs('open', file);
  await click('Menu');
  await click('Open');
  await until(async () => !(await state()).canUndo);
  await select(inside);
  await js(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  assert.deepEqual(await startHandle(), { x: 792, y: 420 });
  assert.deepEqual(await endHandle(), { x: 658, y: 420 });
  await capture('parent-connectors.png');
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    'PASS parent connections: shared inside/outside anchor, both drawing directions, inward routing, reattachment/detachment, Undo/Redo, collapse and reopen.',
  );

  nested.id = 'nested-connectors';
  nested.metadata.title = 'Direct child connections';
  nested.objects.child.type = 'diamond';
  nested.layouts.a[1].a.z = 5;
  file = path.join(profile, 'nested-connectors.depthplan');
  await writeFile(file, JSON.stringify(nested));
  await dialogs('open', file);
  await click('Menu');
  await click('Open');
  await until(async () => (await state()).source?.path === file);
  await click('Reset view');
  saved = await draw([860, 420], [650, 420]);
  const direct = Object.keys(saved.connections)[0];
  const attachment = saved.connections[direct];
  assert.equal(attachment.ownerId, null);
  assert.equal(attachment.end.objectId, 'child');
  assert.deepEqual(await endHandle(), { x: 658, y: 420 });
  await command('depthplan_selection', { action: 'clear' });
  // The committed line must clear the parent's fill, for paint and hit testing.
  const painted = () =>
    sync(`const layer=window.Konva.stages[0].getLayers()[0];layer.draw();
    const hit=layer.getIntersection({x:730,y:420})?.findAncestor('.recursive-connection',true)?.id();
    const tile=layer.toCanvas({x:729,y:419,width:3,height:3,pixelRatio:1});
    const pixel=Array.from(tile.getContext('2d').getImageData(1,1,1,1).data);tile.width=0;return {hit,pixel};`);
  const expectedInk = {
    hit: `connection-${direct}`,
    pixel: [71, 85, 105, 255],
  };
  assert.deepEqual(await painted(), expectedInk);
  await capture('direct-child-expanded.png');
  await command('depthplan_selection', { action: 'set', objects: ['a'] });
  await pointer('mousedown', 500, 500);
  await pointer('mousemove', 520, 500, { ctrlKey: true });
  assert.deepEqual(
    await painted(),
    expectedInk,
    'arrow remains above the parent during drag',
  );
  await capture('direct-child-drag.png');
  await pointer('mouseup', 520, 500, { ctrlKey: true });
  assert.deepEqual(
    await painted(),
    expectedInk,
    'arrow stays visible after drop',
  );
  assert.deepEqual((await save()).connections[direct], attachment);
  await click('Undo');
  await save();
  await pointer('mousedown', 500, 500);
  await pointer('mousemove', 480, 500, { ctrlKey: true });
  assert.deepEqual(
    await painted(),
    expectedInk,
    'arrow remains above the parent before cancel',
  );
  await sync(
    `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`,
  );
  await pointer('mouseup', 480, 500);
  assert.deepEqual((await save()).layouts, saved.layouts);
  await command('depthplan_selection', { action: 'clear' });
  for (const format of ['svg', 'png']) {
    const exported = path.join(profile, `direct-child.${format}`);
    await click('Export current diagram');
    await sync(
      `const s=document.querySelector('select[aria-label="Format"]');s.value=arguments[0];s.dispatchEvent(new Event('change',{bubbles:true}));`,
      [format],
    );
    await dialogs('save', exported);
    await click('Export');
    let bytes;
    await until(async () => {
      try {
        bytes = await readFile(exported);
        return bytes.length > 100;
      } catch {
        return false;
      }
    });
    const hasArrowInside = await js(
      `(async()=>{
      const image=new Image();image.src=arguments[0];await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      // Parent ink begins near (399,269), plus 16px export padding.
      const pixels=ctx.getImageData(340,164,14,7).data;
      return Array.from({length:pixels.length/4},(_,i)=>i*4).some(i=>pixels[i]===71&&pixels[i+1]===85&&pixels[i+2]===105);
    })()`,
      [
        `data:image/${format === 'svg' ? 'svg+xml' : 'png'};base64,${bytes.toString('base64')}`,
      ],
    );
    assert(hasArrowInside, `${format} retains the arrow inside its parent`);
  }
  await click('Hide children of a');
  saved = await save();
  assert.deepEqual(saved.connections[direct], attachment);
  await select(direct);
  await js(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  assert.deepEqual(await endHandle(), { x: 808, y: 420 });
  await capture('direct-child-collapsed.png');
  await click('Undo');
  await select(direct);
  await until(async () => (await endHandle()).x === 658);
  assert.deepEqual(await endHandle(), { x: 658, y: 420 });
  await click('Redo');
  await save();

  // Save/reopen the collapsed state, then restore the original child's anchor.
  await dialogs('open', file);
  await click('Menu');
  await click('Open');
  await until(async () => !(await state()).canUndo);
  await select(direct);
  await js(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  assert.deepEqual(await endHandle(), { x: 808, y: 420 });
  handle = await endHandle();
  await pointer('mousedown', handle.x, handle.y);
  await pointer('mousemove', free.x, free.y);
  await pointer('mouseup', free.x, free.y);
  assert.deepEqual((await save()).connections[direct].end, {
    kind: 'free',
    ...free,
  });
  await click('Undo');
  assert.deepEqual((await save()).connections[direct], attachment);
  await click('Reveal children of a');
  await select(direct);
  await until(async () => (await endHandle()).x === 658);
  assert.deepEqual(await endHandle(), { x: 658, y: 420 });
  handle = await endHandle();
  await pointer('mousedown', handle.x, handle.y);
  await pointer('mousemove', 600, 380);
  await pointer('mouseup', 600, 380);
  assert.equal((await save()).connections[direct].end.side, 'top');
  await click('Undo');
  await save();
  saved = await draw([600, 380], [860, 420]);
  const outgoing = Object.keys(saved.connections).find((key) => key !== direct);
  assert.equal(saved.connections[outgoing].ownerId, null);
  assert.equal(saved.connections[outgoing].start.objectId, 'child');
  assert.equal(saved.connections[outgoing].end.objectId, 'b');
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    'PASS direct child connections: cross-container drawing in both directions, visible paint/hits, SVG/PNG, collapse projection, exact expansion restoration, endpoint edits, Undo/Redo and collapsed save/reopen.',
  );

  // A lifted nested container must carry outside routes in their owner's axes,
  // while its own internal routes continue to render exactly once in its group.
  const outer = {
    x: 650,
    y: 420,
    width: 1000,
    height: 650,
    rotation: 20,
    z: 0,
  };
  const inner = { x: -180, y: 0, width: 280, height: 240, rotation: 15, z: 5 };
  const sibling = { x: 220, y: 0, width: 100, height: 80, rotation: 0, z: 0 };
  nested.id = 'nested-drag';
  nested.objects.outer = {
    ...nested.objects.a,
    id: 'outer',
    parentId: null,
    name: 'outer',
    type: 'frame',
    geometry: outer,
    style: { fill: '#ffffff', opacity: 0.6, clipToFrame: true },
  };
  nested.objects.a.parentId = 'outer';
  nested.objects.a.geometry = inner;
  nested.objects.a.style.opacity = 0.5;
  nested.objects.b.parentId = 'outer';
  nested.objects.b.geometry = sibling;
  nested.rootDepths = { outer: 2 };
  nested.layouts = {
    outer: {
      0: { outer },
      1: { outer, a: inner, b: sibling },
      2: { outer, a: inner, b: sibling, child },
    },
  };
  const endpoint = (objectId, side) => ({
    kind: 'object',
    objectId,
    side,
    offset: 0.5,
    binding: 'fixed',
  });
  nested.connections = {
    cross: {
      id: 'cross',
      ownerId: 'outer',
      kind: 'arrow',
      z: 0,
      start: endpoint('b', 'left'),
      end: endpoint('child', 'right'),
      style: { stroke: '#475569', opacity: 0.8 },
    },
    internal: {
      id: 'internal',
      ownerId: 'a',
      kind: 'arrow',
      z: 0,
      start: endpoint('a', 'left'),
      end: endpoint('child', 'left'),
    },
  };
  file = path.join(profile, 'nested-drag.depthplan');
  await writeFile(file, JSON.stringify(nested));
  await dialogs('open', file);
  await click('Menu');
  await click('Open');
  await until(async () => (await state()).source?.path === file);
  await click('Reset view');
  const routes = () =>
    sync(`const stage=window.Konva.stages[0];
    return ['cross','internal'].map(id=>{
      const matches=stage.find('#connection-'+id), group=matches[0], line=group.findOne('.connection-path'), points=line.points();
      const transform=line.getAbsoluteTransform();
      const start=transform.point({x:points[0],y:points[1]}),end=transform.point({x:points.at(-2),y:points.at(-1)});
      const at={x:end.x+(start.x-end.x)*0.2,y:end.y+(start.y-end.y)*0.2};
      stage.getLayers()[0].draw();
      return {count:matches.length,start,end,opacity:group.getAbsoluteOpacity(),hit:stage.getLayers()[0].getIntersection(at)?.findAncestor('.recursive-connection',true)?.id()};
    });`);
  const beforeDrag = await routes();
  await command('depthplan_selection', { action: 'set', objects: ['a'] });
  const grab = await sync(
    `return window.Konva.stages[0].findOne('#object-a').getAbsoluteTransform().point({x:-90,y:-60});`,
  );
  await pointer('mousedown', grab.x, grab.y);
  await pointer('mousemove', grab.x + 20, grab.y, { ctrlKey: true });
  const duringDrag = await routes();
  for (let i = 0; i < duringDrag.length; i++) {
    const before = beforeDrag[i],
      during = duringDrag[i];
    assert.equal(during.count, 1, 'each route paints once');
    assert.equal(
      during.opacity,
      before.opacity,
      'drag retains inherited opacity',
    );
    assert(Math.abs(during.end.x - before.end.x - 20) < 0.001);
    assert(Math.abs(during.end.y - before.end.y) < 0.001);
    assert(
      Math.abs(during.start.x - before.start.x - (i === 0 ? 0 : 20)) < 0.001,
    );
    assert.equal(
      during.hit,
      i === 0 ? 'connection-cross' : 'connection-internal',
    );
  }
  await capture('nested-connector-drag.png');
  await pointer('mouseup', grab.x + 20, grab.y, { ctrlKey: true });
  saved = await save();
  assert.deepEqual(saved.connections, nested.connections);
  await click('Undo');
  assert.deepEqual((await save()).layouts, nested.layouts);
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    'PASS connected-object dragging: arrows stay visible during drag/drop/cancel, nested owner transforms and opacity are preserved, internal routes paint once, saved bindings and Z survive Undo.',
  );
}
