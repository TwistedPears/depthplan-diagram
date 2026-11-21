import {
  createRecursiveDocument,
  validateRecursiveDocument,
  type DiagramObject,
  type Geometry,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
import {
  transactDocument,
  type DocumentEdit,
} from '../shared/documentTransactions';
import { recursiveScene } from '../shared/recursiveScene';
import { selectRootDepth } from '../shared/recursiveLayouts';
import { editNamedView } from '../shared/namedViews';
import { editAction } from '../shared/editorApiContract';
import { compileEdits } from '../shared/editorCommands';
import { deleteSelection } from '../shared/recursiveDeletion';
import { duplicateSelection } from '../shared/recursiveDuplication';
import { moveSubtree } from '../shared/recursiveMovement';
import {
  copySelection,
  pasteSelection,
  readSelection,
} from '../shared/recursiveClipboard';
import { deleteBoundaryPoint } from '../shared/recursiveConnectionRepair';
import {
  displayedConnection,
  routeKey,
  storeDisplayed,
} from '../shared/connectionRoutes';

const g = (x: number, y: number, width: number, height: number): Geometry => ({
  x,
  y,
  z: 0,
  width,
  height,
  rotation: 0,
});
/** map > svc > (a > a1, b): a compact card at D2, a large container at D3. */
function fixture(): RecursiveDocument {
  const object = (
    id: string,
    parentId: string | null,
    type: DiagramObject['type'] = 'rectangle',
  ): DiagramObject => ({
    id,
    parentId,
    type,
    name: id,
    content: [],
    geometry: g(0, 0, 100, 60),
  });
  return {
    ...createRecursiveDocument('routes', 'Routes', '2026-11-20'),
    objects: {
      map: object('map', null, 'frame'),
      svc: object('svc', 'map'),
      a: object('a', 'svc'),
      b: object('b', 'svc'),
      a1: object('a1', 'a'),
      other: object('other', null, 'frame'),
    },
    rootDepths: { map: 3, other: 0 },
    layouts: {
      map: {
        0: { map: g(0, 0, 400, 300) },
        1: { map: g(0, 0, 400, 300), svc: g(0, 0, 200, 100) },
        2: {
          map: g(0, 0, 400, 300),
          svc: g(0, 0, 200, 100),
          a: g(-50, 0, 40, 30),
          b: g(50, 0, 40, 30),
        },
        3: {
          map: g(0, 0, 1200, 800),
          svc: g(0, 0, 800, 400),
          a: g(-200, 0, 200, 150),
          b: g(200, 0, 200, 150),
          a1: g(0, 0, 50, 40),
        },
      },
      other: { 0: { other: g(2000, 0, 600, 600) } },
    },
    connections: {
      c: {
        id: 'c',
        ownerId: 'svc',
        kind: 'arrow',
        z: 0,
        start: { kind: 'object', objectId: 'a', side: 'right', offset: 0.5 },
        end: { kind: 'object', objectId: 'b', side: 'left', offset: 0.5 },
        depthRoutes: {
          2: {
            points: [{ x: 0, y: -40 }],
            start: { kind: 'object', objectId: 'a', side: 'top', offset: 0.5 },
          },
          3: {
            points: [{ x: 0, y: 120 }],
            start: {
              kind: 'object',
              objectId: 'a',
              side: 'bottom',
              offset: 0.5,
            },
          },
        },
      },
    },
  };
}
const apply = (document: RecursiveDocument, edit: DocumentEdit) => {
  const result = transactDocument(document, edit);
  if (result.status === 'rejected') throw new Error(result.error);
  return result.document;
};
const vertices = (document: RecursiveDocument, id = 'c') =>
  recursiveScene(document)
    .connections.get(document.connections[id].ownerId)
    ?.find((route) => route.id === id)?.vertices;
const edit = (document: RecursiveDocument, action: Record<string, unknown>) =>
  apply(
    document,
    compileEdits(
      { actions: [editAction.parse(action)] } as never,
      {
        camera: { x: 0, y: 0, scale: 1 },
        canvas: { viewport: { width: 0, height: 0 } },
      } as never,
    ).edit,
  );

it('shows each depth its own waypoints and attachment sides, falling back to the shared route', () => {
  let document = fixture();
  validateRecursiveDocument(document);
  expect(routeKey(document, document.connections.c)).toBe('3');
  expect(vertices(document)).toEqual([
    { x: -200, y: 75 },
    { x: 0, y: 120 },
    { x: 100, y: 0 },
  ]);
  document = apply(document, selectRootDepth('map', 2));
  expect(vertices(document)).toEqual([
    { x: -50, y: -15 },
    { x: 0, y: -40 },
    { x: 30, y: 0 },
  ]);
  // A bookmark captured at D2 brings the D2 route back after visiting D3.
  document = apply(
    document,
    editNamedView({ type: 'create', id: 'v', name: 'Overview' }),
  );
  document = apply(document, selectRootDepth('map', 3));
  expect(vertices(document)![1]).toEqual({ x: 0, y: 120 });
  document = apply(document, editNamedView({ type: 'apply', id: 'v' }));
  expect(document.rootDepths.map).toBe(2);
  expect(vertices(document)![1]).toEqual({ x: 0, y: -40 });
  // Without an override the shared route applies: right side to left side, no bends.
  delete document.connections.c.depthRoutes!['2'];
  expect(vertices(document)).toEqual([
    { x: -30, y: 0 },
    { x: 30, y: 0 },
  ]);
});

it('edits the active depth override or the shared route through edit_connection', () => {
  let document = fixture();
  document = edit(document, {
    type: 'edit_connection',
    id: 'c',
    depthRoute: 'set',
    points: [{ x: 0, y: 150 }],
    end: { kind: 'object', objectId: 'b', side: 'bottom', offset: 0.5 },
  });
  expect(document.connections.c.depthRoutes!['3']).toEqual({
    points: [{ x: 0, y: 150 }],
    start: { kind: 'object', objectId: 'a', side: 'bottom', offset: 0.5 },
    end: { kind: 'object', objectId: 'b', side: 'bottom', offset: 0.5 },
  });
  expect(document.connections.c.points).toBeUndefined();
  expect(document.connections.c.end).toMatchObject({ side: 'left' });
  // Without depthRoute, the shared default changes and D3 keeps its override.
  document = edit(document, {
    type: 'edit_connection',
    id: 'c',
    points: [{ x: 5, y: 5 }],
  });
  expect(document.connections.c.points).toEqual([{ x: 5, y: 5 }]);
  expect(vertices(document)![1]).toEqual({ x: 0, y: 150 });
  document = edit(document, {
    type: 'edit_connection',
    id: 'c',
    depthRoute: 'clear',
  });
  expect(Object.keys(document.connections.c.depthRoutes!)).toEqual(['2']);
  expect(vertices(document)![1]).toEqual({ x: 5, y: 5 });
  // A bare 'set' forks the shared route for this depth.
  document = edit(document, {
    type: 'edit_connection',
    id: 'c',
    depthRoute: 'set',
  });
  expect(document.connections.c.depthRoutes!['3']).toEqual({
    start: document.connections.c.start,
    end: document.connections.c.end,
    points: [{ x: 5, y: 5 }],
  });
  // Switching to straight drops bends everywhere.
  document = edit(document, {
    type: 'edit_connection',
    id: 'c',
    style: { lineType: 'elbow' },
  });
  document = edit(document, {
    type: 'edit_connection',
    id: 'c',
    style: { lineType: 'sharp' },
  });
  expect(document.connections.c.depthRoutes!['2'].points).toEqual([]);
  expect(document.connections.c.depthRoutes!['3'].points).toEqual([]);
  expect(() =>
    edit(document, {
      type: 'edit_connection',
      id: 'c',
      depthRoute: 'clear',
      points: [],
    }),
  ).toThrow('without route fields');
  document.connections.free = {
    id: 'free',
    ownerId: null,
    kind: 'line',
    z: 0,
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 9, y: 9 },
  };
  expect(() =>
    edit(document, { type: 'edit_connection', id: 'free', depthRoute: 'set' }),
  ).toThrow('Depth routes need');
});

