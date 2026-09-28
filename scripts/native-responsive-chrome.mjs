import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchNative } from './native-driver.mjs';

const driver = await launchNative();
const { request, session, sync, js, click, profile } = driver;
try {
  await click('Minimap');
  for (const autosave of [true, false]) {
    if (!autosave) {
      await click('Menu');
      await click('Settings');
      await sync(`document.querySelector('[aria-label=Autosave]').click()`);
      await click('Menu');
    }
    for (const width of [
      1440, 1100, 1024, 941, 940, 781, 780, 761, 760, 521, 520, 503, 502, 480,
      401, 400, 360, 320,
    ]) {
      await request(`/session/${session}/window/rect`, { width, height: 800 });
      await js(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
      );
      const layout = await sync(`
        const rect = selector => {
          const el = document.querySelector(selector);
          const r = el.getBoundingClientRect();
          return {...r.toJSON(), visible:!!el.getClientRects().length, radius:getComputedStyle(el).borderRadius};
        };
        return {
          width:innerWidth,
          menu:rect('.document-switcher'),
          menuButton:rect('.toolbar-button'),
          menuIcon:rect('.toolbar-button svg'),
          toolIcon:rect('.shape-toolbar .tool-button svg'),
          actions:rect('.document-actions'),
          tools:rect('.shape-toolbar'),
          history:rect('.document-history'),
          navigation:rect('.canvas-navigation'),
          minimap:rect('.canvas-minimap'),
          bookmark:rect('.recursive-bookmarks > summary'),
          bookmarkLabel:rect('.bookmark-label'),
          zoom:[...document.querySelectorAll('.zoom-control')].map(el=>!!el.getClientRects().length),
          buttons:[...document.querySelectorAll('.shape-toolbar > button')].map(el=>el.getBoundingClientRect().toJSON()),
          save:!!document.querySelector('.quick-save'),
        };
      `);
      const { menu, actions, tools, buttons, history, navigation } = layout;
      const context = JSON.stringify({ autosave, ...layout });
      assert.equal(layout.width, width, context);
      assert.equal(layout.save, !autosave, context);
      assert.equal(actions.visible, width > 940, context);
      assert(tools.left >= 0 && tools.right <= width, context);
      assert(menu.left >= 0 && menu.right <= width, context);
      assert.equal(tools.height, menu.height, context);
      assert.equal(layout.toolIcon.width, layout.menuIcon.width, context);
      assert.equal(layout.toolIcon.height, layout.menuIcon.height, context);
      assert.equal(layout.bookmarkLabel.visible, width > 520, context);
      assert(layout.bookmark.visible, context);
      assert.deepEqual(layout.zoom, Array(3).fill(width > 400), context);
      assert.equal(history.bottom, navigation.bottom, context);
      assert(history.right + 18 <= navigation.left, context);
      assert(history.left >= 0 && navigation.right <= width, context);
      assert.equal(navigation.top - layout.minimap.bottom, 18, context);
      assert.equal(layout.minimap.right, navigation.right, context);
      assert(layout.minimap.left >= 0, context);
      for (const button of buttons) {
        assert(
          button.left >= tools.left && button.right <= tools.right,
          context,
        );
        assert.equal(button.top, buttons[0].top, context);
        assert.equal(button.height, layout.menuButton.height, context);
        if (width > 502)
          assert.equal(button.width, layout.menuButton.width, context);
      }
      if (width > 780) {
        assert.equal(tools.top, menu.top, context);
        assert(tools.left >= menu.right + 18, context);
        const right = actions.visible ? actions.left - 18 : width - 18;
        assert(tools.right <= right, context);
        assert(
          Math.abs(
            (tools.left + tools.right) / 2 - (menu.right + 18 + right) / 2,
          ) < 1,
          context,
        );
      } else {
        assert(tools.top >= menu.bottom, context);
        assert(
          Math.abs((tools.left + tools.right) / 2 - width / 2) < 1,
          context,
        );
      }
      if (width <= 780) {
        assert.equal(menu.top, 0, context);
        assert.equal(tools.top, menu.bottom, context);
        for (const row of [menu, tools]) {
          assert.equal(row.left, 0, context);
          assert.equal(row.width, width, context);
          assert.equal(row.radius, '0px', context);
        }
      }
      if (autosave && [1100, 780, 520, 400, 320].includes(width)) {
        await writeFile(
          path.join(profile, `chrome-${width}.png`),
          Buffer.from(
            await request(`/session/${session}/screenshot`, undefined, 'GET'),
            'base64',
          ),
        );
      }
    }
    await sync(
      `document.querySelector('.recursive-bookmarks > summary').click()`,
    );
    assert(
      await sync(
        `return document.querySelector('.recursive-bookmarks > summary').getAttribute('aria-label')==='Bookmarks' && !!document.querySelector('[aria-label="New bookmark name"]').getClientRects().length`,
      ),
    );
    await sync(
      `document.querySelector('.recursive-bookmarks > summary').click()`,
    );
    await click('Menu');
    assert(
      await sync(
        `return ['Save All','Export'].every(label=>[...document.querySelectorAll('#document-menu button')].some(b=>b.textContent.trim()===label && b.getClientRects().length && !b.disabled))`,
      ),
    );
    await click('Menu');
  }
  await click('Minimap');
  assert(await sync('return !document.querySelector(".canvas-minimap")'));
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  console.log(
    `PASS responsive chrome: centered tools, progressive file/bookmark/zoom controls, anchored minimap, flush narrow rows, Autosave and menu access. Evidence: ${profile}`,
  );
} finally {
  await driver.close();
}
