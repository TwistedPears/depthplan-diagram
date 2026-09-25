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
  const pointer = async (type, point, ctrlKey = true) => {
    await sync(
      `const [type,p,ctrlKey]=arguments;
      document.elementFromPoint(p.x,p.y).dispatchEvent(new MouseEvent(type,{
        bubbles:true,cancelable:true,clientX:p.x,clientY:p.y,
        button:0,buttons:type==='mouseup'?0:1,ctrlKey}));`,
      [type, point, ctrlKey],
    );
    await js(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
  };
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
      `(async()=>{const image=new Image();image.src=arguments[0];await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        const toggleInk=pixels.some((v,i)=>i%4===0 && v===45 && pixels[i+1]===98 && pixels[i+2]===213);
        return [image.width,image.height,toggleInk]})()`,
      [
        `data:image/${format === 'svg' ? 'svg+xml' : 'png'};base64,${bytes.toString('base64')}`,
      ],
    );
    assert(dimensions[0] >= rootGeometry(restored, 'a').width);
    assert(dimensions[1] >= rootGeometry(restored, 'a').height);
    assert.equal(
      dimensions[2],
      false,
      `${format} excludes canvas toggle controls`,
    );
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
  icons.push('square-stack-2', 'square-stack-3', 'stroke-width-none');
  assert.equal(icons.length, 43);
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
    if (!b) return null;
    const toggle=window.Konva.stages[0].findOne('#child-toggle-'+arguments[0].split('children of ')[1]);
    const icon=['square-stack-2','square-stack-3'].find(name=>
      [...document.querySelectorAll('#icon-'+name+' path')].map(p=>p.getAttribute('d')).join(' ')===toggle.find('Path').map(p=>p.data()).join(' '));
    return {icon:'#icon-'+icon, expanded:b.getAttribute('aria-expanded'), text:b.textContent.trim()}`,
      [name],
    );
  await command('depthplan_selection', { action: 'clear' });
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
    `return [...document.querySelectorAll('.selection-actions > button')].filter(b => b.getClientRects().length).map(b => ({name:b.getAttribute('aria-label'), title:b.title, text:b.textContent.trim(), icon:b.querySelector('use')?.getAttribute('href')}))`,
  );
  assert.deepEqual(
    actionButtons.map((button) => button.name),
    ['Edit text', 'Properties', 'Delete selected', 'Duplicate'],
  );
  for (const button of actionButtons)
    assert(
      button.name && button.title && button.icon && !button.text,
      JSON.stringify(button),
    );
  assert.equal(
    await sync(`const button=document.querySelector('[aria-label="Link"]');
      return button.hidden && button.getClientRects().length === 0;`),
    true,
  );
  await edit({
    type: 'edit_object',
    id: 'b1',
    style: { link: 'https://example.com/diagram' },
  });
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
  const strokeChoices = [
    'No stroke',
    'Thin stroke',
    'Medium stroke',
    'Thick stroke',
  ];
  const strokeLayout = await sync(
    `const buttons=arguments[0].map(name=>document.querySelector('[aria-label="'+name+'"]'));
    const widths=buttons[0].closest('fieldset'), corners=document.querySelector('[aria-label="Sharp corners"]').closest('fieldset');
    return {order:[...widths.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')),
      rows:new Set(buttons.map(b=>b.getBoundingClientRect().top)).size,
      cornersBelow:corners.getBoundingClientRect().top>widths.getBoundingClientRect().bottom,
      aligned:corners.getBoundingClientRect().left===widths.getBoundingClientRect().left};`,
    [strokeChoices],
  );
  assert.deepEqual(strokeLayout, {
    order: strokeChoices,
    rows: 1,
    cornersBelow: true,
    aligned: true,
  });
  const paintedWidth = () =>
    sync(
      `return window.Konva.stages[0].findOne('#object-b1').findOne('.object-hit-area').strokeWidth();`,
    );
  for (const [name, width] of [
    ['Thin stroke', 2],
    ['Medium stroke', 3],
    ['Thick stroke', 5],
    ['No stroke', 0],
  ]) {
    await click(name);
    assert.equal(await paintedWidth(), width);
    assert.equal(
      await sync(
        `return document.querySelector('[aria-label="'+arguments[0]+'"]').getAttribute('aria-pressed');`,
        [name],
      ),
      'true',
    );
  }
  await click('Undo');
  assert.equal(await paintedWidth(), 5);
  await click('Redo');
  assert.equal(await paintedWidth(), 0);
  assert.equal((await save()).objects.b1.style.strokeWidth, 0);
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
  const reopenedStyle = (await save()).objects.b1.style;
  assert.equal(reopenedStyle.fillType, 'cross-hatch');
  assert.equal(reopenedStyle.strokeWidth, 0);
  assert.equal(await paintedWidth(), 0);
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
  await click('No stroke');
  assert.equal(
    await sync(
      `return window.Konva.stages[0].findOne('#connection-arrow').findOne('.connection-path').strokeWidth();`,
    ),
    0,
  );
  await click('Undo');
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
    'PASS Style icons: 43 themed assets, persistent 2/3-stack toggles including nested/unselected parents, icon-only actions, subtree Duplicate/Undo, hidden Link with stored links retained, separate Corners row, No stroke/width controls with Undo/Redo and reopen, fill controls, hatch SVG/PNG, path/marker choices.',
  );
  await screenshot('expansion-screen.png');
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    'PASS expansion: disclosure/selection/MCP, physical growth and neighbor movement, nested restoration, manual state edits, Undo/Redo, reopen, independent collapse, arrow bindings/Z, no bookmarks, SVG/PNG.',
  );
  const assertToggleInside = async (id) => {
    const placement = await sync(
      `const stage=window.Konva.stages[0];
      const toggle=stage.findOne('#child-toggle-'+arguments[0]);
      const owner=toggle.getParent(), shape=owner.findOne('.object-hit-area');
      const badge=(toggle.findOne('Rect') || toggle.findOne('Circle')).getClientRect();
      const padding=shape.strokeWidth()*owner.getAbsoluteScale().x/2 + 3*toggle.getAbsoluteScale().x;
      const inverse=owner.getAbsoluteTransform().copy().invert();
      return {type:shape.getClassName(), a:owner.width()/2, b:owner.height()/2,
        radius:Math.min(owner.width()/2, owner.height()/2, shape.cornerRadius?.() || 0),
        corners:[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>inverse.point({
          x:badge.x+badge.width/2+x*(badge.width/2+padding),
          y:badge.y+badge.height/2+y*(badge.height/2+padding)}))};`,
      [id],
    );
    const { type, a, b, radius, corners } = placement;
    for (const { x, y } of corners) {
      const nx = Math.abs(x) / a,
        ny = Math.abs(y) / b;
      const inside =
        type === 'Ellipse'
          ? nx * nx + ny * ny <= 1
          : type === 'Line'
            ? nx + ny <= 1
            : nx <= 1 &&
              ny <= 1 &&
              (!radius ||
                Math.max(0, Math.abs(x) - a + radius) ** 2 +
                  Math.max(0, Math.abs(y) - b + radius) ** 2 <=
                  radius ** 2);
      assert(
        inside,
        'toggle and clearance stay inside outline: ' +
          JSON.stringify(placement),
      );
    }
  };
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
        const toggle=stage.findOne('#child-toggle-'+arguments[0]);
        const badge=toggle.findOne('Rect').getClientRect({skipStroke:true});
        const control=button.getBoundingClientRect();
        const center=group.getAbsoluteTransform().copy().invert().point({x:badge.x+badge.width/2,y:badge.y+badge.height/2});
        return {right:box.x+box.width-badge.x-badge.width, top:badge.y-box.y,
          x:center.x/(group.width()/2), y:center.y/(group.height()/2),
          width:badge.width, height:badge.height, shape:shape.getClassName(),
          border:toggle.findOne('Rect').stroke(), owner:toggle.getParent().id(),
          controlOffset:Math.hypot(control.left-canvas.left-badge.x,control.top-canvas.top-badge.y)};`,
          [id],
        );
        const type = fixture.objects[id].type;
        if (type === 'rectangle') {
          assert(
            Math.abs(placement.right - 6.5) < 0.01,
            JSON.stringify(placement),
          );
          assert(
            Math.abs(placement.top - 6.5) < 0.01,
            JSON.stringify(placement),
          );
        } else {
          assert(
            placement.x >= -1e-6 && placement.y <= 1e-6,
            `${phase}: upper-right interior ${JSON.stringify(placement)}`,
          );
          const perimeter =
            type === 'diamond'
              ? Math.abs(placement.x) + Math.abs(placement.y)
              : placement.x ** 2 + placement.y ** 2;
          assert(perimeter < 1, `${phase}: ${JSON.stringify(placement)}`);
        }
        await assertToggleInside(id);
        const expectedSize = 32 * (phase === 'transformed' ? 0.85 : 1);
        assert(placement.width > 0 && placement.width <= expectedSize + 1e-6);
        assert(Math.abs(placement.height - placement.width) < 1e-6);
        assert(placement.controlOffset < 1, 'accessible control follows paint');
        assert.equal(placement.owner, `object-${id}`);
        assert.equal(
          placement.border,
          phase === 'expanded' ? 'transparent' : '#dbe2ec',
        );
        assert.equal(
          placement.shape,
          { rectangle: 'Rect', diamond: 'Line', ellipse: 'Ellipse' }[type],
        );
      }
      await screenshot(`stack-corners-${types[0]}-${phase}.png`);
      // Badges stay in the drawing, below the lifted object, in every view.
      const drag = await sync(`const stage=window.Konva.stages[0];
        const canvas=stage.container().getBoundingClientRect();
        const group=stage.findOne('#object-b');
        const start=group.getAbsoluteTransform().point({x:-group.width()*0.42,y:0});
        const center=group.getAbsolutePosition();
        const badge=document.querySelector('.child-stack-toggle[aria-label$="children of a"]').getBoundingClientRect();
        return {start:{x:start.x+canvas.left,y:start.y+canvas.top},
          end:{x:start.x+badge.left+badge.width/2-center.x,y:start.y+badge.top+badge.height/2-center.y}};`);
      const badgePaint = (id, x = 16, y = 10) =>
        sync(
          `const stage=window.Konva.stages[0], layer=stage.getLayers()[0];
          const toggle=stage.findOne('#child-toggle-'+arguments[0]);
          const p=toggle.getAbsoluteTransform().point({x:arguments[1],y:arguments[2]});
          const canvas=layer.getCanvas();
          layer.draw();
          return {visible:toggle.isVisible(), pixel:[...canvas.getContext().getImageData(
            Math.round(p.x*canvas.getPixelRatio()),Math.round(p.y*canvas.getPixelRatio()),1,1).data]};`,
          [id, x, y],
        );
      const uncovered = await badgePaint('a');
      assert.notDeepEqual(
        uncovered.pixel,
        [255, 255, 255, 255],
        'visible icon ink',
      );
      await pointer('mousedown', drag.start);
      await pointer('mousemove', drag.end);
      assert.deepEqual(
        await badgePaint('a'),
        {
          visible: true,
          pixel:
            phase === 'expanded' ? [219, 234, 254, 255] : [255, 255, 255, 255],
        },
        'moving object paints over the icon',
      );
      assert.notDeepEqual(
        (await badgePaint('b')).pixel,
        [255, 255, 255, 255],
        'moving badge stays visible',
      );
      await screenshot(`stack-drag-${types[0]}-${phase}.png`);
      await pointer('mousemove', drag.start);
      assert.deepEqual(
        await badgePaint('a'),
        uncovered,
        'uncovered icon ink returns',
      );
      await pointer('mousemove', drag.end);
      assert.equal(
        (await badgePaint('a')).visible,
        true,
        'covered toggle remains mounted',
      );
      await sync(
        `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`,
      );
      await pointer('mouseup', drag.start);
      assert.deepEqual(
        await badgePaint('a'),
        uncovered,
        'cancel restores paint',
      );
      if (types[0] === 'rectangle') {
        const left = await badgePaint('a', 10, 12);
        const right = await badgePaint('a', 22, 12);
        assert.deepEqual(left.pixel, [93, 107, 126, 255]);
        assert.deepEqual(right.pixel, left.pixel);
        // B's left edge bisects A's icon: only its covered half may disappear.
        const partial = { x: drag.end.x + 120, y: drag.end.y };
        await pointer('mousedown', drag.start);
        await pointer('mousemove', partial);
        assert.deepEqual(await badgePaint('a', 10, 12), left);
        assert.deepEqual(
          (await badgePaint('a', 22, 12)).pixel,
          [255, 255, 255, 255],
        );
        await screenshot('stack-partially-covered.png');
        await pointer('mouseup', partial);
        assert.deepEqual(await badgePaint('a', 10, 12), left);
        assert.deepEqual(
          (await badgePaint('a', 22, 12)).pixel,
          [255, 255, 255, 255],
          'drop keeps object-relative paint order',
        );
        assert.deepEqual(
          await sync(`const stage=window.Konva.stages[0];
          const toggle=stage.findOne('#child-toggle-a');
          return [10,22].map(x=>{
            const p=toggle.getAbsoluteTransform().point({x,y:12});
            const hit=stage.getIntersection(p);
            return hit.findAncestor('.child-stack-toggle',true)?.id() || hit.findAncestor('.recursive-object',true)?.id();
          });`),
          ['child-toggle-a', 'object-b'],
          'covered icon cannot steal pointer input',
        );
        await edit({ type: 'geometry', id: 'b', patch: { z: -1 } });
        assert.deepEqual(
          await badgePaint('a', 22, 12),
          right,
          'lower object paints below the entire icon',
        );
        await click('Undo');
        assert.deepEqual(
          (await badgePaint('a', 22, 12)).pixel,
          [255, 255, 255, 255],
        );
        await click('Undo');
        assert.deepEqual(await badgePaint('a', 22, 12), right);

        // Canvas hit testing handles clicks in both pointer and hand modes.
        for (const tool of ['Pointer (Select/Edit)', 'Hand (Pan)']) {
          await click(tool);
          for (const expanded of [true, false]) {
            const point =
              await sync(`const stage=window.Konva.stages[0], box=stage.container().getBoundingClientRect();
              const p=stage.findOne('#child-toggle-b').getAbsoluteTransform().point({x:16,y:16});
              return {x:p.x+box.left,y:p.y+box.top};`);
            await pointer('mousedown', point, false);
            await pointer('mouseup', point, false);
            await until(() =>
              sync('return window.Konva.stages[0].listening()'),
            );
            assert.equal(
              (await badge(`${expanded ? 'Hide' : 'Reveal'} children of b`))
                ?.expanded,
              String(expanded),
            );
          }
        }
        await click('Pointer (Select/Edit)');
        await sync(
          `document.querySelector('.child-stack-toggle[aria-label="Reveal children of a"]').focus();`,
        );
        await until(() =>
          sync(
            `return window.Konva.stages[0].findOne('#child-toggle-a').findOne('Rect').strokeWidth()===2;`,
          ),
        );
        await sync('document.activeElement.blur()');
      }
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
    // Dot clicks change disclosure history; keep the layout fixture independent.
    await edit(
      { type: 'children', id: 'a', expanded: false },
      { type: 'children', id: 'b', expanded: false },
    );
    await until(() => sync('return window.Konva.stages[0].listening()'));
    await edit({
      type: 'geometry',
      id: 'a',
      patch: { width: 240, height: 240 },
    });
    const toggleSnapshot = (id) =>
      sync(
        `const stage=window.Konva.stages[0];
      const toggle=stage.findOne('#child-toggle-'+arguments[0]);
      const dot=toggle.findOne('Circle');
      const shape=dot || toggle.findOne('Rect');
      const box=shape.getClientRect({skipStroke:true});
      const p=toggle.getAbsoluteTransform().point({x:16,y:16});
      const canvas=stage.container().getBoundingClientRect();
      const button=document.querySelector('.child-stack-toggle[aria-label$="children of '+arguments[0]+'"]');
      return {mode:dot?'dot':'icon', width:box.width, fill:shape.fill(),
        controlWidth:button.getBoundingClientRect().width,
        hit:stage.getIntersection({x:p.x+5,y:p.y})?.findAncestor('.child-stack-toggle',true)?.id(),
        center:{x:p.x+canvas.left,y:p.y+canvas.top}};`,
        [id],
      );
    for (const scale of [2, 1, 0.6, 0.59, 0.5, 0.25, 0.125, 1]) {
      await command('depthplan_camera', {
        action: {
          type: 'set',
          camera: { x: 400 - 400 * scale, y: 350 - 350 * scale, scale },
        },
      });
      await js(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      const toggle = await toggleSnapshot('a');
      const dot = scale < 0.6;
      assert.equal(toggle.mode, dot ? 'dot' : 'icon');
      assert(
        Math.abs(toggle.width - (dot ? 16 : 32) * Math.min(1, scale)) < 1e-6,
        'paint shrinks with zoom and caps at 32px',
      );
      assert(
        Math.abs(toggle.controlWidth - 32 * Math.min(1, scale)) < 0.1,
        'keyboard control follows scaled placement',
      );
      assert.equal(
        toggle.hit,
        'child-toggle-a',
        'small dots retain a usable pointer target',
      );
      if (dot) assert.equal(toggle.fill, '#2d62d5');
      await assertToggleInside('a');
      if (scale === 0.25) {
        await screenshot(`stack-dot-${types[0]}.png`);
        for (const id of ['a', 'b']) {
          for (const expanded of [true, false]) {
            const { center } = await toggleSnapshot(id);
            await pointer('mousedown', center, false);
            await pointer('mouseup', center, false);
            await until(() =>
              sync('return window.Konva.stages[0].listening()'),
            );
            // Listening resumes before Konva repaints the final hit canvas.
            await js(
              'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
            );
            assert.equal(
              await sync(
                `return document.querySelector('.child-stack-toggle[aria-label$="children of '+arguments[0]+'"]')?.getAttribute('aria-expanded');`,
                [id],
              ),
              String(expanded),
              'blue dot toggles children',
            );
          }
        }
      }
    }
    // Thick borders and rounded corners must remain clear at high zoom too.
    await edit(
      {
        type: 'edit_object',
        id: 'a',
        style: { strokeWidth: 6, cornerRadius: 48 },
      },
      { type: 'geometry', id: 'b', patch: { x: 1800 } },
    );
    for (const [scale, rotation] of [
      [4, 0],
      [1, 0],
      [0.6, 35],
    ]) {
      await edit({
        type: 'geometry',
        id: 'a',
        patch: { width: 240, height: 200, rotation },
      });
      await command('depthplan_camera', {
        action: {
          type: 'set',
          camera: {
            x: 400 - 400 * scale,
            y: (scale === 4 ? 500 : 350) - 350 * scale,
            scale,
          },
        },
      });
      await assertToggleInside('a');
      await screenshot(`stack-interior-${types[0]}-${scale}.png`);
    }
    const beforePan = await toggleSnapshot('a');
    await command('depthplan_camera', {
      action: { type: 'set', camera: { x: -200, y: -170, scale: 0.6 } },
    });
    const afterPan = await toggleSnapshot('a');
    assert(Math.abs(afterPan.center.x - beforePan.center.x + 360) < 1e-6);
    assert(Math.abs(afterPan.center.y - beforePan.center.y + 310) < 1e-6);
    await assertToggleInside('a');
    await edit({
      type: 'geometry',
      id: 'a',
      patch: { width: 36, height: 36, rotation: 25 },
    });
    await command('depthplan_camera', {
      action: { type: 'set', camera: { x: 0, y: 0, scale: 1 } },
    });
    const small = await toggleSnapshot('a');
    assert.equal(small.mode, 'dot', 'small objects keep the control inside');
    await assertToggleInside('a');
    await click('Save document');
    await until(async () => !(await state()).dirty);
  }
  console.log(
    'PASS stack icons: object-relative layering, partial overlap during drag/drop, Z/Undo, pointer/hand clicks, keyboard focus, interior clearance for thick borders/rounded corners, capped size and clickable shrinking blue dots through zoom/rotation. Independent ellipse edits survive disclosure changes.',
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
