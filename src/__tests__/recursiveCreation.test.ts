import { recursiveFixture } from './recursiveFixtures';
import {
  createShape,
  createConnector,
  drawnGeometry,
} from '../shared/recursiveCreation';
import { transactDocument } from '../shared/documentTransactions';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import {
  type RecursiveDocument,
  validateRecursiveDocument,
} from '../shared/recursiveDocument';
it.each(['rectangle', 'ellipse', 'diamond', 'frame'] as const)(
  'creates %s with stable identity and native round-trip data',
  (type) => {
    const d = recursiveFixture();
    const id = crypto.randomUUID();
    const g = drawnGeometry({ x: -100, y: 250 }, { x: 100, y: 450 }, false);
    const r = transactDocument(d, createShape(id, type, g, null));
    expect(r.status).toBe('accepted');
    expect(r.document.objects[id]).toMatchObject({
      id,
      type,
      parentId: null,
      name: '',
      content: [],
    });
    expect(activeWorldGeometry(r.document).get(id)).toEqual(g);
    const reopened = JSON.parse(JSON.stringify(r.document));
    validateRecursiveDocument(reopened);
    expect(reopened).toEqual(r.document);
  },
);
it('creates the first child of a rotated collapsed leaf, reveals only its owning root and keeps other roots', () => {
  const d = recursiveFixture();
  d.layouts.payments[0].payments.rotation = 90;
  const g = drawnGeometry({ x: 950, y: 120 }, { x: 950, y: 120 }, false, true);
  const r = transactDocument(
    d,
    createShape('new-child', 'rectangle', g, 'payments'),
  );
  expect(r.status).toBe('accepted');
  expect(r.document.rootDepths).toEqual({ app: 1, payments: 1 });
  const world = activeWorldGeometry(r.document).get('new-child')!;
  expect(world.x).toBeCloseTo(950);
  expect(world.y).toBeCloseTo(120);
  expect(r.document.layouts.app).toEqual(d.layouts.app);
});
it('creates free and attached lines/arrows with stable references and rejects cross-container shortcuts', () => {
  let d: RecursiveDocument = recursiveFixture();
  for (const kind of ['line', 'arrow'] as const) {
    const r = transactDocument(
      d,
      createConnector(
        kind,
        kind,
        { x: -500, y: -500 },
        { x: -100, y: -400 },
        null,
        null,
      ),
    );
    expect(r.status).toBe('accepted');
    d = r.document;
    expect(d.connections[kind]).toMatchObject({
      kind,
      ownerId: null,
      start: { kind: 'free', x: -500, y: -500 },
    });
  }
  const r = transactDocument(
    d,
    createConnector(
      'attached',
      'arrow',
      { x: 450, y: 20 },
      { x: 850, y: 20 },
      'app',
      'payments',
    ),
  );
  expect(r.status).toBe('accepted');
  expect(r.document.connections.attached.end).toMatchObject({
    kind: 'object',
    objectId: 'payments',
    side: 'left',
  });
  const invalid = transactDocument(
    d,
    createConnector(
      'invalid',
      'line',
      { x: 450, y: 20 },
      { x: 850, y: 20 },
      'api',
      'payments',
    ),
  );
  expect(invalid.status).toBe('rejected');
  expect(invalid.document).toBe(d);
});
it('successive creation keeps unique IDs and rejects reuse atomically', () => {
  let d = recursiveFixture();
  const ids = Array.from({ length: 20 }, () => crypto.randomUUID());
  for (const id of ids) {
    const r = transactDocument(
      d,
      createShape(
        id,
        'rectangle',
        drawnGeometry({ x: 0, y: 0 }, { x: 1, y: 1 }, false, true),
        null,
      ),
    );
    expect(r.status).toBe('accepted');
    d = r.document;
  }
  expect(Object.keys(d.objects)).toHaveLength(24);
  const r = transactDocument(
    d,
    createShape(ids[0], 'rectangle', d.objects[ids[0]].geometry, null),
  );
  expect(r.status).toBe('rejected');
  expect(r.document).toBe(d);
});
it('constrains both vertical and negative drags without zero geometry', () => {
  expect(
    drawnGeometry({ x: 100, y: 100 }, { x: 100, y: -50 }, true),
  ).toMatchObject({ width: 150, height: 150, y: 25 });
});
