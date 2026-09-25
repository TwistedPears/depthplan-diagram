// In-process search baseline; excludes native transport and renderer paint.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { arch, cpus, platform, release } from 'node:os';

const compiled = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `export { createEditorQueries } from './src/shared/editorQueries';
export { initialCanvasState } from './src/shared/editorApiContract';
export { generateStressDocument, stressPresets } from './src/shared/stressDocument';`,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const {
  createEditorQueries,
  initialCanvasState,
  generateStressDocument,
  stressPresets,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].contents).toString('base64')
);
const measurements = [];
for (const [name, settings] of Object.entries({
  large: stressPresets.large,
  textHeavy: { ...stressPresets.large, textCharacters: 8192, codeLines: 20 },
  deep: stressPresets.deep,
})) {
  const document = generateStressDocument({
    ...settings,
    seed: 'search-v1',
  }).document;
  const snapshot = {
    document,
    appInstanceId: 'probe',
    sessionId: 'search',
    revision: 0,
    viewRevision: 0,
    dirty: false,
    source: null,
    camera: { x: 0, y: 0, scale: 1 },
    canvas: initialCanvasState(),
    canUndo: false,
    canRedo: false,
  };
  const before = JSON.stringify(snapshot);
  const queries = createEditorQueries({
    snapshot: () => snapshot,
    busyReasons: () => [],
  });
  const handle = { appInstanceId: 'probe', sessionId: 'search' };
  for (const query of ['diagram', 'missing-search-token']) {
    const samples = [];
    let bytes = 0,
      pages = 0,
      matches = 0;
    for (let run = 0; run < 12; run++) {
      const started = performance.now();
      let cursor;
      bytes = 0;
      pages = 0;
      matches = 0;
      do {
        const result = queries.search({
          handle,
          query,
          collection: 'objects',
          pageSize: 200,
          ...(cursor ? { cursor } : {}),
        });
        assert(result.ok, JSON.stringify(result));
        bytes = Math.max(bytes, Buffer.byteLength(JSON.stringify(result)));
        assert(bytes <= 1024 * 1024);
        pages++;
        matches += result.data.items.length;
        cursor = result.data.nextCursor;
      } while (cursor);
      if (run >= 2) samples.push(performance.now() - started);
    }
    assert.equal(
      matches,
      query === 'diagram' ? Object.keys(document.objects).length : 0,
    );
    const sorted = [...samples].sort((a, b) => a - b);
    measurements.push({
      workload: name,
      objects: Object.keys(document.objects).length,
      query,
      pages,
      matches,
      maxPageBytes: bytes,
      samplesMs: samples,
      medianMs: sorted[5],
      p95Ms: sorted[9],
    });
  }
  assert.equal(JSON.stringify(snapshot), before);
}
console.log(
  JSON.stringify(
    {
      host: {
        os: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0].model,
        node: process.version,
      },
      seed: 'search-v1',
      warmups: 2,
      iterations: 10,
      scope:
        'All pages, in-process; no transport or paint; no new capacity claim.',
      measurements,
    },
    null,
    2,
  ),
);
