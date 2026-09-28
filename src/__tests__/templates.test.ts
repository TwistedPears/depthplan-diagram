import { act, renderHook } from '@testing-library/react';
import { bundledTemplates } from '../shared/bundledTemplates';
import {
  createTemplate,
  insertTemplate,
  validateTemplate,
} from '../shared/templates';
import {
  createRecursiveDocument,
  type Json,
  type RecursiveDocument,
  validateRecursiveDocument,
} from '../shared/recursiveDocument';
import { transactDocument } from '../shared/documentTransactions';
import {
  collapsedObjects,
  setCollapsedObjects,
} from '../shared/recursiveVisibility';
import {
  fitCamera,
  intersectsBounds,
  sceneBounds,
} from '../shared/recursiveCamera';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { editNamedView } from '../shared/namedViews';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const apply = (
  document: RecursiveDocument,
  edit: Parameters<typeof transactDocument>[1],
) => {
  const result = transactDocument(document, edit);
  if (result.status === 'rejected') throw new Error(result.error);
  return result.document;
};

test.each(bundledTemplates)(
  '$metadata.title inserts independent ordinary shapes, wiring and every depth',
  (source) => {
    const before = clone(source);
    let destination = recursiveFixture();
    destination.metadata.title = 'Keep this board';
    destination = apply(
      destination,
      editNamedView(
        { type: 'create', id: 'keep', name: 'Keep' },
        { x: 0, y: 0, scale: 1 },
        { width: 1280, height: 900 },
      ),
    );
    destination.extensions = {
      localPreference: true,
      templateSources: ['legacy metadata'],
    };
    const original = clone(destination);
    const insertion = insertTemplate(source, destination);
    destination = apply(destination, insertion.edit);
    expect(destination.id).toBe(original.id);
    expect(destination.metadata.title).toBe(original.metadata.title);
    expect(destination.namedViews).toEqual(original.namedViews);
    expect(destination.extensions).toMatchObject(original.extensions!);
    expect(destination.extensions?.template).toBeUndefined();
    for (const id of Object.keys(original.objects))
      expect(destination.objects[id]).toEqual(original.objects[id]);
    for (const id of Object.keys(original.layouts))
      expect(destination.layouts[id]).toEqual(original.layouts[id]);
    expect(destination.connections).toMatchObject(original.connections);
    const incoming = Object.values(destination.objects).filter(
      (object) => !(object.id in original.objects),
    );
    expect(incoming).toHaveLength(Object.keys(source.objects).length);
    for (const object of incoming) {
      expect(source.objects[object.id]).toBeUndefined();
      const authored = Object.values(source.objects).find(
        (item) =>
          item.name === object.name &&
          (item.parentId === null
            ? object.parentId === null
            : object.parentId !== null &&
              source.objects[item.parentId].name ===
                destination.objects[object.parentId].name),
      )!;
      expect(object.content).toEqual(authored.content);
      if (object.parentId !== null)
        expect(object.geometry).toEqual(authored.geometry);
      else {
        expect(destination.rootDepths[object.id]).toBe(
          source.rootDepths[authored.id],
        );
        const dx = object.geometry.x - authored.geometry.x;
        const dy = object.geometry.y - authored.geometry.y;
        for (const [depth, layout] of Object.entries(
          source.layouts[authored.id],
        )) {
          expect(
            destination.layouts[object.id][depth][object.id],
          ).toMatchObject({
            x: layout[authored.id].x + dx,
            y: layout[authored.id].y + dy,
          });
          expect(
            Object.keys(destination.layouts[object.id][depth]),
          ).toHaveLength(Object.keys(layout).length);
        }
      }
    }
    const first = clone(destination);
    destination = apply(destination, insertTemplate(source, destination).edit);
    expect(Object.keys(destination.objects)).toHaveLength(
      Object.keys(original.objects).length + incoming.length * 2,
    );
    expect(destination.extensions).toEqual(first.extensions);
    expect(source).toEqual(before);
    validateRecursiveDocument(clone(destination));
  },
);

test('placement clears rotated shapes, visible overflow, connectors and repeated inserts without moving existing content', () => {
  let destination = recursiveFixture();
  destination.layouts.app[1].api.x = -800;
  destination.layouts.app[1].api.rotation = 45;
  destination.connections.long = {
    id: 'long',
    ownerId: null,
    kind: 'arrow',
    z: 0,
    start: { kind: 'free', x: -1000, y: 0 },
    end: { kind: 'free', x: 1400, y: 150 },
    label: 'Existing connector',
  };
  const original = clone(destination);
  for (let i = 0; i < 5; i++) {
    const occupied = sceneBounds(destination);
    const insertion = insertTemplate(bundledTemplates[0], destination);
    for (const box of [
      ...occupied.objects.values(),
      ...occupied.connections.values(),
    ])
      expect(intersectsBounds(insertion.bounds, box)).toBe(false);
    destination = apply(destination, insertion.edit);
  }
  expect(destination.objects).toMatchObject(original.objects);
  expect(destination.layouts).toMatchObject(original.layouts);
  expect(destination.connections.long).toEqual(original.connections.long);
});

