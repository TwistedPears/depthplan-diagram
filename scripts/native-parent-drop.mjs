import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function parentDrop(driver, probe) {
  const { sync, js, click, dialogs, until, profile } = driver;
  const state = async () => {
    const reply = await probe.call('depthplan_get_state');
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply.data;
  };
  const paint = () =>
    js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const hold = (ms) => js('new Promise(r=>setTimeout(r,arguments[0]))', [ms]);
  const pointer = async (type, point, ctrlKey = false) => {
    await sync(
      `const [type,p,ctrlKey]=arguments;
      document.elementFromPoint(p.x,p.y).dispatchEvent(new MouseEvent(type, {
        bubbles:true,cancelable:true,clientX:p.x,clientY:p.y,button:0,
        buttons:type==='mouseup'?0:1,ctrlKey
      }));`,
      [type, point, ctrlKey],
    );
    await paint();
  };
  const visible = (id) =>
    sync(`return !!window.Konva.stages[0].findOne('#object-'+arguments[0]);`, [
      id,
    ]);
  const point = (id, x = 0, y = 0) =>
    sync(
      `const n=window.Konva.stages[0].findOne('#object-'+arguments[0]);
    return n.getAbsoluteTransform().point({x:arguments[1]*n.width(),y:arguments[2]*n.height()});`,
      [id, x, y],
    );
  const at = async (id, expected) => {
    const actual = await point(id);
    assert(
      Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1,
      `${id}: ${JSON.stringify({ actual, expected })}`,
    );
  };
  let file,
    sequence = 0;
  const open = async ({
    empty = false,
    fold = false,
    rotation = 0,
    scale = 1,
  } = {}) => {
    const document = {
      formatVersion: 2,
      id: `parent-drop-${++sequence}`,
      metadata: {
        title: 'Parent drop',
        created: '2026-09-28',
        modified: '2026-09-28',
      },
      objects: {},
      layouts: {},
      rootDepths: {},
      connections: {},
    };
    for (const [id, parentId, x, y, width, height] of [
      ['mover', null, 440, 350, 60, 40],
      ['target', null, 850, 350, 300, 260],
      ...(!empty
        ? [
            ['child', 'target', -50, 0, 100, 80],
            ['grandchild', 'child', 0, 0, 40, 30],
          ]
        : []),
    ]) {
      const geometry = {
        x,
        y,
        width,
        height,
        rotation: id === 'target' ? rotation : 0,
        z: 0,
      };
      document.objects[id] = {
        id,
        parentId,
        type: 'rectangle',
        name: id,
        content: [],
        geometry,
        style: { fill: '#ffffff' },
      };
      if (parentId === null) {
        document.rootDepths[id] = 0;
        document.layouts[id] = { 0: { [id]: geometry } };
      }
    }
    if (!empty) {
      document.layouts.target[1] = {
        target: document.objects.target.geometry,
        child: document.objects.child.geometry,
      };
      document.layouts.target[2] = {
        ...document.layouts.target[1],
        grandchild: document.objects.grandchild.geometry,
      };
      if (fold) {
        document.rootDepths.target = 1;
        document.extensions = { collapsedObjects: ['target'] };
      }
    }
    file = path.join(profile, `${document.id}.depthplan`);
    await writeFile(file, JSON.stringify(document));
    await dialogs('open', file);
    await click('Menu');
    await click('Open Board…');
    await until(async () => (await state()).source?.path === file);
    const current = await state();
    const reply = await probe.call('depthplan_camera', {
      handle: current.handle,
      expectedRevision: current.revision,
      expectedViewRevision: current.viewRevision,
      requestId: crypto.randomUUID(),
      action: {
        type: 'set',
        camera: { x: 650 - 650 * scale, y: 350 - 350 * scale, scale },
      },
    });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    await paint();
    return document;
  };
  const save = async () => {
    await click('Save document');
    await until(async () => !(await state()).dirty);
    return JSON.parse(await readFile(file, 'utf8'));
  };

  // First-child adoption is immediate, including a release before the 400ms dwell.
  await open({ empty: true });
  let start = await point('mover'),
    end = await point('target', 0.2, 0.1);
  let revision = (await state()).revision;
  await pointer('mousedown', start);
  await pointer('mousemove', end);
  await pointer('mouseup', end);
  let saved = await save();
  assert.equal(saved.objects.mover.parentId, 'target');
  assert.equal(saved.rootDepths.target, 1);
  assert(await visible('mover'));
  await at('mover', end);
  assert.equal((await state()).revision, revision + 1);
  await click('Undo');
  assert.equal((await save()).objects.mover.parentId, null);
  await click('Redo');
  assert.equal((await save()).objects.mover.parentId, 'target');

  // Depth-hidden and explicitly folded parents open while the pointer is stationary.
  for (const options of [{}, { fold: true, rotation: 37, scale: 0.75 }]) {
    await open(options);
    start = await point('mover');
    end = await point('target', 0.3, 0.3);
    revision = (await state()).revision;
    await pointer('mousedown', start);
    await pointer('mousemove', end);
    await hold(500);
    assert.equal(await visible('child'), false, 'short hover does not reveal');
    await until(() => visible('child'));
    assert.equal(
      (await state()).revision,
      revision,
      'reveal is only a preview',
    );
    await at('mover', end);
    assert.equal(await visible('grandchild'), false, 'reveal one level');
    end = await point('target', 0.35, 0.35);
    await pointer('mousemove', end);
    await until(() =>
      sync(
        `return document.querySelector('.parent-drop-hint')?.textContent.includes('Move into target');`,
      ),
    );
    const bytes = await driver.request(
      `/session/${driver.session}/screenshot`,
      undefined,
      'GET',
    );
    await writeFile(
      path.join(profile, `parent-drop-${sequence}.png`),
      Buffer.from(bytes, 'base64'),
    );
    await pointer('mouseup', end);
    saved = await save();
    assert.equal(saved.objects.mover.parentId, 'target');
    assert(await visible('child'));
    assert(await visible('mover'));
    await at('mover', end);
    assert.equal((await state()).revision, revision + 1);
    await click('Undo');
    assert.equal(await visible('child'), false);
    assert.equal((await save()).objects.mover.parentId, null);
    await click('Redo');
    await save();
    assert(await visible('child'));
    await at('mover', end);
    await dialogs('open', file);
    await click('Menu');
    await click('Open Board…');
    await until(async () => !(await state()).canUndo);
    assert(await visible('child'));
    assert(await visible('mover'));
  }

  // A newly revealed child can itself open and accept the held object.
  await open();
  start = await point('mover');
  end = await point('target', 0.3, 0.3);
  await pointer('mousedown', start);
  await pointer('mousemove', end);
  await until(() => visible('child'));
  end = await point('child', 0.3, 0.3);
  await pointer('mousemove', end);
  await until(() => visible('grandchild'));
  end = await point('child', 0.35, 0.35);
  await pointer('mousemove', end);
  await until(() =>
    sync(
      `return document.querySelector('.parent-drop-hint')?.textContent.includes('Move into child');`,
    ),
  );
  await pointer('mouseup', end);
  assert.equal((await save()).objects.mover.parentId, 'child');
  assert(await visible('grandchild'));
  await at('mover', end);

  // Leaving or pressing Ctrl clears pending timers. Cancellation discards opened previews.
  for (const cancel of ['leave', 'Control', 'Escape', 'blur']) {
    await open();
    start = await point('mover');
    end = await point('target', 0.3, 0.3);
    revision = (await state()).revision;
    await pointer('mousedown', start);
    await pointer('mousemove', end);
    if (cancel === 'leave') {
      await hold(500);
      await pointer('mousemove', start);
    } else if (cancel === 'Control') {
      await hold(500);
      await sync(
        `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',ctrlKey:true,bubbles:true}));`,
      );
    } else {
      await until(() => visible('child'));
      await sync(
        `window.dispatchEvent(arguments[0]==='Escape'?new KeyboardEvent('keydown',{key:'Escape',bubbles:true}):new Event('blur'));`,
        [cancel],
      );
    }
    await hold(1100);
    assert.equal(await visible('child'), false, `${cancel} cancels reveal`);
    assert.equal((await state()).revision, revision);
    await pointer(
      'mouseup',
      cancel === 'leave' ? start : end,
      cancel === 'Control',
    );
    if (cancel === 'Control')
      await sync(
        `window.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',bubbles:true}));`,
      );
    assert.equal((await save()).objects.mover.parentId, null);
  }
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    'PASS parent drop: immediate first child, stationary long-hover reveal, rotated/zoomed and nested targets, precise placement, one-step Undo/Redo, persistence, leave/Ctrl/Escape/blur cancellation.',
  );
}
