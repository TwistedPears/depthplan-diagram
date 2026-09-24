import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { launchNative } from './native-driver.mjs';
import client from './mcp/native-client.cjs';
const bundled = await build({
  entryPoints: ['src/shared/stressDocument.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
});
const { generateStressDocument, stressPresets, stressGeneratorVersion } =
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(bundled.outputFiles[0].contents).toString('base64')
  );
// Seeded settings shared with the full capacity matrix.
const workloads = {
  small: stressPresets.small,
  dense: stressPresets.dense,
  'reveal-all': {
    ...stressPresets['reveal-all'],
    depthMode: 'mixed',
    savedLayouts: 3,
  },
  sparse: stressPresets.sparse,
  deep: stressPresets.deep,
  'text-heavy': {
    ...stressPresets.small,
    roots: 4,
    breadth: 4,
    textCharacters: 1000,
    codeLines: 20,
    rootSpacing: 1000,
  },
  'many-layout': {
    ...stressPresets.small,
    roots: 4,
    breadth: 1,
    depth: 16,
    savedLayouts: 17,
  },
  large: stressPresets.large,
};
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : Object.keys(workloads);
for (const name of names)
  assert(Object.hasOwn(workloads, name), `Unknown workload ${name}`);
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samplesMs: values,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
const report = {
  runtime: 'Tauri 2.11.6',
  scope:
    'instrumented native build; diagnostic timings, not production acceptance',
  date: new Date().toISOString(),
  host: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
  },
  viewport: { width: 1280, height: 900 },
  generatorVersion: stressGeneratorVersion,
  seed: 'capacity-v1',
  scriptSha256: await hash('scripts/measure-native-capacity.mjs'),
  timing:
    'Node monotonic clock around native driver/MCP operation and completion check; includes transport/poll overhead. No filesystem cache flush. Five samples; p95 is the maximum.',
  input:
    'DOM button clicks and spec-correct MouseEvent drags in the native WebView; not hardware input latency.',
  memoryScope:
    'Host process RSS only. OS WebView/GPU/network helpers are NOT included; no total-memory acceptance claim.',
  workloads: [],
};
await mkdir('out/capacity', { recursive: true });
for (const name of names) {
  let driver, probe;
  const result = { name, measurements: {}, errors: [] };
  report.workloads.push(result);
  try {
    const fixture = generateStressDocument({
      ...workloads[name],
      seed: 'capacity-v1',
    });
    result.counts = fixture.counts;
    result.settings = fixture.settings;
    const started = performance.now();
    driver = await launchNative();
    const {
      profile,
      binary,
      adapter,
      app,
      sync,
      js,
      native,
      dialogs,
      click,
      drag,
      until,
    } = driver;
    result.profile = profile;
    result.binarySha256 = await hash(binary);
    result.startupMs = performance.now() - started;
    await js('document.fonts.ready.then(()=>true)');
    const source = path.join(profile, 'input.depthplan.json');
    await writeFile(source, JSON.stringify(fixture.document));
    result.documentBytes = (await readFile(source)).length;
    await click('Menu');
    await sync(
      'document.querySelector(`[role=switch][aria-label="MCP Server"]`).click()',
    );
    await until(() =>
      sync(
        'return document.querySelector(`[role=switch][aria-label="MCP Server"]`).getAttribute("aria-checked")==="true"',
      ),
    );
    const status = await native('automation:status');
    probe = client(adapter, status.descriptor);
    await probe.initialize();
    let context = await probe.call('depthplan_get_context');
    assert.equal(context.ok, true, JSON.stringify(context));
    const opened = [];
    let sourceRecord;
    for (let i = 0; i < 6; i++) {
      await dialogs('open', source);
      const previous = (await probe.call('depthplan_get_context')).state
        .sessionId;
      const start = performance.now();
      await click('Open');
      await until(async () => {
        const current = await probe.call('depthplan_get_context');
        return current.ok && current.state.sessionId !== previous;
      });
      await js(
        'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
      );
      opened.push(performance.now() - start);
    }
    result.coldOpenMs = opened.shift();
    result.measurements.warmOpen = summary(opened);
    const measure = async (label, fn) => {
      const values = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await fn(i);
        values.push(performance.now() - start);
      }
      result.measurements[label] = summary(values);
    };
    const beforeZoom = (await probe.call('depthplan_get_state')).data.camera;
    await measure('zoom', async () => {
      await click('Zoom in');
      await js(
        'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
      );
    });
    const afterZoom = (await probe.call('depthplan_get_state')).data.camera;
    assert(
      afterZoom.scale > beforeZoom.scale,
      'Zoom did not change the camera',
    );
    await measure('pan', async (i) => {
      await drag(600, 500, 20 + i, 15);
      await js(
        'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
      );
    });
    const afterPan = (await probe.call('depthplan_get_state')).data.camera;
    assert(
      afterPan.x !== afterZoom.x || afterPan.y !== afterZoom.y,
      'Pan did not change the camera',
    );
    context = await probe.call('depthplan_get_context');
    assert.equal(context.data.roots.length, fixture.counts.roots);
    const root = context.data.roots.find((r) => r.maximumDepth > 0);
    await measure('depthMutation', async (i) => {
      context = await probe.call('depthplan_get_context');
      const value = await probe.call('depthplan_set_depth', {
        handle: {
          appInstanceId: context.state.appInstanceId,
          sessionId: context.state.sessionId,
        },
        rootId: root.id,
        depth:
          context.data.roots.find((r) => r.id === root.id).selectedDepth === 0
            ? 1
            : 0,
        expectedRevision: context.state.revision,
        requestId: `capacity-${i}`,
      });
      assert.equal(value.ok, true, JSON.stringify(value));
      assert.equal(value.state.revision, context.state.revision + 1);
    });
    await measure('undo', async () => {
      const before = (await probe.call('depthplan_get_context')).state.revision;
      await click('Undo');
      const value = await probe.call('depthplan_get_context');
      assert.equal(value.ok, true);
      assert.equal(value.state.revision, before + 1);
    });
    await measure('nativeSave', async (i) => {
      const target = path.join(profile, `saved-${i}.depthplan.json`);
      await dialogs('save', target);
      const value = await native('file:save', fixture.document);
      assert.equal(value.status, 'success', JSON.stringify(value));
      assert.deepEqual(
        JSON.parse(await readFile(target, 'utf8')).objects,
        fixture.document.objects,
      );
      sourceRecord = value.source;
    });
    const recoverySession = randomUUID();
    await measure('checkpoint', (i) =>
      native('recovery:write', {
        sessionId: recoverySession,
        revision: i,
        sourceId: sourceRecord.id,
        document: fixture.document,
      }),
    );
    await native('recovery:remove', recoverySession);
    if (process.platform !== 'win32')
      result.hostRssKiB = Number(
        execFileSync('ps', ['-o', 'rss=', '-p', String(app.pid)], {
          encoding: 'utf8',
        }).trim(),
      );
    assert.deepEqual(await sync('return window.nativeErrors'), []);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.errors.push(String(error));
    process.exitCode = 1;
  } finally {
    probe?.close();
    await driver?.close();
    await writeFile(
      'out/capacity/tauri-diagnostic.json',
      JSON.stringify(report, null, 2) + '\n',
    );
  }
  console.log(`${name}: ${result.status}`);
}
console.log(
  'Diagnostic report: out/capacity/tauri-diagnostic.json. Export/restore/leak testing and total WebView memory remain separate release gates.',
);
