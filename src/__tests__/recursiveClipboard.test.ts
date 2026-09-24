import { recursiveFixture } from './recursiveFixtures';
import {
  copySelection,
  readSelection,
  pasteSelection,
} from '../shared/recursiveClipboard';
import { duplicateSelection } from '../shared/recursiveDuplication';
import { transactDocument } from '../shared/documentTransactions';
import { createRecursiveDocument } from '../shared/recursiveDocument';
import { recursiveScene } from '../shared/recursiveScene';
import { deleteSelection } from '../shared/recursiveDeletion';

it('copies only selected subtrees, keeps hidden content and folds, and pastes an independent snapshot', () => {
  const original = recursiveFixture();
  original.rootDepths.app = 2;
  original.extensions = { collapsedObjects: ['api'] };
  const text = copySelection(original, ['object-app', 'object-api']);
  original.objects.app.name = 'Changed after copying';
  const snapshot = readSelection(text)!;
  expect(Object.keys(snapshot.objects).sort()).toEqual([
    'api',
    'app',
    'endpoint',
  ]);
  expect(snapshot.objects.app.name).toBe('app');
  expect(snapshot.objects.payments).toBeUndefined();
  const target = createRecursiveDocument('new', 'New');
  const copy = duplicateSelection(snapshot, ['object-app']);
  const result = transactDocument(target, copy.edit);
  expect(result.status).toBe('accepted');
  const id = copy.selection[0].slice(7);
  const api = Object.values(result.document.objects).find(
    (o) => o.parentId === id,
  )!;
  expect(result.document.layouts[id][2][id].x).toBe(
    snapshot.layouts.app[2].app.x + 24,
  );
  expect(result.document.layouts[id][2][id].y).toBe(
    snapshot.layouts.app[2].app.y + 24,
  );
  expect(recursiveScene(result.document).expanded.has(api.id)).toBe(false);
  expect(api.content).toEqual(snapshot.objects.api.content);
  expect(Object.keys(result.document.objects)).toHaveLength(3);
});

it('keeps a rotated nested object at its world position with its subtree and internal connection', () => {
  const original = recursiveFixture();
  original.rootDepths.app = 2;
  original.layouts.app[2].app.rotation = 90;
  original.connections.inside = {
    id: 'inside',
    kind: 'arrow',
    z: 0,
    ownerId: 'api',
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'object', objectId: 'endpoint', side: 'left', offset: 0.5 },
  };
  const before = JSON.stringify(original);
  const copied = readSelection(copySelection(original, ['object-api']))!;
  expect(copied.objects.api.parentId).toBeNull();
  expect(Object.keys(copied.objects).sort()).toEqual(['api', 'endpoint']);
  expect(recursiveScene(copied).world.get('api')).toEqual(
    recursiveScene(original).world.get('api'),
  );
  expect(copied.connections.inside).toEqual(original.connections.inside);
  expect(copied.rootDepths.api).toBe(1);
  expect(JSON.stringify(original)).toBe(before);
});

it('copies a selected connector without importing its owner or external endpoints', () => {
  const original = recursiveFixture();
  original.connections.arrow = {
    id: 'arrow',
    kind: 'arrow',
    z: 0,
    ownerId: 'app',
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'object', objectId: 'api', side: 'left', offset: 0.5 },
    points: [{ x: 5, y: 10 }],
  };
  const copied = readSelection(copySelection(original, ['connection-arrow']))!;
  expect(copied.objects).toEqual({});
  expect(copied.connections.arrow).toMatchObject({
    ownerId: null,
    start: { kind: 'free', x: 400, y: 20 },
    end: { kind: 'free', x: 360, y: 40 },
    points: [{ x: 405, y: 30 }],
  });
});

it('pastes nested copies into the same parent, or onto the canvas after that parent is deleted', () => {
  const original = recursiveFixture();
  original.layouts.app[1].app.rotation = 90;
  const source = readSelection(copySelection(original, ['object-api']))!;
  const copy = pasteSelection(source, 24);
  const result = transactDocument(original, copy.edit);
  expect(result.status).toBe('accepted');
  const id = copy.selection[0].slice(7);
  expect(result.document.objects[id].parentId).toBe('app');
  const before = recursiveScene(original).world.get('api')!;
  expect(recursiveScene(result.document).world.get(id)).toMatchObject({
    x: before.x + 24,
    y: before.y + 24,
  });
  const deleted = transactDocument(original, deleteSelection(['app'])).document;
  const restored = transactDocument(deleted, copy.edit);
  expect(restored.status).toBe('accepted');
  expect(restored.document.objects[id].parentId).toBeNull();
  expect(recursiveScene(restored.document).world.get(id)).toMatchObject({
    x: before.x + 24,
    y: before.y + 24,
  });
});

it('ignores ordinary text and rejects invalid diagram clipboard data', () => {
  expect(readSelection('text from another app')).toBeNull();
  expect(() => readSelection('DepthPlan clipboard v1\n{}')).toThrow();
});
