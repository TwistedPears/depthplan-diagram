import assert from 'node:assert/strict';
import { build } from 'esbuild';
import os from 'node:os';

const bundled = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
    export * from './src/shared/stressDocument';
    export { transactDocument } from './src/shared/documentTransactions';
    export { setChildrenExpanded, revealObject } from './src/shared/recursiveLayouts';
    export { recursiveVisibility } from './src/shared/recursiveVisibility';`,
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
});
const mod = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(
  mod,
  mod.exports,
);
const {
  generateStressDocument,
  stressPresets,
  transactDocument,
  setChildrenExpanded,
  revealObject,
  recursiveVisibility,
} = mod.exports;
const summary = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samplesMs: samples,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
};
const results = [];
for (const workload of ['small', 'dense', 'deep', 'reveal-all', 'large']) {
  const times = [];
  let bytes, states;
  for (let run = 0; run < 6; run++) {
    let { document } = generateStressDocument({
      ...stressPresets[workload],
      depthMode: 'collapsed',
      seed: 'capacity-v1',
    });
    const originalRoots = Object.fromEntries(
      Object.keys(document.rootDepths).map((id) => [
        id,
        document.layouts[id][0][id],
      ]),
    );
    const root = Object.keys(document.rootDepths)[0];
    let last = root;
    const children = new Map(
      Object.values(document.objects).map((o) => [o.parentId, o.id]),
    );
    while (children.has(last)) last = children.get(last);
    const apply = (change) => {
      const start = performance.now();
      const result = transactDocument(document, change);
      const elapsed = performance.now() - start;
      assert.notEqual(result.status, 'rejected', result.error);
      document = result.document;
      if (run) times.push(elapsed);
    };
    apply(setChildrenExpanded(root, true));
    if (workload === 'deep') apply(revealObject(last));
    for (let i = 0; i < 5; i++) {
      apply(setChildrenExpanded(root, false));
      for (const [id, geometry] of Object.entries(originalRoots))
        assert.deepEqual(
          document.layouts[id][document.rootDepths[id]][id],
          geometry,
        );
      apply(setChildrenExpanded(root, true));
    }
    bytes = Buffer.byteLength(
      JSON.stringify(document.extensions.expansionLayouts),
    );
    states = Object.keys(document.extensions.expansionLayouts.states).length;
  }
  results.push({ workload, ...summary(times), memoryBytes: bytes, states });
}

let { document } = generateStressDocument({
  ...stressPresets.small,
  roots: 7,
  depthMode: 'collapsed',
  seed: 'capacity-v1',
});
const roots = Object.keys(document.rootDepths);
const samples = [];
const initialFileBytes = Buffer.byteLength(JSON.stringify(document));
const fileBytesAfterPass = [];
for (let repeat = 0; repeat < 2; repeat++) {
  for (let n = 0; n < 128; n++) {
    const combination = n ^ (n >> 1);
    const start = performance.now();
    for (let bit = 0; bit < roots.length; bit++) {
      const root = roots[bit],
        open = !!(combination & (1 << bit));
      if (recursiveVisibility(document).expanded.has(root) === open) continue;
      const result = transactDocument(
        document,
        setChildrenExpanded(root, open),
      );
      assert.notEqual(result.status, 'rejected', result.error);
      document = result.document;
    }
    samples.push(performance.now() - start);
  }
  assert.equal(
    Object.keys(document.extensions.expansionLayouts.states).length,
    128,
  );
  fileBytesAfterPass.push(Buffer.byteLength(JSON.stringify(document)));
}
results.push({
  workload: '128-visited-combinations-twice',
  ...summary(samples),
  memoryBytes: Buffer.byteLength(
    JSON.stringify(document.extensions.expansionLayouts),
  ),
  states: 128,
  initialFileBytes,
  fileBytesAfterPass,
});
console.log(
  JSON.stringify(
    {
      environment: {
        platform: os.platform(),
        arch: os.arch(),
        cpu: os.cpus()[0].model,
        node: process.version,
      },
      metric:
        'Model transaction, including validation/history snapshot preparation; excludes input-to-paint. Existing accepted-edit budget is 250ms.',
      results,
    },
    null,
    2,
  ),
);
assert(
  results.every((r) => r.p95Ms < 250),
  'Model transaction exceeded existing accepted-edit budget',
);
