import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchNative } from './native-driver.mjs';

export async function templates() {
  const driver = await launchNative();
  const { click, sync, js, until, dialogs, native, profile, request, session } =
    driver;
  const boardFile = path.join(profile, 'gallery-board.depthplan');
  const open = async () => {
    await click('Menu');
    await click('Templates');
    await until(() =>
      sync(
        'return !!document.querySelector("dialog[aria-label=Templates] canvas") && document.querySelector(".template-gallery").getAttribute("aria-busy") === "false"',
      ),
    );
  };
  const field = (label, value) =>
    sync(
      `const label=[...document.querySelectorAll('dialog label')].find(l=>l.textContent.startsWith(arguments[0])); const input=label.querySelector('input,select,textarea'); const proto=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(input,arguments[1]); input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));`,
      [label, value],
    );
  const capture = async (name) => {
    await js(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
    );
    // Let the existing button color transitions settle before visual capture.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(
      path.join(profile, `${name}.png`),
      Buffer.from(
        await request(`/session/${session}/screenshot`, undefined, 'GET'),
        'base64',
      ),
    );
  };
  const readBoard = async (count) => {
    let document;
    await until(async () => {
      try {
        document = JSON.parse(await readFile(boardFile, 'utf8'));
        return Object.keys(document.objects).length === count;
      } catch {
        return false;
      }
    });
    return document;
  };
  try {
    await click('Menu');
    await click('Settings');
    await sync(
      `const toggle=document.querySelector('[aria-label="Autosave"]'); if(toggle.getAttribute('aria-checked')==='true') toggle.click();`,
    );
    await click('Menu');
    const originalName = await sync(
      'return document.querySelector(".document-name").textContent',
    );
    await open();
    for (const [width, height] of [
      [1440, 900],
      [768, 1024],
      [390, 844],
    ]) {
      await request(`/session/${session}/window/rect`, { width, height });
      await capture(`gallery-${width}`);
      assert(
        await sync(
          `const d=document.querySelector('dialog'), r=d.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && d.scrollWidth<=d.clientWidth;`,
        ),
      );
    }
    await request(`/session/${session}/window/rect`, {
      width: 1440,
      height: 900,
    });
    await click('Infrastructure');
    assert.equal(
      await sync('return document.querySelectorAll(".template-card").length'),
      1,
    );
    await click('All templates');
    await click('Preview ERD · database schema');
    await capture('gallery-preview');
    await click('Insert template');
    await until(() => sync('return !document.querySelector("dialog[open]")'));
    assert.equal(
      await sync('return document.querySelector(".document-name").textContent'),
      originalName,
    );
    await dialogs('save', boardFile);
    await click('Save document');
    const initial = await readBoard(9);
    assert.equal(initial.extensions?.templateSources, undefined);
    assert.equal(initial.extensions?.template, undefined);
    assert.equal(Object.keys(initial.namedViews ?? {}).length, 0);
    await capture('inserted-sample');
    await open();
    await click('Insert ERD · database schema');
    await click('Save document');
    const twice = await readBoard(18);
    assert.equal(twice.id, initial.id);
    for (const id of Object.keys(initial.objects))
      assert.deepEqual(twice.objects[id], initial.objects[id]);
    for (const id of Object.keys(initial.layouts))
      assert.deepEqual(twice.layouts[id], initial.layouts[id]);
    const roots = Object.keys(twice.rootDepths);
    const left = twice.layouts[roots[0]][twice.rootDepths[roots[0]]][roots[0]];
    const right = twice.layouts[roots[1]][twice.rootDepths[roots[1]]][roots[1]];
    assert(
      right.x - right.width / 2 > left.x + left.width / 2,
      'Repeated samples must not overlap',
    );
    await capture('second-sample-selected');
    await open();
    await click('Save selection');
    await field('Template name', 'My diagram sample');
    await field('Description', 'An editable example');
    await click('Review template');
    await click('Cancel');
    assert.equal(
      await sync('return document.querySelector("dialog input").value'),
      'My diagram sample',
    );
    await click('Review template');
    await click('Save to library');
    await until(
      async () => (await native('template:list')).entries.length === 1,
    );
    const entry = (await native('template:list')).entries[0];
    assert.deepEqual(entry.document.extensions.template.components, []);
    await click('Preview My diagram sample');
    const shared = path.join(profile, 'shared.depthtemplate');
    await click('Export template');
    await dialogs('template-save', shared);
    await click('Export file');
    await click('Back to gallery');
    await dialogs('template-open', shared);
    await click('Import template');
    await click('Import separate copy');
    await until(
      async () => (await native('template:list')).entries.length === 2,
    );
    await click('Preview My diagram sample copy');
    await click('Remove');
    await click('Remove');
    await until(
      async () => (await native('template:list')).entries.length === 1,
    );
    await click('Save selection');
    await field('Template name', 'My revised example');
    await field('Save as', entry.document.extensions.template.id);
    await click('Review replacement');
    await click('Save to library');
    await until(
      async () =>
        (await native('template:list')).entries[0].document.extensions.template
          .version === 2,
    );
    await click('Close templates');
    await click('Undo');
    await click('Save document');
    await readBoard(9);
    await click('Redo');
    await click('Save document');
    await readBoard(18);
    await dialogs('open', boardFile);
    await click('Menu');
    await click('Open Board…');
    await until(() =>
      sync(
        'return document.querySelector(".document-state").textContent.includes("gallery-board.depthplan")',
      ),
    );
    await open();
    await click('Insert ERD · database schema');
    await click('Save document');
    const reopened = await readBoard(27);
    assert.equal(reopened.id, initial.id);
    assert.equal(reopened.extensions?.templateSources, undefined);
    assert.deepEqual(await sync('return window.nativeErrors'), []);
    console.log(
      `PASS template gallery: responsive previews, categories, same-board insertion, non-overlap, selection, Undo/Redo, save/reopen, personal save/replace and import/export. Evidence: ${profile}`,
    );
    return profile;
  } catch (error) {
    await capture('gallery-failure').catch(() => {});
    console.error(`Template gallery failure evidence: ${profile}`);
    throw error;
  } finally {
    await driver.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await templates();
