import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { launchNative } from './native-driver.mjs';

assert.equal(
  process.platform,
  'darwin',
  'WebKit process attribution requires macOS',
);
const exec = promisify(execFile);
process.env.DEPTHPLAN_EXECUTABLE ??= path.resolve(
  'src-tauri/target/release/depthplan',
);
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const compiled = await build({
  stdin: {
    contents: 'export * from "./src/shared/stressDocument";',
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
const { generateStressDocument, stressPresets, stressGeneratorVersion } =
  mod.exports;
const fixture = generateStressDocument({
  ...stressPresets.small,
  seed: 'project-capacity-v1',
}).document;
await mkdir('out/project-capacity', { recursive: true });
const directory = await mkdtemp(path.resolve('out/project-capacity/run-'));
const root = path.join(directory, 'Many boards');
await mkdir(root);
const boards = Array.from({ length: 100 }, (_, i) => ({
  id: `board-${i}`,
  name: `Board ${i}`,
  path: `Board-${i}.depthplan`,
}));
for (const board of boards)
  await writeFile(
    path.join(root, board.path),
    JSON.stringify({
      ...fixture,
      id: board.id,
      metadata: { ...fixture.metadata, title: board.name },
    }),
  );
const manifestPath = path.join(root, 'many.depthproject');
await writeFile(
  manifestPath,
  JSON.stringify({
    projectVersion: 1,
    id: 'many-boards',
    name: 'Many boards',
    description: '',
    homeBoardId: boards[0].id,
    autosave: false,
    boards,
  }),
);
const originals = await Promise.all(
  boards.map((b) => hash(path.join(root, b.path))),
);
const report = {
  source: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  binary: process.env.DEPTHPLAN_EXECUTABLE,
  binaryHash: await hash(process.env.DEPTHPLAN_EXECUTABLE),
  harnessHash: await hash('scripts/measure-project-capacity.mjs'),
  lockHash: await hash('src-tauri/Cargo.lock'),
  node: process.version,
  os: os.release(),
  cpu: os.cpus()[0].model,
  ram: os.totalmem(),
  generator: stressGeneratorVersion,
  settings: stressPresets.small,
  seed: 'project-capacity-v1',
  boardCount: 100,
  objectsPerBoard: Object.keys(fixture.objects).length,
  viewport: { width: 1280, height: 900 },
  budgets: {
    coldMs: 2000,
    openMs: 1000,
    switchP95Ms: 250,
    hostMiB: 350,
    webKitMiB: 1536,
    searchMs: 5000,
    searchFrameGapMs: 250,
    cancelMs: 250,
  },
  cold: [],
  opens: [],
  switches: [],
  searches: [],
  cancellations: [],
  memory: [],
  passed: false,
};
let driver,
  timer,
  pending = Promise.resolve(),
  memoryError;
try {
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    driver = await launchNative(undefined, [manifestPath]);
    await driver.until(() =>
      driver.sync(
        'return document.getElementById("board-board-0")?.getAttribute("data-active") === "true"',
      ),
    );
    report.cold.push(performance.now() - start);
    const pids = await driver.native('test:processes');
    assert(Object.values(pids).every((pid) => pid > 0));
    report.userAgent = await driver.sync('return navigator.userAgent');
    report.displayScale = await driver.sync('return devicePixelRatio');
    const sample = async () => {
      const { stdout } = await exec('ps', [
        '-o',
        'pid=,rss=',
        '-p',
        Object.values(pids).join(','),
      ]);
      const rss = Object.fromEntries(
        stdout
          .trim()
          .split('\n')
          .map((row) => row.trim().split(/\s+/).map(Number)),
      );
      assert(Object.values(pids).every((pid) => rss[pid] > 0));
      report.memory.push({
        run,
        time: performance.now() - start,
        hostMiB: rss[pids.host] / 1024,
        webKitMiB:
          (rss[pids.renderer] + rss[pids.gpu] + rss[pids.network]) / 1024,
      });
    };
    await sample();
    timer = setInterval(() => {
      pending = pending.then(sample).catch((e) => {
        memoryError = e;
      });
    }, 200);
    assert.equal(
      await driver.sync(
        'return document.querySelectorAll("[data-board-session]").length',
      ),
      1,
    );
    await driver.sync(
      'window.boardReads=[]; const original=window.desktop.projects.readBoard; window.desktop.projects.readBoard=(...args)=>{window.boardReads.push(args[1]);return original(...args)}',
    );
    if (
      !(await driver.sync('return !!document.querySelector("#project-drawer")'))
    )
      await driver.click('Toggle project boards');
    for (const board of boards.slice(1, 5)) {
      const began = performance.now();
      await driver.click(`Open ${board.name}, ${board.path}`);
      await driver.until(() =>
        driver.sync(
          'return document.getElementById(arguments[0])?.getAttribute("data-active") === "true"',
          [`board-${board.id}`],
        ),
      );
      await driver.js(
        'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
      );
      report.opens.push(performance.now() - began);
    }
    assert.deepEqual(
      await driver.sync('return window.boardReads'),
      boards.slice(1, 5).map((b) => b.id),
    );
    assert.equal(
      await driver.sync(
        'return document.querySelectorAll("[data-board-session]").length',
      ),
      5,
    );
    for (let i = 0; i < 60; i++) {
      const ms = await driver.js(
        'new Promise((resolve,reject)=>{const board=document.getElementById(arguments[0]);const start=performance.now();board.click();requestAnimationFrame(()=>requestAnimationFrame(()=>{if(board.getAttribute("aria-current")!=="true")return reject(new Error("Wrong active board"));resolve(performance.now()-start)}))})',
        [`board-link-${boards[i % 5].id}`],
      );
      report.switches.push(ms);
      assert.equal(
        await driver.sync(
          'return document.querySelectorAll(".konvajs-content").length',
        ),
        1,
      );
    }
    assert.equal(
      await driver.sync('return window.boardReads.length'),
      4,
      'Switches must reuse live owners',
    );
    await driver.click('Search boards');
    const searchStart = performance.now();
    await driver.sync(`
      const input=document.getElementById('object-search-input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'object-0000000');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    `);
    await driver.sync(`
      window.searchFrameGap=0;window.searchMeasuring=true;let last=performance.now();
      const frame=now=>{window.searchFrameGap=Math.max(window.searchFrameGap,now-last);last=now;if(window.searchMeasuring)requestAnimationFrame(frame)};
      requestAnimationFrame(frame);document.getElementById('object-search-form').requestSubmit();
    `);
    await driver.until(() =>
      driver.sync(
        'return document.querySelector("dialog")?.textContent.includes("Search complete.")',
      ),
    );
    const frameGap = await driver.sync(
      'window.searchMeasuring=false;return window.searchFrameGap',
    );
    report.searches.push({ ms: performance.now() - searchStart, frameGap });
    assert.equal(
      await driver.sync(
        'return document.querySelectorAll(".project-search-results button").length',
      ),
      100,
    );
    assert.equal(
      await driver.sync(
        'return document.querySelectorAll("[data-board-session]").length',
      ),
      5,
    );
    assert.equal(
      await driver.sync(
        'return document.querySelectorAll(".konvajs-content").length',
      ),
      1,
    );
    await driver.sync(`
      const input=document.querySelector('dialog input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'nothing-matches');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    `);
    report.cancellations.push(
      await driver.js(`new Promise(resolve=>{
      document.querySelector('dialog form').requestSubmit();
      requestAnimationFrame(()=>{
        const start=performance.now();
        [...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Stop search').click();
        requestAnimationFrame(()=>resolve(performance.now()-start));
      });
    })`),
    );
    assert(
      await driver.sync(
        'return document.querySelector("dialog").textContent.includes("Search stopped.")',
      ),
    );
    await driver.click('Close');
    await sample();
    clearInterval(timer);
    await pending;
    if (memoryError) throw memoryError;
    assert.deepEqual(await driver.sync('return window.nativeErrors'), []);
    await driver.native('test:quit').catch(() => {});
    await driver.until(() => driver.app.exitCode !== null);
    assert.equal(driver.app.exitCode, 0);
    await driver.close();
    driver = null;
  }
  const sorted = [...report.switches].sort((a, b) => a - b);
  report.switchP95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
  report.peakHostMiB = Math.max(...report.memory.map((x) => x.hostMiB));
  report.peakWebKitMiB = Math.max(...report.memory.map((x) => x.webKitMiB));
  assert(
    Math.max(...report.cold) <= report.budgets.coldMs,
    `Cold project ${report.cold}`,
  );
  assert(
    Math.max(...report.opens) <= report.budgets.openMs,
    `Board open ${report.opens}`,
  );
  assert(
    report.switchP95Ms <= report.budgets.switchP95Ms,
    `Switch p95 ${report.switchP95Ms}`,
  );
  assert(
    report.peakHostMiB <= report.budgets.hostMiB,
    `Host RSS ${report.peakHostMiB}`,
  );
  assert(
    report.peakWebKitMiB <= report.budgets.webKitMiB,
    `WebKit RSS ${report.peakWebKitMiB}`,
  );
  assert(
    report.searches.every(
      (x) =>
        x.ms <= report.budgets.searchMs &&
        x.frameGap <= report.budgets.searchFrameGapMs,
    ),
    JSON.stringify(report.searches),
  );
  assert(
    report.cancellations.every((ms) => ms <= report.budgets.cancelMs),
    JSON.stringify(report.cancellations),
  );
  assert.deepEqual(
    await Promise.all(boards.map((b) => hash(path.join(root, b.path)))),
    originals,
  );
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  clearInterval(timer);
  await pending;
  await driver?.close();
  await writeFile(
    path.join(directory, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(`Project capacity evidence: ${directory}`);
}
console.log(
  `PASS 100-board capacity: cold ${Math.max(...report.cold).toFixed(0)} ms, open ${Math.max(...report.opens).toFixed(0)} ms, switch p95 ${report.switchP95Ms.toFixed(0)} ms, host ${report.peakHostMiB.toFixed(0)} MiB, WebKit ${report.peakWebKitMiB.toFixed(0)} MiB.`,
);
