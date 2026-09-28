import { recursiveFixture } from './recursiveFixtures';
import { transactDocument } from '../shared/documentTransactions';
import { flipSelection } from '../shared/recursiveFlip';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import { copyStyle, patchSelectionStyle } from '../shared/editorProperties';
import {
  objectLinkTarget,
  validLink,
  validateRecursiveDocument,
} from '../shared/recursiveDocument';

test.each(['x', 'y'] as const)(
  'flips %s geometry, nested shapes, points and bound endpoints in one reversible edit',
  (axis) => {
    const doc = recursiveFixture();
    doc.layouts.app[1].app.rotation = 25;
    doc.objects.app.boundaryPoints = { port: { side: 'right', offset: 0.25 } };
    doc.connections.edge = {
      id: 'edge',
      ownerId: null,
      kind: 'arrow',
      z: 0,
      start: { kind: 'object', objectId: 'app', side: 'bottom', offset: 0.2 },
      end: { kind: 'object', objectId: 'payments', side: 'top', offset: 0.8 },
      points: [{ x: 700, y: 120 }],
    };
    doc.connections.child = {
      id: 'child',
      ownerId: 'app',
      kind: 'arrow',
      z: 0,
      start: { kind: 'free', x: -35, y: 3 },
      end: { kind: 'object', objectId: 'api', side: 'left', offset: 0.5 },
    };
    const selection = [
      'object-app',
      'object-api',
      'object-payments',
      'connection-edge',
    ];
    const first = transactDocument(doc, flipSelection(doc, selection, axis));
    expect(first.status).toBe('accepted');
    expect(first.document.connections.edge.start.kind).toBe('object');
    expect(first.document.connections.child.end.kind).toBe('object');
    expect(first.document.objects.app.content).toEqual(doc.objects.app.content);
    expect(first.document.layouts.app[0]).toEqual(doc.layouts.app[0]);
    const again = transactDocument(
      first.document,
      flipSelection(first.document, selection, axis),
    );
    const originalWorld = activeWorldGeometry(doc);
    for (const [id, g] of activeWorldGeometry(again.document)) {
      expect(g.x).toBeCloseTo(originalWorld.get(id)!.x);
      expect(g.y).toBeCloseTo(originalWorld.get(id)!.y);
      expect(g.rotation).toBeCloseTo(originalWorld.get(id)!.rotation);
    }
    expect(again.document.objects.app.boundaryPoints).toEqual(
      doc.objects.app.boundaryPoints,
    );
    expect(again.document.connections.edge.points![0].x).toBeCloseTo(700);
    expect(again.document.connections.edge.points![0].y).toBeCloseTo(120);
    expect(again.document.connections.child.start).toMatchObject({
      kind: 'free',
    });
  },
);

test('flipping a connection alone detaches unmoved shapes and mirrors its path', () => {
  const doc = recursiveFixture();
  doc.connections.edge = {
    id: 'edge',
    ownerId: null,
    kind: 'arrow',
    z: 0,
    start: { kind: 'object', objectId: 'app', side: 'right', offset: 0.5 },
    end: { kind: 'free', x: 800, y: 250 },
    points: [{ x: 600, y: 300 }],
  };
  const flipped = transactDocument(
    doc,
    flipSelection(doc, ['connection-edge'], 'x'),
  );
  expect(flipped.status).toBe('accepted');
  expect(flipped.document.objects).toEqual(doc.objects);
  expect(flipped.document.connections.edge.start.kind).toBe('free');
  expect(flipped.document.connections.edge.points).not.toEqual(
    doc.connections.edge.points,
  );
});

test('style copying includes defaults but preserves destination links and containment behavior', () => {
  const doc = recursiveFixture();
  doc.objects.app.style = {
    fill: '#abcdef',
    strokeWidth: 5,
    link: 'https://source.example',
    clipToFrame: true,
  };
  doc.objects.payments.style = {
    link: 'https://destination.example',
    clipToFrame: false,
    opacity: 0.2,
  };
  const result = transactDocument(
    doc,
    patchSelectionStyle(['object-payments'], copyStyle(doc.objects.app)),
  );
  expect(result.status).toBe('accepted');
  expect(result.document.objects.payments.style).toMatchObject({
    fill: '#abcdef',
    strokeWidth: 5,
    opacity: 1,
    link: 'https://destination.example',
    clipToFrame: false,
  });
});

test('object links validate exact board/item identities and persist in rich text', () => {
  const link = `depthplan://object?${new URLSearchParams({ board: 'diagram', item: 'object-app' })}`;
  expect(validLink(link)).toBe(true);
  expect(objectLinkTarget(link)).toEqual({
    board: 'diagram',
    collection: 'objects',
    id: 'app',
  });
  for (const bad of [
    'depthplan://elsewhere?board=b&item=object-a',
    `${link}&extra=1`,
    `${link}#fragment`,
    'depthplan://object?board=b&item=object-__proto__',
    'depthplan://user@object?board=b&item=object-a',
  ])
    expect(validLink(bad)).toBe(false);
  const doc = recursiveFixture();
  doc.objects.app.content = [
    { type: 'paragraph', runs: [{ text: 'Go to app', marks: { link } }] },
  ];
  expect(() =>
    validateRecursiveDocument(JSON.parse(JSON.stringify(doc))),
  ).not.toThrow();
});
