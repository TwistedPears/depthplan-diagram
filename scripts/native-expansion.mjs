import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function expansion(driver, probe) {
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
  const document = {
    formatVersion: 2,
    id: 'expansion',
    metadata: {
      title: 'Expansion',
      created: '2026-09-23',
      modified: '2026-09-23',
    },
    objects: {},
    rootDepths: {},
    layouts: {},
    connections: {},
  };
  for (const [id, parentId, x, y] of [
    ['a', null, 400, 350],
    ['b', null, 550, 350],
    ['a1', 'a', 0, 0],
    ['a2', 'a', 0, 0],
    ['b1', 'b', 0, 0],
    ['b2', 'b', 0, 0],
    ['deep', 'a1', 25, 0],
  ]) {
    const geometry = { x, y, width: 120, height: 80, rotation: 0, z: 0 };
    document.objects[id] = {
      id,
      parentId,
      name: id,
      type: 'rectangle',
      geometry,
      content: [],
      style: { fill: '#dbeafe', strokeWidth: 0 },
    };
    if (parentId === null) {
      document.rootDepths[id] = 0;
      document.layouts[id] = {
        0: { [id]: { ...geometry } },
        1: { [id]: { ...geometry } },
        2: { [id]: { ...geometry } },
      };
    } else {
      const root = id === 'deep' ? 'a' : parentId;
      for (const depth of id === 'deep' ? [2] : [1, 2])
        document.layouts[root][depth][id] = { ...geometry };
    }
  }
  document.connections.arrow = {
    id: 'arrow',
    kind: 'arrow',
    ownerId: null,
    z: 11,
    start: { kind: 'object', objectId: 'a', side: 'right', offset: 0.5 },
    end: { kind: 'object', objectId: 'b', side: 'left', offset: 0.5 },
  };
  const target = path.join(profile, 'expansion.depthplan.json');
  await writeFile(target, JSON.stringify(document));
  await dialogs('open', target);
  await click('Menu');
  await click('Open');
  await until(async () => (await state()).source?.path === target);
  await click('Reset view');
  const save = async () => {
    await click('Save document');
    // Dirty clears before recovery cleanup releases the file-operation lock.
    await until(async () => {
      const current = await state();
      return !current.dirty && !current.busyReasons.includes('file-operation');
    });
    return JSON.parse(await readFile(target, 'utf8'));
  };
  const placements = (d) =>
    Object.fromEntries(
      Object.entries(d.rootDepths).flatMap(([root, depth]) =>
        Object.entries(d.layouts[root][depth]).map(
          ([id, { x, y, width, height }]) => [id, { x, y, width, height }],
        ),
      ),
    );
  const rootGeometry = (d, id) => d.layouts[id][d.rootDepths[id]][id];
  const before = await state();
  // Sample real canvas frames, including outlines and bound endpoints, during opening.
  await sync(`
    window.expansionFrames = [];
    window.expansionSampleDone = false;
    const started = performance.now();
    const sample = () => {
      const stage = window.Konva.stages[0];
      const a = stage.findOne('#object-a');
      const b = stage.findOne('#object-b');
      window.expansionFrames.push({
        width: a.width(), height: a.height(), x: a.x(), bx: b.x(), bw: b.width(),
        points: stage.findOne('#connection-arrow').findOne('.connection-path').points(),
        listening: stage.listening()
      });
      if (performance.now() - started < 650) requestAnimationFrame(sample);
      else window.expansionSampleDone = true;
    };
    requestAnimationFrame(sample);
  `);
  await click('Reveal children of a');
  await until(async () => (await state()).revision === before.revision + 1);
  const open = await save();
  assert(rootGeometry(open, 'a').width > 120);
  assert(rootGeometry(open, 'a').height > 80);
  assert(rootGeometry(open, 'b').x > 550);
  await until(() => sync('return window.expansionSampleDone'));
  const frames = await sync('return window.expansionFrames');
  const finalWidth = rootGeometry(open, 'a').width;
  if (
    !(await sync(
      'return matchMedia("(prefers-reduced-motion: reduce)").matches',
    ))
  ) {
    assert(
      frames.some((frame) => frame.width > 120 && frame.width < finalWidth),
      'intermediate growth',
    );
    assert(
      frames.some((frame) => frame.width > finalWidth),
      'spring overshoot',
    );
    assert(
      frames.some((frame) => !frame.listening),
      'transient geometry cannot be dragged',
    );
  }
  for (const frame of frames) {
    assert(
      Math.abs(frame.points[0] - frame.x - frame.width / 2) < 1e-6,
      'arrow follows growing parent',
    );
    assert(
      Math.abs(frame.points.at(-2) - frame.bx + frame.bw / 2) < 1e-6,
      'arrow follows displaced neighbor',
    );
  }
  assert.equal(frames.at(-1).width, finalWidth);
  assert.equal(frames.at(-1).listening, true);
  assert.equal(
    await sync(
      `return window.Konva.stages[0].findOne('#object-a').findOne('.object-hit-area').height()`,
    ),
    rootGeometry(open, 'a').height,
  );
  await click('Undo');
  const undone = await save();
  assert.deepEqual(undone.layouts, document.layouts);
  assert.equal(undone.extensions?.expansionLayouts, undefined);
  await click('Redo');
  // Export during motion must capture the exact committed geometry.
  await click('Export current diagram');
  assert.equal(
    await sync(`return window.Konva.stages[0].findOne('#object-a').width()`),
    finalWidth,
  );
  await click('Cancel');
  assert.deepEqual(placements(await save()), placements(open));

  // Selection disclosure and MCP children edits share the same transition.
  await select('a1');
  await click('Reveal 1 child');
  const nested = await save();
  assert(nested.layouts.a[2].a1.width > open.layouts.a[1].a1.width);
  assert(rootGeometry(nested, 'a').width > rootGeometry(open, 'a').width);
  await click('Hide children of a');
  await save();
  await dialogs('open', target);
  await click('Menu');
  await click('Open');
  await until(async () => !(await state()).canUndo);
  await click('Reveal children of a');
  assert.deepEqual(placements(await save()), placements(nested));
  assert(await sync(`return !!window.Konva.stages[0].findOne('#object-deep')`));
  for (const event of ['click', 'contextmenu']) {
    // macOS uses contextmenu for Ctrl-click; other platforms use click.
    const revision = (await state()).revision;
    await sync(
      `document.querySelector('[aria-label="Hide children of a"]').dispatchEvent(new MouseEvent(arguments[0], {bubbles:true, cancelable:true, ctrlKey:true}));`,
      [event],
    );
    assert.equal((await state()).revision, revision + 1);
    const allCollapsed = await save();
    assert(allCollapsed.extensions.collapsedObjects.includes('a1'));
    await click('Undo');
    assert.deepEqual(placements(await save()), placements(nested));
    await click('Redo');
    assert.deepEqual(placements(await save()), placements(allCollapsed));
    await click('Reveal children of a');
    await save();
    assert.equal(
      await sync(`return !!window.Konva.stages[0].findOne('#object-deep')`),
      false,
    );
    await click('Reveal children of a1');
    assert.deepEqual(placements(await save()), placements(nested));
  }
  await select('a1');
  await click('Hide 1 child');
  const back = await save();
  for (const [id, g] of Object.entries(placements(open)))
    assert.deepEqual(placements(back)[id], g);
  await edit(
    { type: 'geometry', id: 'a', patch: { x: 380, width: 420 } },
    { type: 'geometry', id: 'a1', patch: { y: 180 } },
  );
  const manual = await save();
  await select('a');
  await click('Hide 2 children');
  const closed = await save();
  assert.deepEqual(rootGeometry(closed, 'a'), document.layouts.a[0].a);
  assert.deepEqual(rootGeometry(closed, 'b'), document.layouts.b[0].b);
  await dialogs('open', target);
  await click('Menu');
  await click('Open');
  await until(async () => !(await state()).canUndo);
  await edit({ type: 'children', id: 'a', expanded: true });
  assert.deepEqual(placements(await save()), placements(manual));
  await edit({ type: 'children', id: 'b', expanded: true });
  const both = await save();
  await edit({ type: 'children', id: 'a', expanded: false });
  const onlyB = await save();
  assert.equal(rootGeometry(onlyB, 'a').width, 120);
  await edit({ type: 'children', id: 'a', expanded: true });
  const restored = await save();
  assert.deepEqual(placements(restored), placements(both));
  assert.deepEqual(restored.connections, document.connections);
  assert.equal(Object.keys(restored.namedViews ?? {}).length, 0);

  const exportImage = async (file, format) => {
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
    return bytes;
  };

  // Both export formats paint the enlarged physical outline.
  for (const format of ['svg', 'png']) {
    const file = path.join(profile, `expansion.${format}`);
    const bytes = await exportImage(file, format);
    const dimensions = await js(
      `(async()=>{const image=new Image();image.src=arguments[0];await image.decode();return [image.width,image.height]})()`,
      [
        `data:image/${format === 'svg' ? 'svg+xml' : 'png'};base64,${bytes.toString('base64')}`,
      ],
    );
    assert(dimensions[0] >= rootGeometry(restored, 'a').width);
    assert(dimensions[1] >= rootGeometry(restored, 'a').height);
  }

  // All imported assets are usable themed symbols, including the two stack badges.
  const bible = JSON.parse(
    await readFile(
      'docs/design/DepthPlan Style Popup Icon Prompt Bible.json',
      'utf8',
    ),
  );
  const icons = bible.assets.map(
    (asset) => asset.summary.match(/Target SVG: (.*?)\.svg/)[1],
  );
  icons.push('square-stack-2', 'square-stack-3');
  assert.equal(icons.length, 46);
  assert.deepEqual(
    await sync(
      `return arguments[0].filter(name => {
    const symbol = document.getElementById('icon-' + name);
    return !symbol || symbol.tagName !== 'symbol' || symbol.querySelector('[id], [fill^="#"], [stroke^="#"]');
  })`,
      [icons],
    ),
    [],
  );
  const badge = (name) =>
    sync(
      `const b=document.querySelector('.child-stack-toggle[aria-label="'+arguments[0]+'"]');
    return b && {icon:b.querySelector('use').getAttribute('href'), expanded:b.getAttribute('aria-expanded'), text:b.textContent.trim()}`,
      [name],
    );
  await click('Deselect');
  assert.deepEqual(await badge('Hide children of a'), {
    icon: '#icon-square-stack-3',
    expanded: 'true',
    text: '',
  });
  assert.deepEqual(await badge('Reveal children of a1'), {
    icon: '#icon-square-stack-2',
    expanded: 'false',
    text: '',
  });
  assert.equal(
    await sync('return document.querySelectorAll(".child-disclosure").length'),
    0,
  );
  await click('Hide children of a');
  await until(async () => !!(await badge('Reveal children of a')));
  assert.equal(await badge('Reveal children of a1'), null);
  await click('Reveal children of a');
  await until(async () => !!(await badge('Reveal children of a1')));
  await edit({ type: 'delete', objects: ['a2'] });
  assert.equal(
    (await badge('Hide children of a')).icon,
    '#icon-square-stack-3',
    'one child with descendants uses three stacks',
  );
  await click('Undo');

  await select('a1');
  await click('Duplicate');
  const duplicated = await save();
  const copies = Object.keys(duplicated.objects).filter(
    (id) => !restored.objects[id],
  );
  assert.equal(copies.length, 2, 'duplicate includes hidden descendants');
  const copy = copies.find((id) => duplicated.objects[id].name === 'a1');
  assert.equal(duplicated.objects[copy].parentId, 'a');
  assert(copies.some((id) => duplicated.objects[id].parentId === copy));
  await click('Undo');
  assert.deepEqual(placements(await save()), placements(restored));

  const clipboardBefore = await driver
    .native('clipboard:read-text')
    .catch(() => '');
  const shortcut = (key, modifier = 'ctrlKey') =>
    sync(
      `window.dispatchEvent(new KeyboardEvent('keydown', {key:arguments[0], [arguments[1]]:true, bubbles:true, cancelable:true}));`,
      [key, modifier],
    );
  try {
    await select('a1');
    const copiedRevision = (await state()).revision;
    await shortcut('c');
    await until(async () =>
      (await driver.native('clipboard:read-text')).startsWith(
        'DepthPlan clipboard v1\n',
      ),
    );
    assert.equal(
      (await state()).revision,
      copiedRevision,
      'copy does not edit the document',
    );
    await edit({ type: 'edit_object', id: 'a1', name: 'Changed after copy' });
    for (const [index, modifier] of ['ctrlKey', 'metaKey'].entries()) {
      const revision = (await state()).revision;
      const beforePaste = await save();
      await shortcut('v', modifier);
      await until(async () => (await state()).revision === revision + 1);
      const pasted = await save();
      const ids = Object.keys(pasted.objects).filter(
        (id) => !beforePaste.objects[id],
      );
      assert.equal(ids.length, 2, 'paste includes hidden descendants');
      const id = ids.find((id) => pasted.objects[id].name === 'a1');
      assert(id, 'paste uses the copied name, not later edits');
      assert.equal(pasted.objects[id].parentId, 'a');
      const layout = pasted.layouts.a[pasted.rootDepths.a];
      assert.equal(
        layout[id].x,
        restored.layouts.a[restored.rootDepths.a].a1.x + 24 * (index + 1),
      );
      assert.equal(
        layout[id].y,
        restored.layouts.a[restored.rootDepths.a].a1.y + 24 * (index + 1),
      );
      assert(ids.some((child) => pasted.objects[child].parentId === id));
    }
    await click('Undo');
    await click('Undo');
    await click('Undo');
    assert.deepEqual(placements(await save()), placements(restored));
    await driver.native('clipboard:write-text', 'ordinary clipboard text');
    const revision = (await state()).revision;
    await shortcut('v');
    // Await the queued native read before inspecting the unchanged document.
    await js(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    );
    assert.equal((await state()).revision, revision);
  } finally {
    await driver.native('clipboard:write-text', clipboardBefore);
  }

  await select('b1');
  const actionButtons = await sync(
    `return [...document.querySelectorAll('.selection-actions > button')].map(b => ({name:b.getAttribute('aria-label'), title:b.title, text:b.textContent.trim(), icon:b.querySelector('use')?.getAttribute('href')}))`,
  );
  assert(actionButtons.length >= 8);
  for (const button of actionButtons)
    assert(
      button.name && button.title && button.icon && !button.text,
      JSON.stringify(button),
    );
  await click('Link');
  await sync(`const el=document.querySelector('[aria-label="Item link URL"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'https://example.com/diagram');
    el.dispatchEvent(new Event('input',{bubbles:true}));`);
  await click('Save link');
  await click('Background: Blue');
  await click('Rounded corners');
  await click('Hachure fill');
  await click('Cross hatch fill');
  const styled = await save();
  assert.equal(styled.objects.b1.style.link, 'https://example.com/diagram');
  assert.equal(styled.objects.b1.style.cornerRadius, 12);
  assert.equal(styled.objects.b1.style.fillType, 'cross-hatch');
  const pattern =
    await sync(`const s=window.Konva.stages[0].findOne('#object-b1').findOne('.object-hit-area');
    const tile=s.fillPatternImage();const alpha=[...tile.getContext('2d').getImageData(0,0,12,12).data].filter((_,i)=>i%4===3);
    return {radius:s.cornerRadius(), pattern:s.fillPriority(), ink:alpha.some(a=>a>0), gaps:alpha.some(a=>a===0)};`);
  assert.deepEqual(pattern, {
    radius: 12,
    pattern: 'pattern',
    ink: true,
    gaps: true,
  });
  const screenshot = async (name) => {
    const data = await driver.request(
      `/session/${driver.session}/screenshot`,
      undefined,
      'GET',
    );
    await writeFile(path.join(profile, name), Buffer.from(data, 'base64'));
  };
  assert.equal(
    await sync(
      `return new Set(['Thin stroke','Medium stroke','Thick stroke'].map(name => document.querySelector('[aria-label="'+name+'"]').getBoundingClientRect().top)).size`,
    ),
    1,
    'stroke widths stay on one row',
  );
  await screenshot('style-icons-shape-screen.png');
  await sync(
    `const panel=document.getElementById('selection-controls');panel.scrollTop=panel.scrollHeight;`,
  );
  await screenshot('style-icons-actions-screen.png');
  await sync(`document.getElementById('selection-controls').scrollTop=0;`);
  for (const format of ['svg', 'png']) {
    const file = path.join(profile, `style-hatch.${format}`);
    const bytes = await exportImage(file, format);
    if (format === 'svg') {
      assert.match(bytes.toString(), /<pattern/);
      assert.match(bytes.toString(), /fill="url\(#hatch-/);
    }
    const colors = await js(
      `(async()=>{const i=new Image();i.src=arguments[0];await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);const p=x.getImageData(0,0,c.width,c.height).data;let blue=0,white=0;for(let n=0;n<p.length;n+=4){if(p[n]<220&&p[n+1]>170&&p[n+2]>240)blue++;if(p[n]===255&&p[n+1]===255&&p[n+2]===255)white++;}return {blue,white};})()`,
      [
        `data:image/${format === 'svg' ? 'svg+xml' : 'png'};base64,${bytes.toString('base64')}`,
      ],
    );
    assert(
      colors.blue > 100 && colors.white > 100,
      `${format} keeps hatch ink and gaps`,
    );
  }
  await dialogs('open', target);
  await click('Menu');
  await click('Open');
  await until(async () => !(await state()).canUndo);
  await select('b1');
  assert.equal((await save()).objects.b1.style.fillType, 'cross-hatch');
  await click('No fill');
  assert.equal(
    await sync(
      `return window.Konva.stages[0].findOne('#object-b1').findOne('.object-hit-area').fill()`,
    ),
    'transparent',
  );
  await click('Solid fill');
  await click('Sharp corners');
  await command('depthplan_selection', {
    action: 'set',
    objects: [],
    connections: ['arrow'],
  });
  await click('Curved path');
  await sync(
    `document.querySelector('summary[aria-label="Start marker"]').click()`,
  );
  await click('Start marker: Circle outline');
  await sync(
    `document.querySelector('summary[aria-label="End marker"]').click()`,
  );
  await click('End marker: Cardinality zero or many');
  const connectorStyle = (await save()).connections.arrow.style;
  assert.equal(connectorStyle.lineType, 'curved');
  assert.equal(connectorStyle.arrowheadStart, 'circle_outline');
  assert.equal(connectorStyle.arrowheadEnd, 'cardinality_zero_or_many');
  await sync(
    `document.querySelector('summary[aria-label="End marker"]').click()`,
  );
  await screenshot('style-icons-connector-screen.png');
  assert.deepEqual(
    await sync(`const button=document.querySelector('[aria-label="End marker: Bar"]');
    button.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    return {open:button.closest('details').open, focus:document.activeElement.getAttribute('aria-label')};`),
    { open: false, focus: 'End marker' },
  );
  console.log(
    'PASS Style icons: 46 themed assets, persistent 2/3-stack toggles including nested/unselected parents, icon-only actions, subtree Duplicate/Undo, Link, fill/corner controls, hatch SVG/PNG, reopen, path/marker choices.',
  );
  await screenshot('expansion-screen.png');
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    'PASS expansion: disclosure/selection/MCP, physical growth and neighbor movement, nested restoration, manual state edits, Undo/Redo, reopen, independent collapse, arrow bindings/Z, no bookmarks, SVG/PNG.',
  );
  for (const types of [
    ['rectangle', 'rectangle'],
    ['diamond', 'ellipse'],
  ]) {
    const fixture = structuredClone(document);
    for (const [i, id] of ['a', 'b'].entries()) {
      fixture.objects[id].type = types[i];
      const geometry = {
        x: 400 + i * 400,
        y: 350,
        width: 240,
        height: types[i] === 'rectangle' && i === 1 ? 160 : 240,
        rotation: 0,
        z: 0,
      };
      fixture.objects[id].geometry = geometry;
      fixture.objects[id].style = { fill: '#ffffff', strokeWidth: 1.5 };
      fixture.layouts[id][0][id] = geometry;
    }
    const file = path.join(profile, `stack-corners-${types[0]}.depthplan.json`);
    await writeFile(file, JSON.stringify(fixture));
    await dialogs('open', file);
    await click('Menu');
    await click('Open');
    await until(async () => (await state()).source?.path === file);
    await click('Reset view');
    for (const phase of types[0] === 'rectangle'
      ? ['collapsed']
      : ['collapsed', 'expanded', 'transformed']) {
      if (phase === 'expanded') {
        await click('Reveal children of a');
        await click('Reveal children of b');
        await until(() => sync('return window.Konva.stages[0].listening()'));
      } else if (phase === 'transformed') {
        await edit(
          { type: 'children', id: 'a', expanded: false },
          { type: 'children', id: 'b', expanded: false },
        );
        await until(() => sync('return window.Konva.stages[0].listening()'));
        await edit(
          {
            type: 'geometry',
            id: 'a',
            patch: { width: 100, height: 160, rotation: 25 },
          },
          {
            type: 'geometry',
            id: 'b',
            patch: { width: 320, height: 140, rotation: -30 },
          },
        );
        await command('depthplan_camera', {
          action: { type: 'set', camera: { x: -30, y: 50, scale: 0.85 } },
        });
      }
      for (const id of ['a', 'b']) {
        const placement = await sync(
          `const stage=window.Konva.stages[0];
        const group=stage.findOne('#object-'+arguments[0]);
        const shape=group.findOne('.object-hit-area');
        const box=shape.getClientRect();
        const canvas=stage.container().getBoundingClientRect();
        const button=document.querySelector('.child-stack-toggle[aria-label$="children of '+arguments[0]+'"]');
        const badge=button.getBoundingClientRect();
        const center=group.getAbsoluteTransform().copy().invert().point({x:badge.left+16-canvas.left,y:badge.top+16-canvas.top});
        return {right:canvas.left+box.x+box.width-badge.right, top:badge.top-canvas.top-box.y,
          x:center.x/(group.width()/2), y:center.y/(group.height()/2),
          width:badge.width, height:badge.height, shape:shape.getClassName(),
          border:getComputedStyle(button).borderTopColor};`,
          [id],
        );
        const type = fixture.objects[id].type;
        if (type === 'rectangle') {
          assert(Math.abs(placement.right - 4) < 1, JSON.stringify(placement));
          assert(Math.abs(placement.top - 4) < 1, JSON.stringify(placement));
        } else {
          assert(placement.x > 0 && placement.y < 0, 'upper-right outline');
          const perimeter =
            type === 'diamond'
              ? Math.abs(placement.x) + Math.abs(placement.y)
              : placement.x ** 2 + placement.y ** 2;
          assert(
            Math.abs(perimeter - 1) < 0.01,
            `${phase}: ${JSON.stringify(placement)}`,
          );
        }
        assert.equal(placement.width, 32);
        assert.equal(placement.height, 32);
        assert.equal(
          placement.border,
          phase === 'expanded' ? 'rgba(0, 0, 0, 0)' : 'rgb(219, 226, 236)',
        );
        assert.equal(
          placement.shape,
          { rectangle: 'Rect', diamond: 'Line', ellipse: 'Ellipse' }[type],
        );
      }
      await screenshot(`stack-corners-${types[0]}-${phase}.png`);
    }
    if (types[0] === 'diamond') {
      await edit({
        type: 'geometry',
        id: 'b',
        patch: { x: 1000, y: 450, width: 300, height: 90, rotation: 0 },
      });
      for (const action of ['Reveal', 'Hide', 'Reveal']) {
        await click(`${action} children of a`);
        await until(() => sync('return window.Konva.stages[0].listening()'));
        assert.deepEqual(
          await sync(`const g=window.Konva.stages[0].findOne('#object-b');
            return {x:g.x(),y:g.y(),width:g.width(),height:g.height()};`),
          { x: 1000, y: 450, width: 300, height: 90 },
          'unrelated ellipse keeps its latest position and size',
        );
      }
      await screenshot('expansion-independent-ellipse.png');
    }
    await click('Save document');
    await until(async () => !(await state()).dirty);
  }
  console.log(
    'PASS stack icons: rectangle corners, diamond/circle outline attachments after expansion, resize, rotation, pan and zoom, fixed screen size, collapsed gray borders. Independent ellipse edits survive disclosure changes.',
  );

  const siblings = structuredClone(document);
  siblings.objects.a1.type = 'diamond';
  for (const id of ['a', 'a1', 'a2', 'deep'])
    siblings.objects[id].style = { fill: '#ffffff', strokeWidth: 1.5 };
  siblings.connections = {};
  siblings.layouts.b[0].b.x = 1800;
  for (const depth of [1, 2])
    Object.assign(siblings.layouts.a[depth].a2, { x: -350, y: 0 });
  const siblingFile = path.join(profile, 'expansion-siblings.depthplan.json');
  await writeFile(siblingFile, JSON.stringify(siblings));
  await dialogs('open', siblingFile);
  await click('Menu');
  await click('Open');
  await until(async () => (await state()).source?.path === siblingFile);
  await click('Reveal children of a');
  await click('Reveal children of a1');
  await until(() => sync('return window.Konva.stages[0].listening()'));
  await edit(
    { type: 'geometry', id: 'a2', patch: { x: -520, width: 100, height: 60 } },
    { type: 'geometry', id: 'a', patch: { width: 1300, height: 600 } },
  );
  await command('depthplan_camera', {
    action: { type: 'set', camera: { x: 300, y: 80, scale: 0.8 } },
  });
  await screenshot('expansion-siblings-before-collapse.png');
  await click('Hide children of a1');
  await until(() => sync('return window.Konva.stages[0].listening()'));
  assert.equal(
    await sync(`const stage=window.Konva.stages[0];
      const parent=stage.findOne('#object-a').findOne('.object-hit-area').getClientRect();
      return ['a1','a2'].every(id=>{
        const child=stage.findOne('#object-'+id).findOne('.object-hit-area').getClientRect();
        return child.x>=parent.x && child.y>=parent.y &&
          child.x+child.width<=parent.x+parent.width && child.y+child.height<=parent.y+parent.height;
      });`),
    true,
    'collapsing the diamond keeps its live sibling inside their parent',
  );
  assert.deepEqual(
    await sync(`const sibling=window.Konva.stages[0].findOne('#object-a2');
      return {x:sibling.x(),width:sibling.width(),height:sibling.height()};`),
    { x: -520, width: 100, height: 60 },
  );
  await screenshot('expansion-siblings-after-collapse.png');
  await click('Save document');
  await until(async () => !(await state()).dirty);
  console.log(
    'PASS collapse containment: live sibling edits stay inside the resized parent.',
  );
}