test('uses open space at the current view instead of moving every sample beyond the board edge', () => {
  const destination = recursiveFixture();
  const center = { x: -5000, y: 7000 };
  for (const board of [
    destination,
    createRecursiveDocument('empty', 'Empty'),
  ]) {
    const insertion = insertTemplate(bundledTemplates[0], board, center);
    expect(insertion.bounds.x + insertion.bounds.width / 2).toBe(center.x);
    expect(insertion.bounds.y + insertion.bounds.height / 2).toBe(center.y);
  }
});

test('preserves local folds and restores the board and camera in one Undo/Redo action', () => {
  const source = clone(bundledTemplates[2]);
  setCollapsedObjects(source, new Set(['plc']));
  const document = recursiveFixture();
  const { result } = renderHook(() => useDocumentState(document));
  const before = result.current.document;
  const camera = result.current.camera;
  const insertion = insertTemplate(source, document);
  const fitted = fitCamera(insertion.bounds, { width: 1280, height: 900 });
  act(() => {
    expect(result.current.transact(insertion.edit, fitted)?.status).toBe(
      'accepted',
    );
  });
  const inserted = result.current.document!;
  const plc = Object.values(inserted.objects).find(
    (object) => object.name === source.objects.plc.name,
  )!;
  expect(collapsedObjects(inserted).has(plc.id)).toBe(true);
  expect(result.current.dirty).toBe(true);
  expect(result.current.camera).toEqual(fitted);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(before);
  expect(result.current.camera).toEqual(camera);
  expect(result.current.canUndo).toBe(false);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(inserted);
  expect(result.current.camera).toEqual(fitted);
});

test('standalone connectors translate their endpoints and control points with the sample', () => {
  const document = createRecursiveDocument('line', 'Line');
  document.connections.line = {
    id: 'line',
    kind: 'line',
    ownerId: null,
    z: 0,
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 100, y: 100 },
    points: [{ x: 25, y: 75 }],
  };
  const source = createTemplate(document, {
    ...bundledTemplates[0].extensions.template,
    components: [],
  });
  const destination = createRecursiveDocument('target', 'Target');
  const insertion = insertTemplate(source, destination, { x: -500, y: 800 });
  const inserted = apply(destination, insertion.edit);
  const line = Object.values(inserted.connections)[0];
  expect(line).toMatchObject({
    start: { x: -550, y: 750 },
    end: { x: -450, y: 850 },
    points: [{ x: -525, y: 825 }],
  });
  expect(insertion.selection).toEqual([`connection-${line.id}`]);
  expect(sceneBounds(inserted).bounds).toEqual(insertion.bounds);
});

test('empty and invalid templates are rejected before touching the board', () => {
  const document = createRecursiveDocument('target', 'Target');
  const empty = createTemplate(document, {
    ...bundledTemplates[0].extensions.template,
    components: [],
  });
  expect(() => insertTemplate(empty, document)).toThrow(/no content/);
  expect(() =>
    insertTemplate(bundledTemplates[0], document, { x: NaN, y: 0 }),
  ).toThrow(/position/);
  expect(Object.keys(document.objects)).toHaveLength(0);
});

test('saving a selection reuses ordinary copy semantics, including hidden descendants and multiple roots', () => {
  const source = clone(bundledTemplates[0]);
  source.rootDepths.database = 1;
  source.metadata.filePath = '/private/source';
  source.extensions.templateSources = [];
  const manifest = { ...source.extensions.template, components: [] };
  const selected = createTemplate(source, manifest, ['object-customers']);
  expect(Object.keys(selected.objects)).toHaveLength(4);
  expect(selected.objects.customers.parentId).toBeNull();
  expect(selected.namedViews).toBeUndefined();
  expect(selected.extensions.templateSources).toBeUndefined();
  expect(selected.metadata.filePath).toBeUndefined();
  expect(selected.extensions.template.excludedConnections).toEqual([
    'orders.customer_id → customers.id',
  ]);
  const multiple = createTemplate(source, manifest, [
    'object-customers',
    'object-orders',
  ]);
  expect(Object.keys(multiple.rootDepths)).toHaveLength(2);
  expect(Object.keys(multiple.connections)).toHaveLength(1);
  expect(multiple.extensions.template.excludedConnections).toEqual([]);
  validateTemplate(multiple);
});

test('portable format still rejects unsupported manifests and strips source bookkeeping', () => {
  for (const patch of [
    { formatVersion: 2 },
    { id: '../path' },
    { version: 0 },
    { name: '' },
    {
      components: [
        {
          id: 'bad',
          rootId: 'missing',
          name: 'Bad',
          parentRole: '',
          guidance: '',
        },
      ],
    },
  ]) {
    const bad = clone(bundledTemplates[0]);
    Object.assign(bad.extensions.template, patch);
    expect(() => validateTemplate(bad)).toThrow();
  }
  const bad = clone(bundledTemplates[0]);
  bad.extensions.templateSources = [bundledTemplates[0]] as unknown as Json;
  expect(() => validateTemplate(bad)).toThrow(/source\/session/);
  const cleaned = createTemplate(bad, bad.extensions.template);
  expect(cleaned.extensions.templateSources).toBeUndefined();
  expect(() => validateTemplate(cleaned)).not.toThrow();
});
