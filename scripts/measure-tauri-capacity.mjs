import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { launchNative } from './native-driver.mjs';
import client from './mcp/native-client.cjs';

// Full capacity matrix with fixed generator settings, repetitions and budgets.
// Do not substitute the smaller diagnostic runner.
assert.equal(
  process.platform,
  'darwin',
  'Process attribution currently supports macOS only',
);
const exec = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = async (file) =>
  createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
async function until(check, label = 'condition', ms = 30000) {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    const value = await check();
    if (value) return value;
    await wait(20);
  }
  throw new Error(`Timed out: ${label}`);
}
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samplesMs: values,
  };
};
const compiled = await build({
  stdin: {
    contents:
      'export * from "./src/shared/stressDocument"; export { validateRecursiveDocument } from "./src/shared/recursiveDocument";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
});
const mod = { exports: {} };
new Function('module', 'exports', compiled.outputFiles[0].text)(
  mod,
  mod.exports,
);
const {
  generateStressDocument,
  stressPresets,
  stressGeneratorVersion,
  validateRecursiveDocument,
} = mod.exports;
const cases = {
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
const selected = process.argv.slice(2);
for (const name of selected)
  assert(Object.hasOwn(cases, name), `Unknown workload ${name}`);
const executable = path.resolve(
  process.env.DEPTHPLAN_EXECUTABLE || 'src-tauri/target/release/depthplan',
);
const adapter = path.join(path.dirname(executable), 'depthplan-mcp');
process.env.DEPTHPLAN_EXECUTABLE = executable;
await fs.mkdir('out/capacity', { recursive: true });
const directory = await fs.mkdtemp(path.resolve('out/capacity/tauri-'));
const report = {
  kind: 'DepthPlan full Tauri capacity study',
  runtime: 'Tauri 2.11.6 / system WKWebView',
  scope:
    'Optimized instrumented native package. Release acceptance additionally requires representative uninstrumented measurements.',
  directory,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  sourceDiffSHA256: createHash('sha256')
    .update(execFileSync('git', ['diff', 'HEAD']))
    .digest('hex'),
  applicationSourceSHA256: Object.fromEntries(
    await Promise.all(
      [
        ...new Set(
          execFileSync(
            'git',
            [
              'ls-files',
              '-z',
              '--cached',
              '--others',
              '--exclude-standard',
              '--',
              'src',
              'src-tauri',
            ],
            { encoding: 'utf8' },
          )
            .split('\0')
            .filter(Boolean),
        ),
      ]
        .sort()
        .map(async (file) => [file, await hash(file)]),
    ),
  ),
  benchmarkSHA256: await hash('scripts/measure-tauri-capacity.mjs'),
  driverSHA256: await hash('scripts/native-driver.mjs'),
  nativeInspectionSHA256: await hash('src-tauri/src/test_processes.rs'),
  lockfileSHA256: {
    npm: await hash('package-lock.json'),
    cargo: await hash('src-tauri/Cargo.lock'),
  },
  testFeatures: ['automation', 'custom-protocol'],
  executable,
  executableSHA256: await hash(executable),
  adapterSHA256: await hash(adapter),
  executableBytes: (await fs.stat(executable)).size,
  adapterBytes: (await fs.stat(adapter)).size,
  host: {
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    ramBytes: os.totalmem(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    macOS: execFileSync('sw_vers', ['-productVersion'], {
      encoding: 'utf8',
    }).trim(),
    driverNode: process.version,
    webKitBuild: execFileSync(
      '/usr/libexec/PlistBuddy',
      [
        '-c',
        'Print :CFBundleVersion',
        '/System/Library/Frameworks/WebKit.framework/Resources/Info.plist',
      ],
      { encoding: 'utf8' },
    ).trim(),
  },
  generatorVersion: stressGeneratorVersion,
  seed: 'capacity-v1',
  viewport: { width: 1280, height: 900 },
  started: new Date().toISOString(),
  results: [],
  method:
    'Fresh isolated process/profile per workload. One cold-process Open, five warm Opens; OS cache not flushed. Buttons: DOM click to two animation frames in WKWebView. Right-drag pan: driver dispatch through two frames, including transport. Native I/O, restore and checkpoints include driver/poll overhead. Five samples unless specified; nearest-rank p95 is descriptive. Dense soak establishes and records native window focus before each timed cycle. Depth controls exposed by test CSS. No hardware input latency claim.',
  memoryMethod:
    'ps RSS every 200ms and at named phases, exact host/WebContent/GPU/network PIDs obtained from test-only WebKit selectors each launch and verified at phases. Includes a conservative sum of WebContent+GPU+network against the old renderer budget; host uses old main budget. RSS is not physical footprint; shared pages may be counted more than once. Sub-200ms peaks may be missed. Idle CPU is process CPU-time delta over five seconds, 100% means one core.',
  budgets: {
    panZoomMs: 200,
    acceptedEditMs: 250,
    warmOpenSaveRestoreMs: 1000,
    checkpointMs: 2000,
    compactExportMs: 1500,
    rendererKiB: 1.5 * 1024 * 1024,
    hostKiB: 350 * 1024,
  },
};
const persist = () =>
  fs.writeFile(
    path.join(directory, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
console.log(`Report: ${directory}/report.json`);
await persist();
for (const [name, settings] of Object.entries(cases)) {
  if (selected.length && !selected.includes(name)) continue;
  const generated = generateStressDocument({
    ...settings,
    seed: 'capacity-v1',
  });
  const work = path.join(directory, name),
    profile = path.join(work, 'profile');
  await fs.mkdir(profile, { recursive: true });
  const source = path.join(work, 'input.depthplan.json');
  const result = {
    name,
    settings: generated.settings,
    counts: generated.counts,
    metrics: {},
    memory: [],
    memorySamples: [],
    history: [],
    artifacts: [source],
    status: 'running',
    correctness: [],
  };
  report.results.push(result);
  let driver,
    probe,
    sampleTimer,
    samplePending = Promise.resolve(),
    pids,
    samplingError,
    launches = 0;
  let recoveredDocument;
  const started = performance.now();
  const root = Object.keys(generated.document.rootDepths)[0],
    rootName = generated.document.objects[root].name;
  const record = (label, ms) => (result.metrics[label] ??= []).push(ms);
  const measure = async (label, fn) => {
    const start = performance.now();
    const value = await fn();
    record(label, performance.now() - start);
    return value;
  };
  const paint = () =>
    driver.js(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))',
    );
  const button = (label) =>
    `Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}||b.title===${JSON.stringify(label)})`;
  const click = async (label, metric) => {
    const ms = await driver.js(
      `new Promise((resolve,reject)=>{const b=${button(label)};if(!b||b.disabled)return reject(new Error('Missing/disabled button '+${JSON.stringify(label)}));const start=performance.now();b.click();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)))})`,
    );
    if (metric) record(metric, ms);
  };
  const fill = (selector, value) =>
    driver.sync(
      `const el=document.querySelector(arguments[0]);if(!el)throw new Error('Missing input '+arguments[0]);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,arguments[1]);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));`,
      [selector, String(value)],
    );
  const select = (label, value) =>
    driver.sync(
      'const el=document.querySelector(`select[aria-label="${arguments[0]}"]`);if(el){el.value=arguments[1];el.dispatchEvent(new Event("change",{bubbles:true}));}',
      [label, value],
    );
  const inputSelector = `input[aria-label=${JSON.stringify(`${rootName} depth`)}]`;
  const depth = async (value, metric) => {
    await driver.sync('document.querySelector(".depth-navigator").open=true');
    await fill(inputSelector, value);
    await click(`Set ${rootName} depth`, metric);
    assert.equal(
      await driver.sync('return document.querySelector(arguments[0]).value', [
        inputSelector,
      ]),
      String(value),
    );
    assert.equal(
      (await probe.call('depthplan_get_context')).data.roots.find(
        (r) => r.id === root,
      ).selectedDepth,
      value,
    );
  };
  const capture = () =>
    driver.sync(
      `const stage=window.Konva.stages[0];const objects=stage.find('.recursive-object');return {totalRevealed:objects.length,onScreen:objects.filter(n=>{const r=n.getChildren()[0].getClientRect();return r.x+r.width>=0&&r.y+r.height>=0&&r.x<=innerWidth&&r.y<=innerHeight}).length,zoom:stage.scaleX(),x:stage.x(),y:stage.y()}`,
    );
  const checkpointFiles = async () => {
    const base = path.join(profile, 'recovery');
    const files = await fs.readdir(base, { recursive: true }).catch(() => []);
    return (
      await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            try {
              return JSON.parse(await fs.readFile(path.join(base, f), 'utf8'));
            } catch (e) {
              if (e.code === 'ENOENT') return null;
              throw e;
            }
          }),
      )
    ).filter(Boolean);
  };
  const checkpoint = async () => {
    const context = await probe.call('depthplan_get_context');
    assert(context.ok);
    return until(
      async () =>
        (await checkpointFiles()).find(
          (e) =>
            e.sessionId === context.state.sessionId &&
            e.revision === context.state.revision,
        ),
      'exact automatic checkpoint',
    );
  };
  const sample = async () => {
    const measuredPids = {
      ...pids,
      ...(probe ? { adapter: probe.child.pid } : {}),
    };
    const { stdout } = await exec('ps', [
      '-o',
      'pid=,rss=,time=',
      '-p',
      Object.values(measuredPids).join(','),
    ]);
    const processes = Object.fromEntries(
      stdout
        .trim()
        .split('\n')
        .map((line) => {
          const [pid, rss, cpu] = line.trim().split(/\s+/);
          const seconds = cpu
            .split(':')
            .reduce((sum, part) => sum * 60 + Number(part), 0);
          return [pid, { rssKiB: Number(rss), cpuSeconds: seconds }];
        }),
    );
    for (const pid of Object.values(measuredPids))
      assert(processes[pid], `Missing process ${pid}`);
    const row = {
      elapsedMs: performance.now() - started,
      processes,
      hostKiB: processes[pids.host].rssKiB,
      rendererKiB: processes[pids.renderer].rssKiB,
      gpuKiB: processes[pids.gpu].rssKiB,
      networkKiB: processes[pids.network].rssKiB,
      adapterKiB: measuredPids.adapter
        ? processes[measuredPids.adapter].rssKiB
        : 0,
    };
    row.webKitKiB = row.rendererKiB + row.gpuKiB + row.networkKiB;
    row.totalKiB = row.hostKiB + row.webKitKiB + row.adapterKiB;
    result.memorySamples.push(row);
    return row;
  };
  const memory = async (phase) => {
    assert.deepEqual(
      await driver.native('test:processes'),
      pids,
      'Unexpected helper replacement; attribution must be refreshed',
    );
    result.memory.push({ phase, ...(await sample()) });
  };
  const stopSampling = async () => {
    clearInterval(sampleTimer);
    await samplePending;
  };
  const enable = async () => {
    await driver.click('Menu');
    await driver.sync(
      'document.querySelector(`[role=switch][aria-label="MCP Server"]`).click()',
    );
    await until(() =>
      driver.sync(
        'return document.querySelector(`[role=switch][aria-label="MCP Server"]`).getAttribute("aria-checked")==="true"',
      ),
    );
    const status = await driver.native('automation:status');
    probe = client(driver.adapter, status.descriptor);
    await probe.initialize();
    await driver.click('Menu');
  };
  const launch = async () => {
    const start = performance.now();
    driver = await launchNative(profile);
    // WebDriver window rect is outer size; reproduce the original inner viewport.
    const size = await driver.sync(
      'return {width:innerWidth,height:innerHeight}',
    );
    await driver.request(`/session/${driver.session}/window/rect`, {
      width: 1280 + (1280 - size.width),
      height: 900 + (900 - size.height),
    });
    assert.deepEqual(
      await driver.sync('return {width:innerWidth,height:innerHeight}'),
      report.viewport,
    );
    await driver.js('document.fonts.ready.then(()=>true)');
    await driver.sync(
      'const style=document.createElement("style");style.textContent=".depth-navigator{display:block}";document.head.append(style)',
    );
    if (!launches) await enable();
    result.userAgent = await driver.sync('return navigator.userAgent');
    result.displayScale = await driver.sync('return devicePixelRatio');
    pids = await driver.native('test:processes');
    for (const pid of Object.values(pids)) assert(pid > 0);
    (result.processes ??= []).push(pids);
    await sample();
    sampleTimer = setInterval(() => {
      samplePending = samplePending.then(sample).catch((e) => {
        samplingError = String(e);
      });
    }, 200);
    record(launches++ ? 'restart' : 'startup', performance.now() - start);
  };
  const saveAs = async (target, metric = 'save') => {
    await driver.dialogs('save', target);
    await driver.click('Menu');
    await measure(metric, async () => {
      await driver.click('Save As...');
      await until(
        () =>
          driver.sync(
            'return document.body.textContent.includes(arguments[0])',
            [`Saved: ${path.basename(target)}`],
          ),
        'save status',
      );
      await until(() => fs.readFile(target).catch(() => null), 'saved bytes');
    });
    result.artifacts.push(target);
    const doc = JSON.parse(await fs.readFile(target, 'utf8'));
    validateRecursiveDocument(doc);
    return doc;
  };
  const exportImage = async (format, scope, iteration) => {
    const target = path.join(work, `${scope}-${iteration}.${format}`);
    result.artifacts.push(target);
    await driver.click('Export current diagram');
    await until(() =>
      driver.sync(
        'return !!document.querySelector(`dialog[aria-label="Export image"][open]`)',
      ),
    );
    await select('Scope', scope);
    await select('Format', format);
    await driver.dialogs('save', target);
    const began = performance.now();
    try {
      await measure(`${scope}${format.toUpperCase()}`, async () => {
        await driver.click('Export');
        await until(async () => {
          const data = await fs.readFile(target).catch(() => null);
          if (data) return data;
          const error = await driver.sync(
            'return Array.from(document.querySelectorAll(`[role="status"]`)).map(e=>e.textContent).find(s=>/PNG exceeds|PNG encoding failed|Image export failed|Nothing to export/.test(s))',
          );
          if (error) throw new Error(error);
          return false;
        }, `${scope} ${format} bytes`);
      });
    } catch (e) {
      await driver.native('test:dialogs', []);
      if (format !== 'png' || !String(e).includes('PNG exceeds')) throw e;
      (result.refusals ??= []).push({
        scope,
        format,
        error: String(e),
        elapsedMs: performance.now() - began,
      });
      return false;
    }
    const bytes = await fs.readFile(target);
    assert(bytes.length > 100);
    if (format === 'png') {
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
    } else {
      // Large valid SVGs exceed the driver's request-body limit. Parsing is an
      // untimed correctness check; chunk transport without relaxing that limit.
      await driver.sync('window.capacitySvgChunks=[]');
      const svg = bytes.toString();
      for (let offset = 0; offset < svg.length; offset += 128 * 1024)
        await driver.sync('window.capacitySvgChunks.push(arguments[0])', [
          svg.slice(offset, offset + 128 * 1024),
        ]);
      assert.equal(
        await driver.sync(
          'const svg=window.capacitySvgChunks.join("");delete window.capacitySvgChunks;const doc=new DOMParser().parseFromString(svg,"image/svg+xml");return doc.documentElement.localName==="svg"&&doc.querySelector("parsererror")===null',
        ),
        true,
      );
    }
    return true;
  };
  try {
    await launch();
    for (let i = 0; i < 6; i++) {
      const doc = {
        ...generated.document,
        metadata: {
          ...generated.document.metadata,
          title: `Capacity ${name} ${i}`,
        },
      };
      await fs.writeFile(source, JSON.stringify(doc));
      result.fileBytes = (await fs.stat(source)).size;
      await driver.dialogs('open', source);
      await measure(i ? 'loadWarm' : 'loadCold', async () => {
        await driver.click('Open');
        await until(
          () =>
            driver.sync(
              'return document.body.textContent.includes(arguments[0])&&!document.querySelector("[inert]")',
              [doc.metadata.title],
            ),
          'opened document',
        );
        await paint();
      });
      assert.equal((await capture()).totalRevealed, generated.counts.visible);
    }
    const originalSourceHash = await hash(source);
    await click('Reset view');
    result.initialScene = await capture();
    result.correctness.push('Six opens reveal expected object count');
    await memory('before-mcp');
    for (let i = 0; i < 5; i++) {
      const state = (await probe.call('depthplan_get_state')).data;
      const rows = await measure('mcpQueryPage', () =>
        probe.call('depthplan_query', {
          handle: state.handle,
          collection: 'objects',
          pageSize: 100,
        }),
      );
      assert(rows.ok, JSON.stringify(rows));
      assert(rows.data.items.length <= 100);
      const ids = rows.data.items.filter((r) => r.visible).map((r) => r.id);
      result.mcpMoveObjects = ids.length;
      const edit = await measure('mcpMoveBatch', () =>
        probe.call('depthplan_edit', {
          handle: state.handle,
          expectedRevision: state.revision,
          expectedViewRevision: state.viewRevision,
          requestId: `move-${i}`,
          actions: [{ type: 'move', ids, delta: { x: 1, y: 0 } }],
        }),
      );
      assert(edit.ok, JSON.stringify(edit));
      const after = (await probe.call('depthplan_get_state')).data;
      const undo = await probe.call('depthplan_history', {
        handle: after.handle,
        expectedRevision: after.revision,
        expectedViewRevision: after.viewRevision,
        requestId: `undo-${i}`,
        direction: 'undo',
      });
      assert(undo.ok, JSON.stringify(undo));
    }
    await memory('after-mcp');
    await memory('history-0');
    for (let i = 0; i < 5; i++) {
      await driver.sync(
        'document.querySelector(".depth-navigator").open=false',
      );
      const before = await capture();
      await measure('panInputToPaint', async () => {
        await driver.drag(640, 500, -40, -25);
        await paint();
      });
      const panned = await capture();
      assert.equal(panned.x, before.x - 40);
      assert.equal(panned.y, before.y - 25);
      await click('Zoom in', 'zoomInputToPaint');
      assert((await capture()).zoom > before.zoom);
      await click('Zoom out');
      if (
        Number(
          await driver.sync(
            'return document.querySelector(arguments[0]).value',
            [inputSelector],
          ),
        ) !== 0
      )
        await depth(0, 'collapseInputToPaint');
      await depth(
        generated.settings.depth,
        i ? 'savedDepthInputToPaint' : 'firstRevealInputToPaint',
      );
      await click('Undo', 'undoInputToPaint');
      assert.equal(
        await driver.sync('return document.querySelector(arguments[0]).value', [
          inputSelector,
        ]),
        '0',
      );
      await click('Redo', 'redoInputToPaint');
      assert.equal(
        await driver.sync('return document.querySelector(arguments[0]).value', [
          inputSelector,
        ]),
        String(generated.settings.depth),
      );
    }
    result.firstRevealUsedSavedLayout = Object.hasOwn(
      generated.document.layouts[root],
      generated.settings.depth,
    );
    result.revealedScene = await capture();
    const selectRoot = async () => {
      const state = (await probe.call('depthplan_get_state')).data;
      const response = await probe.call('depthplan_selection', {
        handle: state.handle,
        expectedRevision: state.revision,
        expectedViewRevision: state.viewRevision,
        requestId: `select-${state.revision}-${state.viewRevision}`,
        action: 'set',
        objects: [root],
      });
      assert(response.ok, JSON.stringify(response));
      assert.deepEqual(
        (await probe.call('depthplan_get_state')).data.canvas.selected,
        [`object-${root}`],
      );
    };
    await selectRoot();
    for (let i = 0; i < 5; i++) {
      await driver.click('Properties');
      const selector = '[aria-label="Primitive properties"] input[name="x"]';
      const old = Number(
        await driver.sync('return document.querySelector(arguments[0]).value', [
          selector,
        ]),
      );
      await fill(selector, old + 10);
      await click('Apply', 'moveApplyToPaint');
      assert.equal(
        await driver.sync(
          'return window.Konva.stages[0].findOne(arguments[0]).x()',
          [`#object-${root}`],
        ),
        old + 10,
      );
    }
    for (let i = 0; i < 100; i++) {
      await depth(
        i % 2 === 0 ? 0 : generated.settings.depth,
        'historyEditInputToPaint',
      );
      if (i === 19 || i === 99) {
        result.history.push({ additionalTransactions: i + 1 });
        await memory(`history-additional-${i + 1}`);
      }
    }
    console.log(`${name}: interactions and 100 history edits checked`);
    if (name === 'dense') {
      const soakStart = performance.now();
      result.soak = { durationTargetMs: 120000, cycles: 0, focus: [] };
      await memory('soak-start');
      while (performance.now() - soakStart < 120000) {
        // DOM-dispatched clicks do not activate a background native window.
        const focus = await driver.native('test:focus');
        result.soak.focus.push(focus);
        assert.equal(
          focus.focused,
          true,
          'Soak requires a focused native window',
        );
        await depth(0, 'soakEditInputToPaint');
        await depth(generated.settings.depth, 'soakEditInputToPaint');
        result.soak.cycles++;
        await wait(5000);
        await memory(`soak-${result.soak.cycles}`);
      }
      result.soak.elapsedMs = performance.now() - soakStart;
    }
    await measure('checkpointAcknowledgment', async () => {
      await depth(0, 'checkpointEditInputToPaint');
      await checkpoint();
    });
    for (let i = 0; i < 5; i++) {
      const doc = await saveAs(path.join(work, `saved-${i}.depthplan.json`));
      assert.deepEqual(doc.objects, generated.document.objects);
      assert.deepEqual(doc.connections, generated.document.connections);
      assert.equal(doc.rootDepths[root], 0);
      result.finalSavedLayouts = Object.values(doc.layouts).reduce(
        (sum, layouts) => sum + Object.keys(layouts).length,
        0,
      );
      await depth(generated.settings.depth, 'savePreparation');
      await depth(0, 'savePreparation');
    }
    await driver.dialogs('save', null);
    await driver.click('Menu');
    await measure('saveCancel', async () => {
      await driver.click('Save As...');
      await until(() =>
        driver.sync(
          'return document.body.textContent.includes("Save canceled")',
        ),
      );
    });
    result.correctness.push(
      'Pan/zoom, depth, move, Undo/Redo, 100 history edits, exact checkpoint revision, five complete saves and save cancellation',
    );
    for (let i = 0; i < 3; i++) {
      await depth(
        i % 2 === 0 ? generated.settings.depth : 0,
        'recoveryPreparation',
      );
      const captured = await checkpoint();
      await memory(`before-restart-${i}`);
      assert.deepEqual(await driver.sync('return window.nativeErrors'), []);
      await stopSampling();
      if (samplingError) throw new Error(samplingError);
      probe.close();
      probe = null;
      const exited = new Promise((resolve) => driver.app.once('exit', resolve));
      driver.app.kill('SIGKILL');
      await exited;
      driver = null;
      await launch();
      await until(() =>
        driver.sync(
          'return !!document.querySelector(`[aria-label="Recover unsaved work"][open] section`)',
        ),
      );
      await measure('restoreToPaint', async () => {
        await driver.click('Restore');
        await until(() =>
          driver.sync(
            'return !!document.querySelector(".depth-navigator")&&!document.querySelector("[inert]")&&!document.querySelector(`[aria-label="Recover unsaved work"][open]`)',
          ),
        );
        await paint();
      });
      assert.equal(
        await driver.sync(
          'return document.querySelector(`button[aria-label="Undo"]`).disabled',
        ),
        true,
      );
      const replacement = await measure(
        'restoredCheckpointAcknowledgment',
        () =>
          until(
            async () =>
              (await checkpointFiles()).find(
                (e) => e.sessionId !== captured.sessionId,
              ),
            'replacement checkpoint',
          ),
      );
      assert.deepEqual(replacement.document, captured.document);
      recoveredDocument = replacement.document;
      await enable();
    }
    result.correctness.push(
      'Three forced process crashes and full-document Restore equality with empty history',
    );
    console.log(`${name}: three crash/restore cycles checked`);
    // The final recovered sample is already fully revealed for this root.
    assert.equal(recoveredDocument.rootDepths[root], generated.settings.depth);
    result.exportScene = await capture();
    for (const format of ['svg', 'png'])
      for (let i = 0; i < 3; i++)
        if (!(await exportImage(format, 'whole', i))) break;
    await selectRoot();
    for (const format of ['svg', 'png'])
      await exportImage(format, 'selection', 0);
    await driver.click('Export current diagram');
    await measure('exportCancel', () => click('Cancel'));
    const afterDocument = await saveAs(
      path.join(work, 'after-export.depthplan.json'),
      'saveAfterExport',
    );
    assert.deepEqual(
      { ...afterDocument, metadata: recoveredDocument.metadata },
      recoveredDocument,
    );
    assert.equal(await hash(source), originalSourceHash);
    result.correctness.push(
      'Whole/selection export formats parsed, canceled/refused exports preserve accepted document; input bytes unchanged',
    );
    await memory('idle-start');
    const idleStart = await sample();
    await wait(5000);
    const idleEnd = await sample();
    result.idleCpuPercentOneCore = Object.fromEntries(
      Object.entries(pids).map(([role, pid]) => [
        role,
        ((idleEnd.processes[pid].cpuSeconds -
          idleStart.processes[pid].cpuSeconds) /
          ((idleEnd.elapsedMs - idleStart.elapsedMs) / 1000)) *
          100,
      ]),
    );
    await memory('final');
    assert.deepEqual(await driver.sync('return window.nativeErrors'), []);
    await stopSampling();
    if (samplingError) throw new Error(samplingError);
    probe.close();
    probe = null;
    await measure('normalClose', async () => {
      // The same native Quit guard as the menu, not a SIGTERM shortcut.
      await driver.sync(
        'setTimeout(()=>window.__TAURI_INTERNALS__.invoke("desktop",{method:"test:quit",args:[]}),100)',
      );
      await until(() => driver.app.exitCode !== null, 'normal process exit');
      assert.equal(driver.app.exitCode, 0);
    });
    driver = null;
    assert.equal((await checkpointFiles()).length, 0);
    result.correctness.push(
      'Normal Quit exited zero and removed all session checkpoints',
    );
    result.status = result.refusals?.length ? 'failed' : 'passed';
    if (result.refusals?.length) result.error = result.refusals[0].error;
  } catch (e) {
    result.status = 'failed';
    result.error = String(e);
    console.error(`${name}: ${e.stack}`);
  } finally {
    await stopSampling();
    probe?.close();
    await driver?.close();
  }
  result.metrics = Object.fromEntries(
    Object.entries(result.metrics).map(([key, values]) => [
      key,
      summary(values),
    ]),
  );
  result.peakKiB = Object.fromEntries(
    [
      'hostKiB',
      'rendererKiB',
      'gpuKiB',
      'networkKiB',
      'webKitKiB',
      'adapterKiB',
      'totalKiB',
    ].map((key) => [
      key,
      Math.max(0, ...result.memorySamples.map((s) => s[key])),
    ]),
  );
  result.budgetChecks = [];
  for (const [metric, limit] of Object.entries({
    panInputToPaint: 200,
    zoomInputToPaint: 200,
    collapseInputToPaint: 250,
    firstRevealInputToPaint: 250,
    savedDepthInputToPaint: 250,
    undoInputToPaint: 250,
    redoInputToPaint: 250,
    moveApplyToPaint: 250,
    historyEditInputToPaint: 250,
    checkpointEditInputToPaint: 250,
    savePreparation: 250,
    recoveryPreparation: 250,
    ...(result.soak ? { soakEditInputToPaint: 250 } : {}),
    loadWarm: 1000,
    save: 1000,
    restoreToPaint: 1000,
    checkpointAcknowledgment: 2000,
    restoredCheckpointAcknowledgment: 2000,
    ...(!['sparse', 'large'].includes(name)
      ? { wholeSVG: 1500, wholePNG: 1500 }
      : {}),
  })) {
    const observed = result.metrics[metric]?.p95Ms;
    result.budgetChecks.push({
      metric,
      limitMs: limit,
      observedMs: observed ?? null,
      passed: observed !== undefined && observed <= limit,
    });
  }
  result.budgetChecks.push(
    {
      metric: 'hostPeak',
      limitKiB: report.budgets.hostKiB,
      observedKiB: result.peakKiB.hostKiB,
      passed:
        result.memorySamples.length > 0 &&
        result.peakKiB.hostKiB <= report.budgets.hostKiB,
    },
    {
      metric: 'webKitPeak',
      limitKiB: report.budgets.rendererKiB,
      observedKiB: result.peakKiB.webKitKiB,
      passed:
        result.memorySamples.length > 0 &&
        result.peakKiB.webKitKiB <= report.budgets.rendererKiB,
    },
  );
  result.budgetsPassed = result.budgetChecks.every((c) => c.passed);
  if (result.status === 'passed' && result.budgetsPassed) {
    for (const file of result.artifacts) await fs.rm(file, { force: true });
    result.cleanup =
      'Generated input, saved files and exports removed; report and isolated profile retained.';
  } else
    result.cleanup =
      'Reproduction files retained; only owned app process stopped.';
  await persist();
  console.log(
    `${name}: correctness=${result.status}, budgets=${result.budgetsPassed ? 'passed' : 'failed'}; pan p95=${result.metrics.panInputToPaint?.p95Ms.toFixed(1)}ms`,
  );
}
report.finished = new Date().toISOString();
await persist();
if (report.results.some((r) => r.status !== 'passed' || !r.budgetsPassed))
  process.exitCode = 1;