it('stores an edited displayed route where it came from', () => {
  const document = fixture();
  const stored = document.connections.c;
  const shown = displayedConnection(document, stored);
  expect(shown.depthRoutes).toBeUndefined();
  const moved = storeDisplayed(document, stored, {
    ...shown,
    points: [{ x: 1, y: 1 }],
  });
  expect(moved.points).toBeUndefined();
  expect(moved.depthRoutes!['3'].points).toEqual([{ x: 1, y: 1 }]);
  // Retargeting writes the shared endpoint and drops stale overrides of it.
  const retargeted = storeDisplayed(document, stored, {
    ...shown,
    start: { kind: 'object', objectId: 'a1', side: 'left', offset: 0.5 },
  });
  expect(retargeted.start).toMatchObject({ objectId: 'a1' });
  expect(retargeted.depthRoutes).toEqual({
    2: { points: [{ x: 0, y: -40 }] },
    3: { points: [{ x: 0, y: 120 }] },
  });
  expect(() =>
    storeDisplayed(document, stored, { ...shown, ownerId: 'map' }),
  ).toThrow('own route at this depth');
  const plain = apply(document, selectRootDepth('map', 1));
  expect(
    storeDisplayed(plain, stored, {
      ...displayedConnection(plain, stored),
      points: [],
    }).points,
  ).toEqual([]);
});

