/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  codeLanguages,
  validateRecursiveDocument,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
import { recursiveScene } from '../shared/recursiveScene';
import { resolveExportSelection } from '../shared/recursiveExportScope';
import { selectRootDepth, editWorldGeometry } from '../shared/recursiveLayouts';
import {
  editNamedView,
  resolveNamedView,
  resolveNamedViewCamera,
} from '../shared/namedViews';
import { transactDocument } from '../shared/documentTransactions';
import { arrowheads } from '../shared/connectionGeometry';
const samples = [
  'recursive_document',
  'workflow_document',
  'depthplan_application_tour',
];
const load = async (name: string): Promise<RecursiveDocument> => {
  const document = JSON.parse(
    await fs.readFile(path.resolve(`docs/sample/${name}.depthplan`), 'utf8'),
  );
  validateRecursiveDocument(document);
  return document;
};
const edit = (
  d: RecursiveDocument,
  action: Parameters<typeof transactDocument>[1],
) => {
  const result = transactDocument(d, action, '2026-09-18');
  if (result.status === 'rejected') throw new Error(result.error);
  return result.document;
};
it('round-trips every maintained current-format sample without changing its data', async () => {
  for (const name of samples) {
    const document = await load(name);
    expect(document.formatVersion).toBe(2);
    const reopened = JSON.parse(JSON.stringify(document));
    validateRecursiveDocument(reopened);
    expect(reopened).toEqual(document);
  }
});
it('preserves the MCP-authored application tour and its complete feature galleries', async () => {
  const d = (await load('depthplan_application_tour')) as RecursiveDocument;
  expect(Object.keys(d.objects)).toHaveLength(56);
  expect(Object.keys(d.connections)).toHaveLength(31);
  expect(Object.keys(d.namedViews ?? {})).toHaveLength(12);
  expect(Object.keys(d.connectionRepairs ?? {})).toHaveLength(0);
  expect(Object.keys(d.layouts.app)).toEqual(['0', '1', '2', '3']);
  expect(
    new Set(Object.values(d.objects).map((object) => object.type)),
  ).toEqual(new Set(['rectangle', 'ellipse', 'diamond', 'frame']));
  expect(
    new Set(
      Object.values(d.objects)
        .flatMap((object) => object.content)
        .filter((block) => block.type === 'code')
        .map((block) => block.language),
    ),
  ).toEqual(new Set(codeLanguages));
  for (const marker of arrowheads) {
    expect(d.connections[`marker-${marker}`].style).toMatchObject({
      arrowheadStart: marker,
      arrowheadEnd: marker,
    });
  }
  const overview = edit(
    d,
    editNamedView({ type: 'apply', id: 'system-overview' }),
  );
  expect(recursiveScene(overview).world.size).toBe(8);
  const deep = edit(d, editNamedView({ type: 'apply', id: 'implementation' }));
  expect(deep.rootDepths.app).toBe(3);
  expect(deep.objects['version-guard'].parentId).toBe('dispatch');
  expect(deep.objects.dispatch.parentId).toBe('mcp');
  expect(deep.objects.mcp.parentId).toBe('app');
  expect(recursiveScene(deep).world.has('version-guard')).toBe(true);
  for (const id of ['app-to-mcp', 'mcp-to-dispatch', 'dispatch-to-guard']) {
    expect(deep.connections[id].start.kind).toBe('boundary');
  }
  const selected = resolveExportSelection(deep, ['object-mcp']);
  expect(selected.objects.has('version-guard')).toBe(true);
  expect(selected.connections.has('mcp-to-dispatch')).toBe(true);
  expect(selected.connections.has('client-app')).toBe(false);
  const notation = edit(d, editNamedView({ type: 'apply', id: 'markers' }));
  expect(
    resolveExportSelection(notation, ['object-notation']).connections.has(
      'marker-arrow',
    ),
  ).toBe(false);
  expect(
    resolveExportSelection(notation, [
      'object-notation',
      'connection-marker-arrow',
    ]).connections.has('marker-arrow'),
  ).toBe(true);
  const focused = edit(d, editNamedView({ type: 'apply', id: 'selective' }));
  expect(focused.rootDepths.app).toBe(2);
  expect(recursiveScene(focused).world.has('canvas')).toBe(false);
  expect(recursiveScene(focused).world.has('hierarchy')).toBe(false);
  expect(recursiveScene(focused).world.has('adapter')).toBe(true);
  for (const id of Object.keys(d.namedViews ?? {})) {
    expect(d.namedViews?.[id].cameraFocus).toBeDefined();
    expect(resolveNamedView(d, id).adjustments).toEqual([]);
    const applied = edit(d, editNamedView({ type: 'apply', id }));
    expect(applied.objects).toEqual(d.objects);
    expect(applied.connections).toEqual(d.connections);
  }
  const viewport = { width: 1483, height: 1106 };
  for (const [id, x, y, scale] of [
    ['welcome', 10.5, 545, 0.65],
    ['code-bottom', 224.5, -1259, 0.43],
  ] as const) {
    const camera = resolveNamedViewCamera(d.namedViews?.[id], viewport);
    expect(camera?.x).toBeCloseTo(x);
    expect(camera?.y).toBeCloseTo(y);
    expect(camera?.scale).toBe(scale);
  }
});
it('maintains exact recursive sample visibility, separate layouts, geometry and both export scopes', async () => {
  let d = (await load('recursive_document')) as RecursiveDocument;
  const expected = [
    ['app', 'payments'],
    ['app', 'api', 'cache', 'payments'],
    ['app', 'api', 'cache', 'endpoint', 'payments'],
    ['app', 'api', 'cache', 'endpoint', 'handler', 'payments'],
  ];
  for (let depth = 0; depth <= 3; depth++) {
    if (d.rootDepths.app !== depth) d = edit(d, selectRootDepth('app', depth));
    expect([...recursiveScene(d).world.keys()].sort()).toEqual(
      expected[depth].sort(),
    );
    expect(d.layouts.app[0].app.width).toBe(160);
    const selected = resolveExportSelection(d, ['object-app']);
    expect([...selected.objects].sort()).toEqual(
      expected[depth].filter((id) => id !== 'payments').sort(),
    );
    expect([...selected.connections]).toEqual([]);
    expect([
      ...resolveExportSelection(d, ['object-app', 'object-payments'])
        .connections,
    ]).toEqual(['external']);
  }
});
it('covers inward bridges, pending repairs, rich/code content, persistent bookmarks and subtree movement', async () => {
  const d = (await load('workflow_document')) as RecursiveDocument;
  expect(Object.keys(d.objects).sort()).toEqual([
    'client',
    'service',
    'system',
    'worker',
  ]);
  expect(d.objects.worker.content[0]).toMatchObject({
    type: 'code',
    language: 'typescript',
  });
  expect(d.objects.service.content.map((block) => block.type)).toEqual([
    'heading',
    'paragraph',
    'list',
    'quote',
  ]);
  expect(Object.keys(d.connectionRepairs!)).toEqual(['detached']);
  const routes = (doc: RecursiveDocument) =>
    [...recursiveScene(doc).connections.values()]
      .flat()
      .map((route) => route.id)
      .sort();
  expect(routes(d)).toEqual(['external', 'service-bridge', 'system-bridge']);
  expect(
    [...resolveExportSelection(d, ['object-system']).connections].sort(),
  ).toEqual(['service-bridge', 'system-bridge']);
  const overview = edit(d, editNamedView({ type: 'apply', id: 'overview' }));
  expect([...recursiveScene(overview).world.keys()].sort()).toEqual([
    'client',
    'system',
  ]);
  expect(routes(overview)).toEqual(['external']);
  expect(resolveExportSelection(overview, ['object-system']).objects).toEqual(
    new Set(['system']),
  );
  expect(
    resolveExportSelection(overview, ['connection-external']).connections,
  ).toEqual(new Set(['external']));
  expect(overview.namedViews).toEqual(d.namedViews);
  expect(resolveNamedView(d, 'retained').adjustments).toHaveLength(3);
  const restored = edit(
    overview,
    editNamedView({ type: 'apply', id: 'details' }),
  );
  const moved = edit(restored, editWorldGeometry('system', { x: 410, y: 350 }));
  expect(
    recursiveScene(moved).world.get('worker')!.x -
      recursiveScene(d).world.get('worker')!.x,
  ).toBe(50);
  expect(
    recursiveScene(moved).world.get('worker')!.y -
      recursiveScene(d).world.get('worker')!.y,
  ).toBe(30);
  expect(moved.layouts.system[0]).toEqual(d.layouts.system[0]);
  expect(moved.objects.worker).toEqual(d.objects.worker);
  expect(moved.connectionRepairs).toEqual(d.connectionRepairs);
  expect(moved.extensions).toEqual(d.extensions);
});
