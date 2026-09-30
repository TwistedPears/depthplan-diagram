import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function textEditing(driver) {
  const { native, sync, js, click, dialogs, until, profile } = driver;
  const screenshot = async (name) =>
    writeFile(
      path.join(profile, name),
      Buffer.from(
        await driver.request(
          `/session/${driver.session}/screenshot`,
          undefined,
          'GET',
        ),
        'base64',
      ),
    );
  const fonts = await native('fonts:list');
  assert(fonts.length > 0, 'OS font enumeration returns installed families');
  assert.equal(new Set(fonts).size, fonts.length);
  const font =
    fonts.find((name) =>
      ['Arial', 'DejaVu Sans', 'Liberation Sans', 'Segoe UI'].includes(name),
    ) ?? fonts[0];
  const geometry = {
    x: 500,
    y: 300,
    z: 0,
    width: 400,
    height: 160,
    rotation: 0,
  };
  const object = {
    id: 'text',
    parentId: null,
    type: 'rectangle',
    name: '',
    geometry,
    content: [
      {
        type: 'paragraph',
        runs: [
          { text: 'Text editing sample', marks: { font: 'RandomFontName' } },
        ],
      },
    ],
  };
  const file = path.join(profile, 'text-editing.depthplan');
  await writeFile(
    file,
    JSON.stringify({
      formatVersion: 2,
      id: 'text-editing',
      metadata: {
        title: 'Text editing',
        created: '2026-09-29',
        modified: '2026-09-29',
      },
      objects: {
        text: object,
        child: { ...object, id: 'child', parentId: 'text', content: [] },
      },
      rootDepths: { text: 0 },
      layouts: { text: { 0: { text: geometry } } },
      connections: {},
    }),
  );
  await dialogs('open', file);
  await click('Menu');
  await click('Open Board…');
  await until(() =>
    sync("return !!window.Konva.stages[0].findOne('#object-text')"),
  );
  const center = await sync(
    "const box=window.Konva.stages[0].findOne('#object-text').getClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2}",
  );
  await driver.drag(center.x, center.y, 0, 0, 0);
  const painted = () =>
    sync(
      `const group=window.Konva.stages[0].findOne('#object-text').findOne('.object-content'); const text=group.findOne('Text'); return {x:text.x(), y:text.y(), height:group.clipHeight(), bodyWidth:group.clipWidth(), font:text.fontFamily(), width:text.width()};`,
    );
  const middle = await painted();
  assert(Math.abs(middle.y - (middle.height - 15.6) / 2) < 0.1);
  assert(Math.abs(middle.x - (middle.bodyWidth - middle.width) / 2) < 0.1);
  assert.match(middle.font, /RandomFontName.*sans-serif/);
  await click('Edit text');
  await click('Text font');
  await until(() =>
    sync(
      'return document.querySelector(".font-picker [popover]").getAttribute("aria-hidden") === "false"',
    ),
  );
  await until(() =>
    sync(
      'return document.querySelectorAll(".font-star[aria-checked=true]").length === 5',
    ),
  );
  assert(
    await sync(
      `return !!document.querySelector('[aria-label="Favorite monospace"][aria-checked=true]')`,
    ),
  );
  await screenshot('font-favorites.png');
  await click('Favorite monospace');
  assert(
    !(await sync(
      'return JSON.parse(localStorage.getItem("depthplan.favoriteFonts")).includes("monospace")',
    )),
  );
  await js(
    'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
  );
  await sync('document.querySelector(".font-see-all").focus()');
  await click('See all fonts');
  assert(
    await sync(
      'return document.activeElement.classList.contains("font-see-all")',
    ),
  );
  await screenshot('font-all.png');
  await click('Favorite monospace');
  await sync(
    'document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true, cancelable:true}))',
  );
  assert(
    await sync(
      'return !!document.querySelector(".inline-object-text") && document.querySelector(".font-picker [popover]").getAttribute("aria-hidden") === "true"',
    ),
  );
  assert(
    await sync(
      `const b=document.querySelector('[aria-label="Align text middle"]'); return b.getAttribute('aria-pressed')==='true' && !b.closest('details');`,
    ),
  );
  const editorY = () =>
    sync(
      `const prose=document.querySelector('.ProseMirror'), body=document.querySelector('.inline-object-text-body'); return {y:prose.offsetTop, height:prose.offsetHeight, body:body.clientHeight};`,
    );
  const inline = await editorY();
  assert(Math.abs(inline.y - (inline.body - inline.height) / 2) <= 1);
  assert(
    await sync(
      `return document.querySelector('[aria-label="Align text center"]').getAttribute('aria-pressed')==='true' && getComputedStyle(document.querySelector('.ProseMirror p')).textAlign==='center';`,
    ),
  );
  await sync(
    `const prose=document.querySelector('.ProseMirror'); prose.focus(); window.getSelection().selectAllChildren(prose); document.dispatchEvent(new Event('selectionchange'));`,
  );
  await js(
    'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
  );
  await click('Text font');
  await click('See all fonts');
  await click(font);
  for (const align of ['top', 'middle', 'bottom']) {
    await click(`Align text ${align}`);
    const box = await editorY();
    const expected =
      align === 'top'
        ? 0
        : (box.body - box.height) / (align === 'middle' ? 2 : 1);
    assert(Math.abs(box.y - expected) <= 1, `${align}: ${JSON.stringify(box)}`);
  }
  await sync(`document.querySelector('.advanced-text-options').open=true;`);
  for (const label of [
    'Bold',
    'Italic',
    'Underline',
    'Strikethrough',
    'Align text justify',
    'Bullet list',
    'Numbered list',
    'Indent',
    'Outdent',
  ]) {
    assert(
      await sync(
        `const use=document.querySelector('[aria-label="'+arguments[0]+'"]').querySelector('use'); return !!use && !!document.querySelector(use.getAttribute('href'));`,
        [label],
      ),
    );
  }
  assert(
    await sync(
      `return !['Text block','Text size','Text color','List start','Undo text','Redo text','Set link','Remove link','Link URL','Insert code','Blockquote','Unwrap block'].some(label=>document.querySelector('[aria-label="'+label+'"]'));`,
    ),
  );
  await click('Strikethrough');
  assert(await sync('return !!document.querySelector(".ProseMirror s")'));
  for (const [label, struck] of [
    ['Undo', false],
    ['Redo', true],
    ['Undo', false],
  ]) {
    await sync(
      `const button=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===arguments[0] && b.getClientRects().length);
       button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));
       if(button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))) button.focus();`,
      [label],
    );
    await click(label);
    assert(
      await sync('return !!document.querySelector(".inline-object-text")'),
    );
    assert.equal(
      await sync('return !!document.querySelector(".ProseMirror s")'),
      struck,
    );
  }
  await screenshot('text-editing.png');
  await click('Text font');
  for (const width of [1280, 760]) {
    await driver.request(`/session/${driver.session}/window/rect`, {
      width,
      height: 900,
    });
    await js(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    assert(
      await sync(
        `const r=document.querySelector('.font-picker [popover]').getBoundingClientRect(); return r.width>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight`,
      ),
    );
    await screenshot(`font-menu-${width}.png`);
  }
  await driver.request(`/session/${driver.session}/window/rect`, {
    width: 1280,
    height: 900,
  });
  await sync('document.querySelector(".font-picker [popover]").hidePopover()');
  await sync(
    `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`,
  );
  await until(() =>
    sync('return !document.querySelector(".inline-object-text")'),
  );
  const bottom = await painted();
  assert(Math.abs(bottom.y - (bottom.height - 15.6)) < 0.1);
  assert(bottom.font.includes(font), `${font}: ${bottom.font}`);
  if (
    await sync(
      'return !!document.querySelector(`[aria-label="Save document"]`)',
    )
  )
    await click('Save document');
  await until(
    async () =>
      JSON.parse(await readFile(file, 'utf8')).objects.text.style
        ?.textVerticalAlign === 'bottom',
  );
  const saved = JSON.parse(await readFile(file, 'utf8')).objects.text;
  assert.equal(saved.style.textVerticalAlign, 'bottom');
  assert.equal(saved.content[0].runs[0].marks.font, font);
  await click('Edit text');
  await sync(
    `const prose=document.querySelector('.ProseMirror');prose.focus();window.getSelection().selectAllChildren(prose);document.dispatchEvent(new Event('selectionchange'))`,
  );
  await js(
    'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
  );
  await sync(
    `const prose=document.querySelector('.ProseMirror');const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:type=>type==='text/plain'?'[Docs | https://example.com] and https://example.org':''}});prose.dispatchEvent(event)`,
  );
  assert(
    await sync(
      'return document.querySelector(".ProseMirror").textContent === "[Docs | https://example.com] and https://example.org"',
    ),
  );
  await sync(
    'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))',
  );
  await until(() =>
    sync('return !document.querySelector(".inline-object-text")'),
  );
  assert(
    await sync(
      `const pieces=window.Konva.stages[0].findOne('#object-text').findOne('.object-content').find('Text');return pieces.map(p=>p.text()).join('')==='Docs and https://example.org' && pieces.some(p=>p.text()==='Docs' && p.textDecoration()==='underline')`,
    ),
  );
  assert.equal(
    await sync(`
    const original=window.desktop.openLink; let opened;
    window.desktop.openLink=url=>{opened=url;return Promise.resolve()};
    try { window.Konva.stages[0].findOne('#object-text').findOne('.object-content').find('Text').find(p=>p.text()==='Docs').fire('click',{evt:{ctrlKey:true}}); }
    finally { window.desktop.openLink=original; }
    return opened;`),
    'https://example.com',
  );
  await click('Edit text');
  assert(
    await sync(
      'return document.querySelector(".ProseMirror").textContent === "[Docs | https://example.com] and https://example.org"',
    ),
  );
  await sync(
    'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))',
  );
  if (
    await sync(
      'return !!document.querySelector(`[aria-label="Save document"]`)',
    )
  )
    await click('Save document');
  await until(
    async () =>
      JSON.parse(await readFile(file, 'utf8')).objects.text.content[0].runs[0]
        .marks?.link === 'https://example.com',
  );
  const svg = path.join(profile, 'text-editing.svg');
  await click('Menu');
  await click('Export');
  await sync(
    `const select=document.querySelector('select[aria-label="Format"]');select.value='svg';select.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await dialogs('save', svg);
  await click('Export');
  await until(async () => {
    try {
      return (await readFile(svg)).length > 100;
    } catch {
      return false;
    }
  });
  assert.match(await readFile(svg, 'utf8'), /font-family="[^"\n]*sans-serif/);
  console.log(
    `PASS text editing: font favorites, keyboard menu, responsive controls, inline links, draft history, persistence and export. Evidence: ${profile}`,
  );
}