it('validates override targets, keys and route roots', () => {
  const bad = (change: (document: RecursiveDocument) => void) => {
    const document = fixture();
    change(document);
    return () => validateRecursiveDocument(document);
  };
  expect(bad(() => {})).not.toThrow();
  expect(
    bad((d) => {
      delete d.connections.c.depthRoutes;
    }),
  ).not.toThrow();
  expect(
    bad((d) => {
      d.connections.c.depthRoutes!['2'].start = {
        kind: 'object',
        objectId: 'b',
        side: 'top',
        offset: 0,
      };
    }),
  ).toThrow('depth route endpoint');
  expect(
    bad((d) => {
      d.connections.c.depthRoutes!['02'] = { points: [] };
    }),
  ).toThrow('depth route');
  expect(
    bad((d) => {
      d.connections.c.depthRoutes!['4'] = {};
    }),
  ).toThrow('depth route');
  expect(
    bad((d) => {
      d.connections.c.depthRoutes!['2'].end = { kind: 'free', x: 0, y: 0 };
    }),
  ).toThrow('depth route endpoint');
  expect(
    bad((d) => {
      d.connections.c.ownerId = null;
      d.connections.c.end = {
        kind: 'object',
        objectId: 'other',
        side: 'left',
        offset: 0.5,
      };
    }),
  ).toThrow('depth route root');
});

it('keeps overrides valid through delete, boundary delete, duplicate, reparent and clipboard', () => {
  const document = fixture();
  // Deleting an endpoint frees the shared endpoint and drops its overrides.
  const deleted = apply(document, deleteSelection(['b']));
  expect(deleted.connections.c.end.kind).toBe('free');
  expect(deleted.connections.c.depthRoutes!['3'].start).toMatchObject({
    side: 'bottom',
  });
  expect(
    apply(document, deleteSelection(['svc'])).connections.c,
  ).toBeUndefined();

  const ported = fixture();
  ported.objects.a.boundaryPoints = { port: { side: 'top', offset: 0.2 } };
  ported.connections.c.depthRoutes!['3'] = {
    start: { kind: 'boundary', objectId: 'a', pointId: 'port' },
  };
  const unported = apply(ported, deleteBoundaryPoint('a', 'port'));
  expect(unported.connections.c.depthRoutes!['3']).toBeUndefined();

  // Duplicate retargets copied overrides to the copied endpoints.
  const copy = duplicateSelection(document, ['object-svc'], 24);
  const duplicated = apply(document, copy.edit);
  const twin = Object.values(duplicated.connections).find((c) => c.id !== 'c')!;
  expect(twin.ownerId).not.toBe('svc');
  expect(twin.depthRoutes!['3'].start).toMatchObject({
    objectId: twin.start.kind === 'object' ? twin.start.objectId : '',
    side: 'bottom',
  });
  expect(twin.depthRoutes!['3'].points).toEqual([{ x: 0, y: 120 }]);
  expect(vertices(duplicated, twin.id)![1]).toEqual({ x: 0, y: 120 });

  // Reparenting the owner one level deeper shifts overrides with its layouts.
  const host = apply(document, (draft) => {
    draft.objects.host = {
      ...draft.objects.svc,
      id: 'host',
      parentId: 'map',
    };
    for (const depth of ['1', '2', '3'])
      draft.layouts.map[depth].host = g(0, 0, 1000, 600);
  });
  const nested = apply(host, moveSubtree('svc', 'host', { x: 0, y: 0 }));
  expect(Object.keys(nested.connections.c.depthRoutes!)).toEqual(['3', '4']);
  expect(nested.connections.c.depthRoutes!['3'].points).toEqual([
    { x: 0, y: -40 },
  ]);

  // Copy/paste of the container keeps owned overrides relative to the pasted root.
  const clipboard = readSelection(copySelection(document, ['object-svc']))!;
  expect(Object.keys(clipboard.connections.c.depthRoutes!)).toEqual(['1', '2']);
  const pasted = apply(document, pasteSelection(clipboard, 24).edit);
  for (const connection of Object.values(pasted.connections))
    expect(Object.keys(connection.depthRoutes!)).toEqual(['2', '3']);
});
