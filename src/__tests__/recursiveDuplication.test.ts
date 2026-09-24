import { recursiveFixture } from './recursiveFixtures';
import { duplicateSelection } from '../shared/recursiveDuplication';
import { transactDocument } from '../shared/documentTransactions';
import { setChildrenExpanded } from '../shared/recursiveLayouts';
import { recursiveVisibility } from '../shared/recursiveVisibility';

it('copies a subtree once with hidden descendants, every depth, ports and internal wiring', () => {
  const document = recursiveFixture();
  document.objects.app.boundaryPoints = {
    port: { side: 'right', offset: 0.5 },
  };
  document.objects.api.style = {
    fillType: 'hachure',
    link: 'https://example.com',
  };
  document.connections.bridge = {
    id: 'bridge',
    kind: 'arrow',
    ownerId: 'app',
    z: 2,
    start: { kind: 'boundary', objectId: 'app', pointId: 'port' },
    end: { kind: 'object', objectId: 'api', side: 'left', offset: 0.5 },
    points: [{ x: 20, y: 30 }],
  };
  const original = JSON.stringify(document);
  const copy = duplicateSelection(document, ['object-app', 'object-api']);
  const result = transactDocument(document, copy.edit);
  expect(result.status).toBe('accepted');
  const after = result.document;
  expect(Object.keys(after.objects)).toHaveLength(7);
  expect(copy.selection).toHaveLength(1);
  const app = copy.selection[0].slice(7);
  const api = Object.values(after.objects).find((o) => o.parentId === app)!;
  const endpoint = Object.values(after.objects).find(
    (o) => o.parentId === api.id,
  )!;
  expect(api.style).toEqual(document.objects.api.style);
  expect(after.rootDepths[app]).toBe(1);
  for (const [depth, layout] of Object.entries(document.layouts.app)) {
    expect(after.layouts[app][depth][app].x).toBe(layout.app.x + 24);
    expect(after.layouts[app][depth][app].width).toBe(layout.app.width);
    if (layout.api)
      expect(after.layouts[app][depth][api.id]).toEqual(layout.api);
    if (layout.endpoint)
      expect(after.layouts[app][depth][endpoint.id]).toEqual(layout.endpoint);
  }
  const bridge = Object.values(after.connections).find(
    (c) => c.id !== 'bridge',
  )!;
  expect(bridge.ownerId).toBe(app);
  expect(bridge.start).toEqual({
    kind: 'boundary',
    objectId: app,
    pointId: 'port',
  });
  expect(bridge.end).toMatchObject({ objectId: api.id });
  expect(bridge.points).toEqual(document.connections.bridge.points);
  expect(JSON.stringify(document)).toBe(original);
  expect(JSON.parse(JSON.stringify(after))).toEqual(after);
});

it('keeps a nested copy inside its parent and retains local folds', () => {
  const document = recursiveFixture();
  document.rootDepths.app = 2;
  document.extensions = { collapsedObjects: ['api'] };
  const copy = duplicateSelection(document, ['object-api']);
  const result = transactDocument(document, copy.edit);
  expect(result.status).toBe('accepted');
  const id = copy.selection[0].slice(7);
  expect(result.document.objects[id].parentId).toBe('app');
  expect(result.document.layouts.app[1][id].x).toBe(
    document.layouts.app[1].api.x + 24,
  );
  expect(recursiveVisibility(result.document).expanded.has(id)).toBe(false);
  const opened = transactDocument(
    result.document,
    setChildrenExpanded(id, true),
  );
  expect(opened.status).toBe('accepted');
  expect(recursiveVisibility(opened.document).expanded.has(id)).toBe(true);
  expect(recursiveVisibility(opened.document).expanded.has('api')).toBe(false);
});

it('copies selected connectors and remaps arrows between copied peer objects', () => {
  const document = recursiveFixture();
  document.connections.between = {
    id: 'between',
    kind: 'arrow',
    ownerId: null,
    z: 0,
    start: { kind: 'object', objectId: 'app', side: 'right', offset: 0.5 },
    end: { kind: 'object', objectId: 'payments', side: 'left', offset: 0.5 },
  };
  const copy = duplicateSelection(document, ['object-app', 'object-payments']);
  const result = transactDocument(document, copy.edit);
  expect(result.status).toBe('accepted');
  const arrowId = copy.selection
    .find((key) => key.startsWith('connection-'))!
    .slice(11);
  const arrow = result.document.connections[arrowId];
  expect(arrow.start).toMatchObject({ objectId: copy.selection[0].slice(7) });
  expect(arrow.end).toMatchObject({ objectId: copy.selection[1].slice(7) });
  document.connections.free = {
    id: 'free',
    kind: 'line',
    ownerId: null,
    z: 0,
    start: { kind: 'free', x: 5, y: 8 },
    end: { kind: 'free', x: 20, y: 30 },
    points: [{ x: 15, y: 25 }],
  };
  const lineCopy = duplicateSelection(document, ['connection-free']);
  const lineResult = transactDocument(document, lineCopy.edit);
  expect(lineResult.status).toBe('accepted');
  expect(
    lineResult.document.connections[lineCopy.selection[0].slice(11)],
  ).toMatchObject({
    start: { kind: 'free', x: 29, y: 32 },
    end: { kind: 'free', x: 44, y: 54 },
    points: [{ x: 39, y: 49 }],
  });
});
