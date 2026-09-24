// Small common probe for comparing instrumented and uninstrumented packages.
// Open the same generated workload and enable MCP in the UI before running.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import client from './mcp/native-client.cjs';

const [executable, descriptor, output] = process.argv.slice(2);
assert(
  executable && descriptor && output,
  'Usage: node scripts/measure-mcp-capacity.mjs <adapter> <descriptor> <report.json>',
);
const probe = client(path.resolve(executable), path.resolve(descriptor));
const report = {
  scope:
    'Native MCP round-trip comparison; does not measure input-to-paint or prove production capacity.',
  started: new Date().toISOString(),
  adapterSHA256: createHash('sha256')
    .update(await readFile(executable))
    .digest('hex'),
  measurements: {},
};
const measure = async (label, fn) => {
  const start = performance.now();
  const value = await fn();
  (report.measurements[label] ??= []).push(performance.now() - start);
  assert(value.ok, JSON.stringify(value));
  return value;
};
try {
  await probe.initialize();
  report.before = (await probe.call('depthplan_get_state')).data;
  const pages = async () => {
    const state = (await probe.call('depthplan_get_state')).data;
    return (
      await probe.call('depthplan_query', {
        handle: state.handle,
        collection: 'objects',
        pageSize: 100,
      })
    ).data.items;
  };
  const original = await pages();
  for (let i = 0; i < 5; i++) {
    const state = (await probe.call('depthplan_get_state')).data;
    const rows = await measure('mcpQueryPage', () =>
      probe.call('depthplan_query', {
        handle: state.handle,
        collection: 'objects',
        pageSize: 100,
      }),
    );
    const ids = rows.data.items.filter((r) => r.visible).map((r) => r.id);
    assert(ids.length > 0);
    report.movedObjects = ids.length;
    await measure('mcpMoveBatch', () =>
      probe.call('depthplan_edit', {
        handle: state.handle,
        expectedRevision: state.revision,
        expectedViewRevision: state.viewRevision,
        requestId: `comparison-move-${Date.now()}-${i}`,
        actions: [{ type: 'move', ids, delta: { x: 1, y: 0 } }],
      }),
    );
    const after = (await probe.call('depthplan_get_state')).data;
    await measure('mcpUndo', () =>
      probe.call('depthplan_history', {
        handle: after.handle,
        expectedRevision: after.revision,
        expectedViewRevision: after.viewRevision,
        requestId: `comparison-undo-${Date.now()}-${i}`,
        direction: 'undo',
      }),
    );
    assert.deepEqual(
      await pages(),
      original,
      'Undo must restore the original queried objects',
    );
  }
  report.after = (await probe.call('depthplan_get_state')).data;
  assert.deepEqual(report.after.camera, report.before.camera);
  assert.deepEqual(report.after.canvas.selected, report.before.canvas.selected);
  report.measurements = Object.fromEntries(
    Object.entries(report.measurements).map(([key, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [
        key,
        {
          n: values.length,
          samplesMs: values,
          medianMs: sorted[Math.floor(sorted.length / 2)],
          p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        },
      ];
    }),
  );
  report.status = 'passed';
} finally {
  probe.close();
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    { status: report.status, measurements: report.measurements },
    null,
    2,
  ),
);
