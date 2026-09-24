import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run inside smoke's isolated native profile and live MCP session.
export async function layering(driver, probe) {
  const { sync, js, click, dialogs, until, profile } = driver;
  const state = async () => {
    const reply = await probe.call('depthplan_get_state');
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply.data;
  };
  const select = async (objects, connections) => {
    const current = await state();
    const reply = await probe.call('depthplan_selection', {
      handle: current.handle,
      expectedRevision: current.revision,
      expectedViewRevision: current.viewRevision,
      requestId: crypto.randomUUID(),
      action: 'set',
      objects,
      connections,
    });
    assert.equal(reply.ok, true, JSON.stringify(reply));
  };
  const document = {
    formatVersion: 2,
    id: 'layering',
    metadata: {
      title: 'Layering',
      created: '2026-09-23',
      modified: '2026-09-23',
    },
    objects: {},
    rootDepths: {},
    layouts: {},
    connections: {},
  };
  for (const [id, parentId, x, y, width, height] of [
    ['backdrop', null, 400, 300, 200, 140],
    ['left', null, 180, 320, 60, 60],
    ['right', null, 620, 320, 60, 60],
    ['frame', null, 900, 300, 200, 160],
    ['child', 'frame', 0, 0, 100, 100],
  ]) {
    const geometry = { x, y, width, height, z: 0, rotation: 0 };
    document.objects[id] = {
      id,
      parentId,
      type: id === 'frame' ? 'frame' : 'rectangle',
      name: '',
      content: [],
      geometry,
      style: { fill: '#0000ff', strokeWidth: 0, clipToFrame: id === 'frame' },
    };
    if (parentId === null) {
      document.rootDepths[id] = id === 'frame' ? 1 : 0;
      document.layouts[id] = {
        0: { [id]: geometry },
        [document.rootDepths[id]]: { [id]: geometry },
      };
    } else document.layouts[parentId][1][id] = geometry;
  }
  document.connections.line = {
    id: 'line',
    ownerId: null,
    kind: 'line',
    z: 0,
    start: { kind: 'free', x: 280, y: 280 },
    end: { kind: 'free', x: 520, y: 280 },
    style: { stroke: '#ff0000', strokeWidth: 8 },
  };
  document.connections.arrow = {
    id: 'arrow',
    ownerId: null,
    kind: 'arrow',
    z: 0,
    start: { kind: 'object', objectId: 'left', side: 'right', offset: 0.5 },
    end: { kind: 'object', objectId: 'right', side: 'left', offset: 0.5 },
    style: { stroke: '#00ff00', strokeWidth: 8, arrowheadEnd: 'triangle' },
  };
  document.connections.inner = {
    ...document.connections.line,
    id: 'inner',
    ownerId: 'frame',
    start: { kind: 'free', x: -60, y: 0 },
    end: { kind: 'free', x: 60, y: 0 },
  };
  const target = path.join(profile, 'layering.depthplan.json');
  await writeFile(target, JSON.stringify(document));
  await dialogs('open', target);
  await click('Menu');
  await click('Open');
  await until(async () => (await state()).source?.path === target);
  await click('Reset view');

  // Inspect only the committed drawing layer, excluding selection handles.
  const painted = (x, y) =>
    sync(
      `
    const s=window.Konva.stages[0], l=s.getLayers()[0];
    const p=s.getAbsoluteTransform().point({x:arguments[0],y:arguments[1]});
    l.draw();
    const hit=l.getIntersection(p)?.findAncestor('.recursive-object, .recursive-connection',true)?.id();
    const c=l.toCanvas({x:p.x-1,y:p.y-1,width:3,height:3,pixelRatio:1});
    const pixel=Array.from(c.getContext('2d').getImageData(1,1,1,1).data);
    c.width=0;return {hit,pixel};`,
      [x, y],
    );
  const expectPaint = async (x, y, hit, pixel) => {
    await until(async () => (await painted(x, y)).hit === hit);
    assert.deepEqual(await painted(x, y), { hit, pixel });
  };
  const blue = [0, 0, 255, 255],
    red = [255, 0, 0, 255],
    green = [0, 255, 0, 255];
  await expectPaint(430, 280, 'object-backdrop', blue);
  await select([], ['line']);
  await click('Bring to front');
  await expectPaint(430, 280, 'connection-line', red);
  await click('Undo');
  await expectPaint(430, 280, 'object-backdrop', blue);
  await click('Redo');
  await expectPaint(430, 280, 'connection-line', red);
  await click('Send to back');
  await expectPaint(430, 280, 'object-backdrop', blue);

  // Numeric Z edits on an attached arrow leave endpoint bindings untouched.
  await select([], ['arrow']);
  await click('Properties');
  await sync(
    `const input=document.querySelector('input[name=z]');input.value='20';input.dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await click('Apply');
  await expectPaint(430, 320, 'connection-arrow', green);
  await select([], ['inner']);
  await click('Bring to front');
  await expectPaint(900, 300, 'connection-inner', red);

  // The toolbar's layer actions accept mixed selections while alignment stays disabled.
  await select(['backdrop'], ['line']);
  await click('Arrange selection');
  assert.equal(
    await sync(
      'return document.querySelector(`[aria-label="Align left"]`).disabled',
    ),
    true,
  );
  assert.equal(
    await sync(
      'return document.querySelector(`[title="Bring to Front"]`).disabled',
    ),
    false,
  );
  await click('Bring to Front');
  await expectPaint(430, 320, 'object-backdrop', blue);
  await select([], ['arrow']);
  await click('Arrange selection');
  await click('Bring to Front');
  await select([], ['line']);
  await click('Bring to front');
  await expectPaint(430, 280, 'connection-line', red);
  await expectPaint(430, 320, 'connection-arrow', green);

  await click('Save document');
  await until(async () => !(await state()).dirty);
  const saved = JSON.parse(await readFile(target, 'utf8'));
  for (const id of ['line', 'arrow', 'inner'])
    assert.deepEqual(saved.connections[id], {
      ...document.connections[id],
      z: saved.connections[id].z,
    });
  await dialogs('open', target);
  await click('Menu');
  await click('Open');
  await until(async () => !(await state()).canUndo);
  await expectPaint(430, 280, 'connection-line', red);
  await expectPaint(430, 320, 'connection-arrow', green);
  await expectPaint(900, 300, 'connection-inner', red);

  // Camera-only renders must update culling even when diagram paint is memoized.
  const checkCulling = async () => {
    const result =
      await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const stage=window.Konva.stages[0],layer=stage.getLayers()[0];
      const culled=layer.find('Shape').filter(n=>n.getAttr('viewportCulled'));
      const pixels=()=>{
        const canvas=layer.toCanvas({x:0,y:0,width:stage.width(),height:stage.height(),pixelRatio:1});
        const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        canvas.width=0;return data;
      };
      const actual=pixels();let differences=0;
      try {
        culled.forEach(n=>n.visible(true));
        const reference=pixels();
        for(let i=0;i<actual.length;i++)if(actual[i]!==reference[i])differences++;
      } finally {culled.forEach(n=>n.visible(false));}
      resolve({differences,culled:culled.length});
    })))`);
    assert.equal(result.differences, 0, 'Culled paint matches unculled pixels');
    return result.culled;
  };
  // Exercise shared native clip bounds with a rotated ancestor, then restore it.
  await sync("window.Konva.stages[0].findOne('#object-frame').rotation(27)");
  await click('Zoom in');
  await checkCulling();
  for (let i = 0; i < 3; i++) {
    await driver.drag(900, 600, -400, 0);
    await checkCulling();
  }
  assert((await checkCulling()) > 0, 'Pan exercises offscreen culling');
  await sync("window.Konva.stages[0].findOne('#object-frame').rotation(0)");
  await click('Reset view');
  await checkCulling();
  await expectPaint(430, 280, 'connection-line', red);
  await expectPaint(430, 320, 'connection-arrow', green);

  for (const format of ['svg', 'png']) {
    const file = path.join(profile, `layering.${format}`);
    await click('Export current diagram');
    await sync(
      `const s=document.querySelector('select[aria-label="Format"]');s.value=arguments[0];s.dispatchEvent(new Event('change',{bubbles:true}));`,
      [format],
    );
    await dialogs('save', file);
    await click('Export');
    let bytes;
    await until(async () => {
      try {
        bytes = await readFile(file);
        return bytes.length > 100;
      } catch {
        return false;
      }
    });
    // Both formats must retain the same overlap colors after their 16px export padding.
    // Leftmost/topmost ink is (150, 220), set by the left shape and outer frame.
    const pixels = await js(
      `(async()=>{
      const image=new Image();image.src=arguments[0];await image.decode();
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
      return [[430,280],[430,320],[900,300]].map(([x,y])=>Array.from(ctx.getImageData(x-150+16,y-220+16,1,1).data));
    })()`,
      [
        `data:image/${format === 'svg' ? 'svg+xml' : 'png'};base64,${bytes.toString('base64')}`,
      ],
    );
    assert.deepEqual(pixels, [red, green, red], `${format} layer order`);
  }
  const screenshot = await driver.request(
    `/session/${driver.session}/screenshot`,
    undefined,
    'GET',
  );
  await writeFile(
    path.join(profile, 'layering-screen.png'),
    Buffer.from(screenshot, 'base64'),
  );
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    'PASS connection layering: UI Z, layers, mixed toolbar, nested/rotated clipping, culled/reference pixels across pan/zoom, hits, Undo/Redo, reopen, SVG/PNG.',
  );
}
