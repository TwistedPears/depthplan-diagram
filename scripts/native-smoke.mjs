import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import client from './mcp/native-client.cjs';
import { launchNative } from './native-driver.mjs';
import { authoring } from './native-authoring.mjs';
import { searchProbe } from './native-search.mjs';
import { layering } from './native-layering.mjs';
import { expansion } from './native-expansion.mjs';
import { connectors } from './native-connectors.mjs';
import { rotation } from './native-rotation.mjs';
import { childContent } from './native-child-content.mjs';
const {
  adapter,
  profile,
  app,
  session,
  request,
  sync,
  native,
  dialogs,
  click,
  drag,
  until,
  close,
} = await launchNative(undefined, [
  pathToFileURL(path.resolve('docs/sample/recursive_document.depthplan')).href,
]);
let probe;
let resumed;
try {
  await until(() =>
    sync(
      'return document.body.textContent.includes("recursive_document.depthplan")',
    ),
  );
  const instance = await native('app:instance-id');
  assert.match(instance, /^[a-f0-9-]{36}$/);
  assert.equal((await native('automation:status')).enabled, false);
  probe = client(adapter, path.join(profile, 'missing.json'));
  await probe.initialize();
  assert.equal(
    (await probe.call('depthplan_get_context')).error.code,
    'APP_UNAVAILABLE',
  );
  probe.close();
  const sample = JSON.parse(
    await readFile('docs/sample/recursive_document.depthplan', 'utf8'),
  );
  const target = path.join(profile, 'roundtrip.depthplan.json');
  sample.extensions = {
    ...sample.extensions,
    nativeRoundtrip: { preserved: true },
  };
  await dialogs('save', target);
  let saved = await native('file:save', sample);
  assert.equal(saved.status, 'success', JSON.stringify(saved));
  assert.deepEqual(await native('test:last-file-dialog'), {
    kind: 'document-save',
    name: 'untitled.depthplan',
  });
  assert.deepEqual(
    JSON.parse(await readFile(target, 'utf8')).extensions,
    sample.extensions,
  );
  await writeFile(target, 'external edit');
  await dialogs('message', 'Cancel');
  assert.equal(
    (await native('file:save', sample, saved.source.id)).status,
    'canceled',
  );
  assert.equal(await readFile(target, 'utf8'), 'external edit');
  await dialogs('message', 'Overwrite');
  saved = await native('file:save', sample, saved.source.id);
  assert.equal(saved.status, 'success', JSON.stringify(saved));
  await dialogs('save', null);
  assert.equal((await native('file:save', sample)).status, 'canceled');
  assert.equal(
    (await native('file:reload-document', 'forged')).status,
    'error',
  );
  const before = await readFile(target, 'utf8');
  assert.equal(
    (await native('file:save', { metadata: {} }, saved.source.id)).status,
    'error',
  );
  assert.equal(await readFile(target, 'utf8'), before);
  // Ordinary Save retains the legacy source; Save As offers the new suffix and
  // leaves the source intact. Explicit chooser paths remain the user's choice.
  saved = await native('file:save', sample, saved.source.id);
  assert.equal(saved.source.path, target);
  const legacyBytes = await readFile(target, 'utf8');
  await dialogs('save', null);
  assert.equal(
    (await native('file:save', sample, saved.source.id, true)).status,
    'canceled',
  );
  assert.equal(
    (await native('test:last-file-dialog')).name,
    'roundtrip.depthplan',
  );
  const migratedPath = path.join(profile, '旧 diagram.depthplan');
  await dialogs('save', migratedPath);
  const migrated = await native('file:save', sample, saved.source.id, true);
  assert.equal(migrated.status, 'success', JSON.stringify(migrated));
  assert.equal(migrated.source.path, migratedPath);
  assert.equal(await readFile(target, 'utf8'), legacyBytes);
  assert.deepEqual(
    JSON.parse(await readFile(migratedPath, 'utf8')).objects,
    sample.objects,
  );
  assert.equal(
    (await native('file:reload-document', migrated.source.id)).status,
    'success',
  );
  assert.equal(
    (await native('file:open-request', migratedPath)).status,
    'error',
  );
  await native('test:open-files', [migratedPath]);
  await until(() =>
    sync('return document.body.textContent.includes(arguments[0])', [
      '旧 diagram.depthplan',
    ]),
  );
  await until(async () => (await native('file:open-requests')).length === 0);
  // Load through the real renderer document lifecycle, with only the native chooser automated.
  await dialogs('open', target);
  await click('Menu');
  await click('Open');
  await until(() =>
    sync(
      'return !!document.querySelector(`[aria-label$="recursive diagram"]`)',
    ),
  );
  await click('Menu');
  await sync(
    `const enable = window.desktop.automation.enable;
     window.desktop.automation.enable = (...args) => enable(...args).catch(error => {
       window.nativeErrors.push(String(error)); throw error;
     });
     document.querySelector('[role=switch][aria-label="MCP Server"]').click()`,
  );
  await until(() =>
    sync(
      'if(window.nativeErrors.length)throw new Error(window.nativeErrors.join("; "));return document.querySelector(`[role=switch][aria-label="MCP Server"]`).getAttribute("aria-checked")==="true"',
    ),
  );
  const status = await native('automation:status');
  probe = client(adapter, status.descriptor);
  await probe.initialize();
  const discovered = (await probe.request('tools/list', {})).result.tools;
  const expectedTools = JSON.parse(
    await readFile('src-tauri/generated/mcp-tools.json', 'utf8'),
  );
  for (const expected of expectedTools) {
    const actual = discovered.find((tool) => tool.name === expected.name);
    for (const key of ['inputSchema', 'outputSchema', 'annotations'])
      assert.deepEqual(actual[key], expected[key], `${expected.name} ${key}`);
  }
  await searchProbe(probe);
  let context = await probe.call('depthplan_get_context');
  assert.equal(context.ok, true, JSON.stringify(context));
  const root = context.data.roots.find((r) => r.maximumDepth > 0);
  assert.ok(root);
  const input = {
    handle: {
      appInstanceId: context.state.appInstanceId,
      sessionId: context.state.sessionId,
    },
    rootId: root.id,
    depth: root.selectedDepth === 0 ? 1 : 0,
    expectedRevision: context.state.revision,
    requestId: 'tauri-native-depth',
  };
  const applied = await probe.call('depthplan_set_depth', input);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.state.revision, context.state.revision + 1);
  assert.equal(
    (await probe.call('depthplan_set_depth', input)).data.replayed,
    true,
  );
  assert.equal(
    (await probe.call('depthplan_set_depth', { ...input, requestId: 'stale' }))
      .error.code,
    'STALE_REVISION',
  );
  await click('Undo');
  context = await probe.call('depthplan_get_context');
  assert.equal(context.state.revision, applied.state.revision + 1);
  // Wheel zoom stays anchored at the pointer without a modifier; right-drag pans.
  const camera = () =>
    sync(
      'const s=window.Konva.stages[0];return {x:s.x(),y:s.y(),scale:s.scaleX()}',
    );
  await click('Zoom out');
  const initialCamera = await camera();
  for (const deltaY of [-80, 80]) {
    const before = await camera();
    await sync(
      'const el=document.querySelector(".konvajs-content"),r=el.getBoundingClientRect();el.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,clientX:r.left+420,clientY:r.top+300,deltaY:arguments[0]}))',
      [deltaY],
    );
    await until(async () =>
      deltaY < 0
        ? (await camera()).scale > before.scale
        : (await camera()).scale < before.scale,
    );
    const after = await camera();
    for (const [axis, point] of [
      ['x', 420],
      ['y', 300],
    ])
      assert(
        Math.abs(
          (point - after[axis]) / after.scale -
            (point - before[axis]) / before.scale,
        ) < 1e-6,
      );
  }
  const zoomed = await camera();
  assert(Math.abs(zoomed.scale - initialCamera.scale) < 1e-6);
  await drag(640, 500, -40, -25);
  await until(async () => (await camera()).x === zoomed.x - 40);
  const panned = await camera();
  assert.equal(panned.y, zoomed.y - 25);
  assert.equal(panned.scale, zoomed.scale);
  await click('Reset view');
  for (const format of ['svg', 'png']) {
    const image = path.join(profile, `editor-export.${format}`);
    await click('Export current diagram');
    await sync(
      'const select=document.querySelector(`select[aria-label="Format"]`);select.value=arguments[0];select.dispatchEvent(new Event("change",{bubbles:true}))',
      [format],
    );
    await dialogs('save', image);
    await click('Export');
    await until(async () => {
      try {
        return (await readFile(image)).length > 100;
      } catch {
        return false;
      }
    });
    const bytes = await readFile(image);
    if (format === 'png') {
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
    } else {
      assert.equal(
        await sync(
          'return new DOMParser().parseFromString(arguments[0],"image/svg+xml").documentElement.localName',
          [bytes.toString()],
        ),
        'svg',
      );
    }
  }
  await click('Export current diagram');
  await dialogs('save', null);
  await click('Export');
  await until(() =>
    sync('return document.body.textContent.includes("Export canceled")'),
  );
  await dialogs('folder', profile);
  await native('mcp:approve-folder');
  const lease = await native('mcp:lease');
  assert.equal(
    (await native('mcp:read', target, lease)).document.id,
    sample.id,
  );
  const unsupportedPath = path.join(profile, 'unsupported.depthplan.json');
  const unchanged = await probe.call('depthplan_get_state');
  for (const formatVersion of [undefined, 1, 3]) {
    const unsupported = { ...sample, formatVersion };
    const bytes = JSON.stringify(unsupported);
    await writeFile(unsupportedPath, bytes);
    await dialogs('open', unsupportedPath);
    await click('Menu');
    await click('Open');
    await until(() =>
      sync(
        'return document.body.textContent.includes("unsupported document format")',
      ),
    );
    await assert.rejects(
      () => native('mcp:read', unsupportedPath, lease),
      /unsupported document format/,
    );
    await assert.rejects(
      () =>
        native('recovery:write', {
          sessionId: crypto.randomUUID(),
          revision: 0,
          document: unsupported,
        }),
      /unsupported document format/,
    );
    assert.deepEqual(await probe.call('depthplan_get_state'), unchanged);
    assert.equal(await readFile(unsupportedPath, 'utf8'), bytes);
  }
  const exportPath = path.join(profile, 'native.svg');
  await native('mcp:write', {
    path: exportPath,
    lease,
    kind: 'svg',
    expected: null,
    data: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  assert.match(await readFile(exportPath, 'utf8'), /^<svg/);
  const grant = (await native('mcp:folders'))[0];
  await native('mcp:revoke-folder', grant.id);
  await assert.rejects(
    () => native('mcp:read', target, lease),
    /outside approved/,
  );
  await native('mcp:release', lease);
  const orphanId = crypto.randomUUID(),
    oldInstance = crypto.randomUUID();
  const recoverySample = {
    ...sample,
    namedViews: Object.fromEntries(
      ['z-first', 'a-last'].map((id) => [
        id,
        {
          id,
          name: id,
          rootDepths: sample.rootDepths,
        },
      ]),
    ),
  };
  const orphan = path.join(profile, 'recovery', `2147483647-${oldInstance}`);
  await mkdir(orphan, { recursive: true });
  await writeFile(
    path.join(orphan, orphanId + '.json'),
    JSON.stringify({
      version: 1,
      instanceId: oldInstance,
      sessionId: orphanId,
      documentId: sample.id,
      revision: 4,
      capturedAt: new Date().toISOString(),
      source: null,
      document: recoverySample,
    }),
  );
  await writeFile(path.join(orphan, 'corrupt.json'), '{bad');
  const found = await native('recovery:discover');
  assert.equal(found.entries.length, 1);
  assert.equal(found.warnings.length, 1);
  const recovered = await native('recovery:prepare', found.entries[0].id);
  assert.deepEqual(recovered.document, recoverySample);
  assert.deepEqual(Object.keys(recovered.document.namedViews), [
    'z-first',
    'a-last',
  ]);
  await native('recovery:release', found.entries[0].id);
  const accepted = await native('recovery:prepare', found.entries[0].id);
  await native('recovery:write', {
    sessionId: accepted.sessionId,
    revision: 0,
    document: accepted.document,
  });
  assert.equal((await native('recovery:discover')).entries.length, 0);
  await native('recovery:write', {
    sessionId: accepted.sessionId,
    revision: 2,
    document: accepted.document,
  });
  await native('recovery:remove', accepted.sessionId, 1);
  const checkpoint = path.join(
    profile,
    'recovery',
    `${app.pid}-${instance}`,
    accepted.sessionId + '.json',
  );
  assert.equal(JSON.parse(await readFile(checkpoint, 'utf8')).revision, 2);
  assert.deepEqual(
    Object.keys(
      JSON.parse(await readFile(checkpoint, 'utf8')).document.namedViews,
    ),
    ['z-first', 'a-last'],
  );
  await native('recovery:remove', accepted.sessionId);
  await assert.rejects(() => readFile(checkpoint));
  await native('automation:enable', false);
  assert.equal(
    (await probe.call('depthplan_get_context')).error.code,
    'DISABLED',
  );
  // Re-enable through the UI to update its acknowledged enabled state.
  await native('automation:enable', true);
  assert.equal((await probe.call('depthplan_get_context')).ok, true);
  assert.deepEqual(await sync('return window.nativeErrors'), []);
  const shot = await request(
    `/session/${session}/screenshot`,
    undefined,
    'GET',
  );
  await writeFile(
    path.join(profile, 'native-smoke.png'),
    Buffer.from(shot, 'base64'),
  );
  // Crash the owned GUI process after its real recovery scheduler acknowledges
  // an accepted edit, then restore through the new process's actual editor UI.
  context = await probe.call('depthplan_get_context');
  const recoveredDepth =
    context.data.roots.find((r) => r.id === root.id).selectedDepth === 0
      ? 1
      : 0;
  const beforeCrash = await probe.call('depthplan_set_depth', {
    ...input,
    handle: {
      appInstanceId: context.state.appInstanceId,
      sessionId: context.state.sessionId,
    },
    depth: recoveredDepth,
    expectedRevision: context.state.revision,
    requestId: 'tauri-crash-recovery',
  });
  assert.equal(beforeCrash.ok, true, JSON.stringify(beforeCrash));
  const crashCheckpoint = path.join(
    profile,
    'recovery',
    `${app.pid}-${instance}`,
    context.state.sessionId + '.json',
  );
  await until(async () => {
    try {
      return (
        JSON.parse(await readFile(crashCheckpoint, 'utf8')).revision ===
        beforeCrash.state.revision
      );
    } catch {
      return false;
    }
  });
  await dialogs('message', 'Cancel');
  await click('New');
  await until(async () => (await probe.call('depthplan_get_context')).ok);
  assert.equal(
    (await probe.call('depthplan_get_context')).state.sessionId,
    context.state.sessionId,
  );
  probe.close();
  app.kill('SIGKILL');
  await close();
  resumed = await launchNative(profile);
  await resumed.until(() =>
    resumed.sync(
      'return !!document.querySelector(`dialog[aria-label="Recover unsaved work"][open] section`)',
    ),
  );
  await resumed.click('Restore');
  await resumed.until(() =>
    resumed.sync(
      'return !document.querySelector(`dialog[aria-label="Recover unsaved work"][open]`)',
    ),
  );
  await resumed.click('Menu');
  await resumed.sync(
    'document.querySelector(`[role=switch][aria-label="MCP Server"]`).click()',
  );
  await resumed.until(
    async () => (await resumed.native('automation:status')).enabled,
  );
  const resumedDescriptor = (await resumed.native('automation:status'))
    .descriptor;
  probe = client(resumed.adapter, resumedDescriptor);
  await probe.initialize();
  const restoredContext = await probe.call('depthplan_get_context');
  assert.equal(restoredContext.ok, true, JSON.stringify(restoredContext));
  assert.notEqual(
    restoredContext.state.appInstanceId,
    context.state.appInstanceId,
  );
  assert.notEqual(restoredContext.state.sessionId, context.state.sessionId);
  assert.equal(
    restoredContext.data.roots.find((r) => r.id === root.id).selectedDepth,
    recoveredDepth,
  );
  assert.equal(
    await resumed.sync(
      'return document.querySelector(`button[aria-label="Undo"]`).disabled',
    ),
    true,
  );
  const restoredPath = path.join(profile, 'restored.depthplan.json');
  await resumed.native('test:dialogs', [
    { kind: 'message', value: 'Save As' },
    { kind: 'save', value: restoredPath },
  ]);
  await resumed.click('Save document');
  await resumed.until(async () => {
    try {
      return (
        JSON.parse(await readFile(restoredPath, 'utf8')).rootDepths[root.id] ===
        recoveredDepth
      );
    } catch {
      return false;
    }
  });
  assert.deepEqual(await resumed.sync('return window.nativeErrors'), []);
  await layering(resumed, probe);
  await expansion(resumed, probe);
  await connectors(resumed, probe);
  await rotation(resumed, probe);
  await childContent(resumed, probe);
  await authoring(resumed, probe);
  await assert.rejects(stat(path.dirname(resumedDescriptor)), {
    code: 'ENOENT',
  });
  console.log(
    `PASS Tauri native smoke: full authoring/bookmarks/roundtrip/normal Quit, files/conflicts/cancellation, pointer-anchored wheel zoom/right-drag pan, whole/selection SVG/PNG delivery, recovery revision zero/order/claims, process crash/Restore/Save As, 26-tool MCP schema parity, live mutation/replay/Undo/revocation, folder access. Evidence: ${profile}`,
  );
} catch (error) {
  const active = resumed ?? { app, request, session, sync };
  const failure = { error: String(error.stack ?? error) };
  if (active.app.exitCode === null) {
    try {
      failure.console = await active.sync('return window.nativeErrors');
      const shot = await active.request(
        `/session/${active.session}/screenshot`,
        undefined,
        'GET',
      );
      await writeFile(
        path.join(profile, 'failure.png'),
        Buffer.from(shot, 'base64'),
      );
    } catch (captureError) {
      failure.captureError = String(captureError);
    }
  }
  await writeFile(
    path.join(profile, 'failure.json'),
    JSON.stringify(failure, null, 2),
  );
  console.error(`Native failure evidence: ${profile}`);
  throw error;
} finally {
  probe?.close();
  await close();
  await resumed?.close();
}
