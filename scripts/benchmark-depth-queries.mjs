import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { platform, arch } from 'node:os';
// Bundle the shared browser-compatible query code in memory; no generated app files.
const compiled = await build({
  entryPoints: ['src/shared/depthQueries.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
});
const { queryDocumentHierarchy } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].contents).toString('base64')
);
const measurements = [];
for (const count of [100, 1000, 10000]) {
  const geometry = { x: 0, y: 0, z: 0, width: 100, height: 50, rotation: 0 };
  const document = {
    formatVersion: 2,
    id: 'benchmark',
    metadata: { title: 'Benchmark' },
    objects: {},
    rootDepths: { root: 0 },
    layouts: { root: { 0: { root: geometry } } },
    connections: {},
  };
  for (let i = 0; i < count; i++) {
    const id = i === 0 ? 'root' : `child-${String(i).padStart(5, '0')}`;
    document.objects[id] = {
      id,
      parentId: i === 0 ? null : 'root',
      name: id,
      type: 'rectangle',
      geometry,
      content: [
        { type: 'code', language: 'plaintext', text: 'x'.repeat(4096) },
      ],
    };
  }
  const handle = {
    appInstanceId: 'benchmark-app',
    sessionId: 'benchmark-session',
  };
  const snapshot = { ...handle, document, revision: 0, dirty: false };
  const durations = [];
  let responseBytes = 0;
  for (let i = 0; i < 35; i++) {
    const start = performance.now();
    const result = queryDocumentHierarchy(snapshot, {
      handle,
      objectId: 'root',
      pageSize: 25,
    });
    const elapsed = performance.now() - start;
    if (!result.ok) throw new Error(result.error.code);
    if (i >= 5) durations.push(elapsed);
    responseBytes = Buffer.byteLength(JSON.stringify(result));
  }
  durations.sort((a, b) => a - b);
  measurements.push({
    objects: count,
    pageSize: 25,
    codeUnitsPerObject: 4096,
    responseBytes,
    medianMs: durations[15],
    p95Ms: durations[28],
  });
}
const result = {
  date: new Date().toISOString(),
  node: process.version,
  platform: platform(),
  arch: arch(),
  warmups: 5,
  iterations: 30,
  note: 'Initial descriptive baseline; includes hierarchy indexing, no capacity threshold.',
  measurements,
};
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
