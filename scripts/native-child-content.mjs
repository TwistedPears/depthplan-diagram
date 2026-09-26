import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function childContent(driver, probe) {
  const { sync, js, click, dialogs, until, profile } = driver;
  const state = async () => (await probe.call('depthplan_get_state')).data;
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
    await js(
      'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
    );
  };
  const edit = (...actions) => command('depthplan_edit', { actions });
  const capture = async (name) =>
    writeFile(
      path.join(profile, `${name}.png`),
      Buffer.from(
        await driver.request(
          `/session/${driver.session}/screenshot`,
          undefined,
          'GET',
        ),
        'base64',
      ),
    );
  const open = async (document) => {
    const file = path.join(profile, `${document.id}-content.depthplan`);
    await writeFile(file, JSON.stringify(document));
    await dialogs('open', file);
    await click('Menu');
    await click('Open');
    await until(async () => (await state()).source?.path === file);
  };
  const save = async () => {
    await click('Save document');
    await until(async () => {
      const current = await state();
      return !current.dirty && !current.busyReasons.includes('file-operation');
    });
  };
  const check = async () => {
    const violations = await sync(`
      const stage = window.Konva.stages[0], failures = [];
      for (const toggle of stage.find('.child-stack-toggle')) {
        const owner = toggle.getParent();
        const badge = toggle.findOne('Circle') || toggle.findOne('Rect');
        const box = badge.getClientRect({relativeTo: owner});
        const content = owner.getChildren().flatMap(n => n.hasName('object-label') ? [n] : n.hasName('object-content') ? n.getChildren() : []);
        for (const node of content) {
          const b = node.getClientRect({relativeTo: owner});
          if (b.width > 0 && b.height > 0 && box.x < b.x+b.width && box.x+box.width > b.x && box.y < b.y+b.height && box.y+box.height > b.y)
            failures.push({id:owner.id(), name:node.name(), box, text:b});
        }
        const screen = badge.getClientRect();
        for (const child of owner.find('.recursive-object')) {
          const b = child.findOne('.object-hit-area').getClientRect();
          if (screen.x < b.x+b.width && screen.x+screen.width > b.x && screen.y < b.y+b.height && screen.y+screen.height > b.y)
            failures.push({id:owner.id(), child:child.id(), screen, bounds:b});
        }
        if (badge.getClassName() === 'Circle') {
          const center = badge.getAbsolutePosition();
          const radius = (badge.radius() + badge.strokeWidth()/2) * badge.getAbsoluteScale().x;
          const hit = stage.getIntersection({x:center.x+radius+2, y:center.y});
          if (hit?.findAncestor('.child-stack-toggle', true) === toggle)
            failures.push({id:owner.id(), invisibleHit:true});
        }
      }
      return failures;
    `);
    assert.deepEqual(
      violations,
      [],
      'controls leave text and outside pointer input clear',
    );
  };
  const camera = (scale) =>
    command('depthplan_camera', {
      action: {
        type: 'set',
        camera: { x: 600 - 600 * scale, y: 350 - 350 * scale, scale },
      },
    });
  const g = { x: 600, y: 350, width: 160, height: 100, rotation: 0, z: 0 };
  const child = { x: 0, y: 0, width: 80, height: 40, rotation: 0, z: 0 };
  const document = {
    formatVersion: 2,
    id: 'issue24',
    metadata: {
      title: 'Children control text regression',
      created: '2026-09-25',
      modified: '2026-09-25',
    },
    objects: {
      a: {
        id: 'a',
        parentId: null,
        type: 'rectangle',
        name: 'A very long parent title overlapping the toggle',
        geometry: g,
        content: [
          {
            type: 'paragraph',
            runs: [
              {
                text: 'Full width rich content fills this object and must remain readable. The first line flows beside the icon and the following lines regain the full width of the object.',
              },
            ],
          },
        ],
      },
      b: {
        id: 'b',
        parentId: 'a',
        type: 'rectangle',
        name: 'Child',
        geometry: child,
        content: [],
      },
    },
    rootDepths: { a: 0 },
    layouts: { a: { 0: { a: g }, 1: { a: g, b: child } } },
    connections: {},
  };
  for (const type of ['rectangle', 'ellipse', 'diamond', 'frame']) {
    document.id = `issue24-${type}`;
    document.objects.a.type = type;
    await open(document);
    for (const rotation of [0, 15, 45, 90, 180, -30]) {
      await edit({ type: 'geometry', id: 'a', patch: { rotation } });
      const before = await state();
      for (const scale of [0.25, 0.38, 0.5, 1, 2]) {
        await camera(scale);
        await check();
        if (rotation === 0 && type === 'rectangle')
          assert(
            await sync(
              'return !!window.Konva.stages[0].findOne("#child-toggle-a")',
            ),
            'the ordinary header retains its inline control',
          );
        const after = await state();
        for (const key of ['revision', 'dirty', 'canUndo', 'canRedo'])
          assert.equal(after[key], before[key], `zoom preserves ${key}`);
        if (
          type === 'rectangle' &&
          [0, 90].includes(rotation) &&
          [0.38, 1].includes(scale)
        )
          await capture(`child-text-${rotation}-${scale}`);
        if (type === 'rectangle' && rotation === 0 && scale === 1) {
          const wrap =
            await sync(`const group=window.Konva.stages[0].findOne('#object-a').findOne('.object-content');
            return {top:group.y(), lines:group.find('Text').map(n=>({x:n.x(),y:n.y(),width:n.width()}))};`);
          assert.equal(wrap.top, -22, 'body retains its original top inset');
          assert.equal(wrap.lines[0].y, 0, 'text begins beside the icon');
          assert(
            wrap.lines.some(
              (line) => line.y > 0 && line.width > wrap.lines[0].width + 10,
            ),
            'lower lines use the full width',
          );
          await command('depthplan_selection', {
            action: 'set',
            objects: ['a'],
            connections: [],
          });
          const beforeEdit = await state();
          await click('Edit text');
          const editor =
            await sync(`const body=document.querySelector('.inline-object-text-body'), prose=body.querySelector('.ProseMirror');
            const text=prose.querySelector('p').firstChild, range=document.createRange(), boxes=[];
            for(let i=0;i<text.textContent.length;i++){range.setStart(text,i);range.setEnd(text,i+1);const b=range.getBoundingClientRect();boxes.push({x:b.x,y:b.y,right:b.right});}
            const b=body.getBoundingClientRect();
            return {top:body.style.top, float:getComputedStyle(prose,'::before').float, limit:b.right-parseFloat(body.style.getPropertyValue('--text-wrap-width')), boxes};`);
          assert.equal(editor.top, '28px');
          assert.equal(editor.float, 'right');
          assert(
            editor.boxes
              .filter((b) => b.y === editor.boxes[0].y)
              .every((b) => b.right <= editor.limit + 1),
            'editor wraps beside the icon',
          );
          assert(
            editor.boxes.some(
              (b) => b.y > editor.boxes[0].y && b.right > editor.limit + 4,
            ),
            'editor restores full width below the icon',
          );
          await capture('child-text-inline-wrap');
          await sync(
            `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`,
          );
          await until(() =>
            sync('return !document.querySelector(".inline-object-text")'),
          );
          assert.equal(
            (await state()).revision,
            beforeEdit.revision,
            'wrapping never edits the rich content',
          );
          await command('depthplan_selection', { action: 'clear' });
        }
      }
    }
    await save();
  }
  await edit({ type: 'geometry', id: 'a', patch: { rotation: 90 } });
  await camera(1);
  assert.equal(
    await sync('return !!window.Konva.stages[0].findOne("#child-toggle-a")'),
    false,
    'a rotated rich-content collision uses the selection fallback',
  );
  // Unnamed rich content starts at the original inset and flows around the icon.
  await edit({ type: 'edit_object', id: 'a', name: '' });
  await camera(1);
  await check();
  await command('depthplan_selection', {
    action: 'set',
    objects: ['a'],
    connections: [],
  });
  for (const action of ['Reveal', 'Hide']) {
    await click(`${action} 1 child`);
    await until(() => sync('return window.Konva.stages[0].listening()'));
    await check();
  }
  // Keyboard-accessible fallback also accepts the macOS Ctrl-click event.
  await sync(
    `document.querySelector('[aria-label="Reveal 1 child"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,ctrlKey:true}));`,
  );
  await edit({
    type: 'geometry',
    id: 'a',
    patch: { width: 36, height: 36, rotation: 45 },
  });
  await check();
  await save();

  const nested = structuredClone(document);
  nested.id = 'issue24-nested';
  const parent = { ...g, width: 600, height: 400, rotation: 30 };
  nested.objects.parent = {
    ...nested.objects.b,
    id: 'parent',
    parentId: null,
    name: '',
    geometry: parent,
  };
  nested.objects.a.parentId = 'parent';
  nested.objects.a.geometry = { ...g, x: 0, y: 0 };
  nested.rootDepths = { parent: 1 };
  nested.layouts = {
    parent: {
      0: { parent },
      1: { parent, a: nested.objects.a.geometry },
      2: { parent, a: nested.objects.a.geometry, b: child },
    },
  };
  await open(nested);
  for (const expanded of [false, true]) {
    await edit({ type: 'children', id: 'a', expanded });
    await until(() => sync('return window.Konva.stages[0].listening()'));
    for (const rotation of [0, 15, 45, 90, 180, -30]) {
      await edit({ type: 'geometry', id: 'a', patch: { rotation } });
      for (const scale of [0.38, 1]) {
        await camera(scale);
        await check();
      }
    }
  }
  await save();

  // Stored tour layouts stay untouched and their child cards win hit testing.
  const tour = JSON.parse(
    await readFile('docs/sample/depthplan_application_tour.depthplan', 'utf8'),
  );
  await open(tour);
  await command('depthplan_bookmarks', {
    action: { type: 'apply', id: 'modules' },
  });
  await check();
  await capture('child-content-tour-038');
  await save();
  console.log(
    `PASS children content: canvas/editor text wrapping, long/unnamed titles, four shapes, six rotations, five zooms, shrinking hit area, selection fallback and tour bookmark. Evidence: ${profile}`,
  );
}
