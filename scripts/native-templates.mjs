import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchNative, clickToPaint } from './native-driver.mjs';

export async function templates() {
  const driver = await launchNative();
  const { click, sync, js, until, dialogs, native, profile, request, session } =
    driver;
  const timings = [];
  const open = async () => {
    await click('Menu');
    timings.push(await clickToPaint(driver, 'Templates'));
    await until(() =>
      sync(
        'return !!document.querySelector("dialog[aria-label=Templates] canvas")',
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
    await writeFile(
      path.join(profile, `${name}.png`),
      Buffer.from(
        await request(`/session/${session}/screenshot`, undefined, 'GET'),
        'base64',
      ),
    );
  };
  const save = async (filename) => {
    const target = path.join(profile, filename);
    await dialogs('save', target);
    await click('Save document');
    let document;
    await until(async () => {
      try {
        document = JSON.parse(await readFile(target, 'utf8'));
        return true;
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
    await open();
    for (const id of ['erd', 'isometric', 'purdue']) {
      await field('Template', `bundled:bundled-${id}`);
      for (const view of ['collapsed', 'expanded']) {
        await field('Preview view', view);
        await capture(`${id}-${view}`);
      }
    }
    await request(`/session/${session}/window/rect`, {
      width: 390,
      height: 760,
    });
    await capture('templates-narrow');
    assert(
      await sync(
        `const r=document.querySelector('dialog').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth`,
      ),
    );
    await request(`/session/${session}/window/rect`, {
      width: 1280,
      height: 900,
    });
    await field('Template', 'bundled:bundled-erd');
    await click('New from template');
    await until(() =>
      sync(
        'return !document.querySelector("dialog[open]") && document.querySelector(".document-name").textContent.includes("ERD")',
      ),
    );
    const initial = await save('starter.depthplan');
    assert(initial.extensions.templateSources.length === 1);
    assert(Object.keys(initial.namedViews).length === 2);
    assert(Object.keys(initial.objects).length === 9);
    await open();
    await click('Create from document');
    await field('Template name', 'Native schema');
    await field(
      'How to add another item',
      'Use the Table component and rename it.',
    );
    const customer = Object.values(initial.objects).find(
      (o) => o.name === 'customers',
    ).id;
    await field('Example object', customer);
    await click('Add reusable pattern');
    await click('Save personal copy');
    await click('Save to library');
    await until(
      async () => (await native('template:list')).entries.length === 1,
    );
    const entry = (await native('template:list')).entries[0];
    const shared = path.join(profile, 'shared.depthtemplate');
    await click('Export template');
    await dialogs('template-save', shared);
    await click('Export file');
    await until(async () => {
      try {
        return (
          JSON.parse(await readFile(shared, 'utf8')).extensions.template
            .name === 'Native schema'
        );
      } catch {
        return false;
      }
    });
    await dialogs('template-open', shared);
    await click('Import template');
    await click('Import separate copy');
    await until(
      async () => (await native('template:list')).entries.length === 2,
    );
    const imported = (await native('template:list')).entries.find(
      (e) =>
        e.document.extensions.template.id !==
        entry.document.extensions.template.id,
    );
    assert.equal(
      imported.document.extensions.template.name,
      'Native schema copy',
    );
    await click('Edit template');
    await until(() => sync('return !document.querySelector("dialog[open]")'));
    await open();
    await click('Create from document');
    await field(
      'Description',
      'Edited through the existing editor and explicitly updated.',
    );
    await click('Update library entry');
    await click('Save to library');
    await until(async () =>
      (await native('template:list')).entries.some(
        (e) => e.document.extensions.template.version === 2,
      ),
    );
    await click('Remove');
    await click('Remove');
    await until(
      async () => (await native('template:list')).entries.length === 1,
    );
    // Cancel protects the unsaved editor copy; Save persists it before replacing.
    await dialogs('message', 'Cancel');
    await click('New from template');
    await until(() => sync('return !document.querySelector("dialog[open]")'));
    assert(
      (
        await sync(
          'return document.querySelector(".document-name").textContent',
        )
      ).includes('Native schema copy'),
    );
    await open();
    await native('test:dialogs', [
      { kind: 'message', value: 'Save' },
      { kind: 'save', value: path.join(profile, 'edited.depthplan') },
    ]);
    await click('New from template');
    await until(() =>
      sync(
        'return document.querySelector(".document-name").textContent.includes("ERD")',
      ),
    );
    assert.equal(
      JSON.parse(await readFile(path.join(profile, 'edited.depthplan'), 'utf8'))
        .extensions.template.version,
      1,
    );
    await open();
    await field('Template', 'document:bundled-erd:1');
    await field('Reusable component', 'customers');
    await click('Add component');
    await click('Add component');
    await click('Reveal inserted item');
    const extended = await save('extended.depthplan');
    assert.equal(Object.keys(extended.objects).length, 17);
    assert.equal(extended.extensions.templateSources.length, 1);
    assert.equal(Object.keys(extended.namedViews).length, 2);
    await open();
    await dialogs('message', 'Discard');
    await click('New from template');
    await until(() => sync('return !document.querySelector("dialog[open]")'));
    await capture('starter-canvas');
    await native('test:dialogs', [
      { kind: 'open', value: path.join(profile, 'extended.depthplan') },
      { kind: 'message', value: 'Discard' },
    ]);
    await click('Menu');
    await click('Open Board…');
    await until(() =>
      sync(
        'return document.querySelector(".document-state").textContent.includes("extended.depthplan")',
      ),
    );
    await open();
    await field('Template', 'document:bundled-erd:1');
    await field('Reusable component', 'customers-column-0');
    await click('Add component');
    await click('Close');
    // Normal Save writes the reopened board, preserving its retained definitions.
    await click('Save document');
    await until(
      async () =>
        Object.keys(
          JSON.parse(
            await readFile(path.join(profile, 'extended.depthplan'), 'utf8'),
          ).objects,
        ).length === 18,
    );
    assert.deepEqual(await sync('return window.nativeErrors'), []);
    await writeFile(
      path.join(profile, 'template-timing.json'),
      JSON.stringify(
        { platform: process.platform, libraryOpenToPaintMs: timings },
        null,
        2,
      ),
    );
    console.log(
      `PASS native templates: previews, create/edit/update, sharing, duplicate import, removal, independent insertion/reopen/offline guidance, dirty Cancel/Save/Discard. Evidence: ${profile}`,
    );
    return profile;
  } catch (error) {
    await capture('templates-failure').catch(() => {});
    console.error(`Template failure evidence: ${profile}`);
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
