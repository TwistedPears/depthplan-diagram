import { bundledTemplates } from '../shared/bundledTemplates';
import {
  createTemplate,
  insertTemplate,
  newFromTemplate,
  retainedTemplates,
  templateComponent,
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
import { resolveNamedViewCamera } from '../shared/namedViews';
import { indexHierarchy } from '../shared/recursiveHierarchy';
import { selectRootDepth } from '../shared/recursiveLayouts';
import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const apply = (
  document: RecursiveDocument,
  edit: Parameters<typeof transactDocument>[1],
) => {
  const result = transactDocument(document, edit);
  if (result.status === 'rejected') throw new Error(result.error);
  return result.document;
};

test.each(bundledTemplates)(
  '$metadata.title preserves independent starters, bookmarks and portable definitions',
  (source) => {
    validateTemplate(source);
    const first = newFromTemplate(source),
      second = newFromTemplate(source);
    expect(first.id).not.toBe(source.id);
    expect(first.id).not.toBe(second.id);
    expect(
      Object.keys(first.objects).some(
        (id) => id in source.objects || id in second.objects,
      ),
    ).toBe(false);
    expect(
      Object.keys(first.connections).some((id) => id in source.connections),
    ).toBe(false);
    expect(
      Object.keys(first.namedViews!).some((id) => id in source.namedViews!),
    ).toBe(false);
    expect(Object.keys(first.objects)).toHaveLength(
      Object.keys(source.objects).length,
    );
    for (const view of Object.values(first.namedViews!)) {
      expect(
        Object.keys(view.rootDepths).every((id) => id in first.rootDepths),
      ).toBe(true);
      const camera = resolveNamedViewCamera(view, { width: 400, height: 600 })!;
      expect((200 - camera.x) / camera.scale).toBeCloseTo(view.cameraFocus!.x);
      expect((300 - camera.y) / camera.scale).toBeCloseTo(view.cameraFocus!.y);
      for (const layout of Object.values(view.layouts!))
        for (const [id, g] of Object.entries(layout)) {
          expect(first.objects[id]).toBeDefined();
          expect(g.parentId).toBe(first.objects[id].parentId);
        }
    }
    expect(retainedTemplates(clone(first))).toEqual([source]);
    first.objects[Object.keys(first.objects)[0]].name = 'Changed';
    expect(source.objects[Object.keys(source.objects)[0]].name).not.toBe(
      'Changed',
    );
    validateRecursiveDocument(clone(second));
  },
);

test('hidden subtree extraction excludes external wiring and cleans provenance', () => {
  const source = clone(bundledTemplates[0]);
  source.rootDepths.database = 0;
  source.metadata.filePath = '/private/source';
  source.extensions.clipboardParents = { customers: 'database' };
  source.extensions.layoutArchive = [];
  const extracted = templateComponent(source, 'customers');
  expect(Object.keys(extracted.document.objects)).toHaveLength(4);
  expect(extracted.document.layouts.customers[1]['customers-column-0']).toEqual(
    source.layouts.database[2]['customers-column-0'],
  );
  expect(extracted.excluded).toEqual(['orders.customer_id → customers.id']);
  expect(extracted.document.namedViews).toBeUndefined();
  expect(extracted.document.extensions).toEqual({});
  expect(extracted.document.metadata.filePath).toBeUndefined();
});

test('insertion under a rotated hidden parent preserves unrelated layouts, bookmarks, folds, wiring and one-step history', () => {
  const source = clone(bundledTemplates[2]);
  setCollapsedObjects(source, new Set(['plc']));
  const destination = newFromTemplate(bundledTemplates[0]);
  const table = Object.values(destination.objects).find(
    (o) => o.name === 'customers',
  )!;
  table.geometry.rotation = 35;
  const hierarchy = indexHierarchy(destination.objects),
    root = hierarchy.entries.get(table.id)!.root;
  destination.rootDepths[root] = 0;
  for (const layout of Object.values(destination.layouts[root]))
    if (layout[table.id]) layout[table.id].rotation = 35;
  setCollapsedObjects(destination, new Set([root]));
  // A copied root must not renumber unrelated destination stacking geometry.
  for (const layout of Object.values(destination.layouts[root]))
    layout[root].z = 500;
  const before = clone(destination);
  const { result } = renderHook(() => useDocumentState(destination));
  const insertion = insertTemplate(source, 'plc', table.id, { x: 75, y: 90 });
  act(() => {
    expect(result.current.transact(insertion.edit)?.status).toBe('accepted');
  });
  const inserted = result.current.document!;
  expect(inserted.objects[insertion.rootId].parentId).toBe(table.id);
  expect(inserted.rootDepths).toEqual(before.rootDepths);
  expect(inserted.namedViews).toEqual(before.namedViews);
  expect(collapsedObjects(inserted)).toEqual(new Set([root, insertion.rootId]));
  for (const [depth, layout] of Object.entries(before.layouts[root]))
    for (const [id, geometry] of Object.entries(layout))
      expect(inserted.layouts[root][depth][id]).toEqual(geometry);
  expect(inserted.layouts[root][2][insertion.rootId]).toMatchObject({
    x: 75,
    y: 90,
    rotation: 0,
  });
  const internal = Object.values(inserted.connections).find(
    (c) => c.label === 'control signal',
  )!;
  expect(internal.ownerId).toBe(insertion.rootId);
  expect(
    internal.start.kind !== 'free' &&
      inserted.objects[internal.start.objectId].parentId,
  ).toBe(insertion.rootId);
  act(() => {
    result.current.undo();
  });
  expect(result.current.document).toEqual(before);
  act(() => {
    result.current.redo();
  });
  expect(result.current.document).toEqual(inserted);
  const second = insertTemplate(source, 'plc', table.id);
  act(() => {
    result.current.transact(second.edit);
  });
  expect(retainedTemplates(result.current.document!)).toHaveLength(2);
  expect(second.rootId).not.toBe(insertion.rootId);
  expect(
    Object.values(result.current.document!.connections).filter(
      (c) => c.label === 'control signal',
    ),
  ).toHaveLength(2);
  expect(source.objects.plc.name).toBe('PLC-01 · cell controller');
});

test.each(bundledTemplates)(
  '$metadata.title inserts all patterns on canvas and at multiple depths',
  (source) => {
    for (const component of source.extensions.template.components) {
      let destination = newFromTemplate(bundledTemplates[0]);
      const parents = [null, ...Object.keys(destination.objects).slice(0, 3)];
      for (const parent of parents) {
        const inserted = insertTemplate(source, component.id, parent);
        destination = apply(destination, inserted.edit);
        validateRecursiveDocument(destination);
        expect(destination.objects[inserted.rootId].parentId).toBe(parent);
      }
    }
  },
);

test('invalid insertion leaves document/history untouched and retained version conflicts are explicit', () => {
  const { result } = renderHook(() =>
    useDocumentState(createRecursiveDocument('target', 'Target')),
  );
  const invalid = insertTemplate(bundledTemplates[0], 'customers', 'missing');
  const before = result.current.document;
  act(() => {
    expect(result.current.transact(invalid.edit)?.status).toBe('rejected');
  });
  expect(result.current.document).toBe(before);
  expect(result.current.canUndo).toBe(false);
  act(() => {
    result.current.transact(
      insertTemplate(bundledTemplates[0], 'customers', null).edit,
    );
  });
  const conflicting = clone(bundledTemplates[0]);
  conflicting.objects.customers.name = 'Changed source';
  act(() => {
    expect(
      result.current.transact(
        insertTemplate(conflicting, 'customers', null).edit,
      )?.status,
    ).toBe('rejected');
  });
});

test('portable format rejects unsupported/corrupt manifests and source bookkeeping', () => {
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

test('Purdue functional labels survive disclosure and cross-level connections survive reopening', () => {
  const doc = newFromTemplate(bundledTemplates[2]);
  const root = Object.keys(doc.rootDepths)[0];
  const expanded = apply(doc, selectRootDepth(root, 'all'));
  expect(
    Object.values(expanded.objects).filter((o) => /^Level [0-4]/.test(o.name)),
  ).toHaveLength(5);
  expect(
    Object.values(expanded.objects).some((o) =>
      o.name.includes('3.5 · optional'),
    ),
  ).toBe(true);
  expect(clone(expanded).connections).toEqual(doc.connections);
});
