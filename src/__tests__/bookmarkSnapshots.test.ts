import { act, renderHook } from '@testing-library/react';
import { recursiveFixture, geometry } from './recursiveFixtures';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { editNamedView } from '../shared/namedViews';
import {
  editActiveGeometry,
  editObject,
  transactDocument,
} from '../shared/documentTransactions';
import {
  validateRecursiveDocument,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
import { setChildrenExpanded } from '../shared/recursiveLayouts';
import { moveSubtree } from '../shared/recursiveMovement';
import { deleteSelection } from '../shared/recursiveDeletion';

const savedCamera = { x: -140, y: 85, scale: 0.75 };
const laterCamera = { x: 600, y: -200, scale: 1.5 };

it('restores the same world focus and zoom after resizing and reopening, with compound Undo/Redo', () => {
  const { result } = renderHook(() => useDocumentState(recursiveFixture()));
  const viewport = { width: 1024, height: 696 };
  act(() => {
    result.current.setCanvas((canvas) => ({ ...canvas, viewport }));
    result.current.setCamera(savedCamera);
    result.current.changeNamedView({
      type: 'create',
      id: 'focus',
      name: 'Focus',
    });
    result.current.changeNamedView({
      type: 'duplicate',
      id: 'focus',
      newId: 'copy',
    });
  });
  const saved = JSON.parse(JSON.stringify(result.current.document));
  validateRecursiveDocument(saved);
  expect(saved.namedViews!.copy.cameraFocus).toEqual(
    saved.namedViews!.focus.cameraFocus,
  );
  act(() => {
    result.current.replace(saved);
    result.current.setCanvas((canvas) => ({
      ...canvas,
      viewport: { width: 1483, height: 1106 },
    }));
    result.current.setCamera(laterCamera);
    result.current.changeNamedView({ type: 'apply', id: 'focus' });
  });
  const expected = {
    x: savedCamera.x + 229.5,
    y: savedCamera.y + 205,
    scale: 0.75,
  };
  expect(result.current.camera).toEqual(expected);
  expect(result.current.dirty).toBe(false);
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.camera).toEqual(laterCamera);
  act(() => result.current.redo());
  expect(result.current.camera).toEqual(expected);
  act(() => result.current.changeNamedView({ type: 'apply', id: 'focus' }));
  expect(result.current.past).toHaveLength(1);
  act(() => {
    result.current.setCanvas((canvas) => ({
      ...canvas,
      viewport: { width: 640, height: 480 },
    }));
    result.current.changeNamedView({ type: 'apply', id: 'focus' });
  });
  expect(result.current.camera).toEqual({ x: -332, y: -23, scale: 0.75 });
});

function snapshotDocument() {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  d.extensions = { collapsedObjects: ['api'] };
  return transactDocument(
    d,
    editNamedView(
      { type: 'create', id: 'view', name: 'Children' },
      savedCamera,
    ),
  ).document;
}

it('captures each active layout, including collapsed children, and restores only positions and sizes with the camera in one undo', () => {
  const d = snapshotDocument();
  const view = d.namedViews!.view;
  expect(view.camera).toEqual(savedCamera);
  expect(view.layouts!.app.endpoint).toEqual({
    x: 10,
    y: 20,
    width: 100,
    height: 60,
    parentId: 'api',
  });
  expect(Object.keys(view.layouts!)).toEqual(['app', 'payments']);
  expect(view.layouts!.app.app.x).toBe(500);
  const { result } = renderHook(() => useDocumentState(d));
  act(() => {
    result.current.transact((draft) => {
      editActiveGeometry('app', { x: 800, y: 400, width: 500, height: 300 })(
        draft,
      );
      editActiveGeometry('endpoint', {
        x: -300,
        y: 250,
        width: 180,
        height: 90,
        rotation: 45,
        z: 3,
      })(draft);
      editObject('endpoint', { name: 'Edited', style: { fill: '#123456' } })(
        draft,
      );
      draft.layouts.app[0].app.width = 333;
      setChildrenExpanded('api', true)(draft);
    });
    result.current.setCamera(laterCamera);
  });
  const before = result.current.document;
  const history = result.current.past.length;
  act(() =>
    expect(
      result.current.changeNamedView({ type: 'apply', id: 'view' }).status,
    ).toBe('accepted'),
  );
  const applied = result.current.document as RecursiveDocument;
  expect(applied.layouts.app[2].app).toEqual(d.layouts.app[2].app);
  expect(applied.layouts.app[2].endpoint).toEqual({
    ...d.layouts.app[2].endpoint,
    rotation: 45,
    z: 3,
  });
  expect(applied.layouts.app[0].app.width).toBe(333);
  expect(applied.objects.endpoint).toMatchObject({
    name: 'Edited',
    style: { fill: '#123456' },
  });
  expect(applied.extensions?.collapsedObjects).toEqual(['api']);
  expect(applied.namedViews).toEqual(d.namedViews);
  expect(result.current.camera).toEqual(savedCamera);
  expect(result.current.past).toHaveLength(history + 1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(before);
  expect(result.current.camera).toEqual(laterCamera);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(applied);
  expect(result.current.camera).toEqual(savedCamera);
});

it('keeps camera navigation transient and supports a camera-only bookmark restore, undo and redo without marking the document dirty', () => {
  const d = snapshotDocument();
  const { result } = renderHook(() => useDocumentState(d));
  act(() => result.current.setCamera(laterCamera));
  expect(result.current.dirty).toBe(false);
  expect(result.current.revision).toBe(0);
  expect(result.current.canUndo).toBe(false);
  act(() => result.current.changeNamedView({ type: 'apply', id: 'view' }));
  expect(result.current.document).toBe(d);
  expect(result.current.camera).toEqual(savedCamera);
  expect(result.current.dirty).toBe(false);
  expect(result.current.past).toHaveLength(1);
  act(() =>
    expect(
      result.current.changeNamedView({ type: 'apply', id: 'view' }).status,
    ).toBe('noop'),
  );
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.camera).toEqual(laterCamera);
  act(() => result.current.setCamera((camera) => ({ ...camera, x: 123 })));
  expect(result.current.canRedo).toBe(true);
  act(() => result.current.redo());
  expect(result.current.camera).toEqual(savedCamera);
  act(() => result.current.transact(editObject('app', { name: 'New title' })));
  act(() => result.current.setCamera(laterCamera));
  act(() => result.current.undo());
  expect(result.current.camera).toEqual(laterCamera); // Ordinary edits do not restore the camera.
  act(() => result.current.replace(d));
  expect(result.current.camera).toEqual({ x: 0, y: 0, scale: 1 });
  expect(result.current.canUndo).toBe(false);
});

it('Reset View replaces all captured state, Duplicate keeps an independent saved snapshot, and the snapshot survives reopening', () => {
  const { result } = renderHook(() => useDocumentState(snapshotDocument()));
  act(() => {
    result.current.transact(
      editActiveGeometry('endpoint', { width: 220, x: 85 }),
    );
    result.current.setCamera(laterCamera);
    result.current.changeNamedView({
      type: 'duplicate',
      id: 'view',
      newId: 'copy',
    });
    result.current.changeNamedView({ type: 'update', id: 'view' });
  });
  const d = result.current.document as RecursiveDocument;
  expect(d.namedViews!.view.camera).toEqual(laterCamera);
  expect(d.namedViews!.view.layouts!.app.endpoint.width).toBe(220);
  expect(d.namedViews!.copy.camera).toEqual(savedCamera);
  expect(d.namedViews!.copy.layouts!.app.endpoint.width).toBe(100);
  const reopened = JSON.parse(JSON.stringify(d));
  validateRecursiveDocument(reopened);
  act(() => result.current.replace(reopened));
  act(() => result.current.changeNamedView({ type: 'apply', id: 'copy' }));
  expect(result.current.camera).toEqual(savedCamera);
  expect(
    (result.current.document as RecursiveDocument).layouts.app[2].endpoint
      .width,
  ).toBe(100);
  act(() => result.current.changeNamedView({ type: 'apply', id: 'view' }));
  expect(result.current.camera).toEqual(laterCamera);
  expect(
    (result.current.document as RecursiveDocument).layouts.app[2].endpoint
      .width,
  ).toBe(220);
});

it('preserves new and reparented objects and ignores deleted snapshot entries', () => {
  const { result } = renderHook(() => useDocumentState(snapshotDocument()));
  act(() => {
    result.current.transact(moveSubtree('endpoint', 'app', { x: 175, y: 20 }));
    result.current.transact(deleteSelection(['payments']));
    result.current.transact((draft) => {
      draft.objects.newRoot = {
        ...draft.objects.app,
        id: 'newRoot',
        parentId: null,
      };
      draft.rootDepths.newRoot = 0;
      draft.layouts.newRoot = { 0: { newRoot: { ...geometry, x: 1500 } } };
    });
  });
  const before = result.current.document as RecursiveDocument;
  act(() => result.current.changeNamedView({ type: 'apply', id: 'view' }));
  const after = result.current.document as RecursiveDocument;
  expect(after.objects.payments).toBeUndefined();
  expect(after.layouts.newRoot).toEqual(before.layouts.newRoot);
  expect(after.rootDepths.app).toBe(1);
  expect(after.layouts.app[1].endpoint).toEqual(before.layouts.app[1].endpoint);
  expect(after.namedViews!.view.layouts!.payments).toBeDefined();
});

it('keeps old bookmarks compatible and rejects busy restores without changing camera or layout', () => {
  const d = snapshotDocument();
  d.namedViews!.old = {
    id: 'old',
    name: 'Old',
    rootDepths: { app: 1, payments: 0 },
  };
  const { result } = renderHook(() => useDocumentState(d));
  act(() => {
    result.current.setCamera(laterCamera);
    result.current.transact(editActiveGeometry('app', { x: 720 }));
    result.current.setBusy('canvas-gesture', true);
  });
  const before = result.current.document;
  act(() =>
    expect(
      result.current.changeNamedView({ type: 'apply', id: 'view' }).status,
    ).toBe('rejected'),
  );
  expect(result.current.document).toBe(before);
  expect(result.current.camera).toEqual(laterCamera);
  act(() => {
    result.current.setBusy('canvas-gesture', false);
    result.current.setCanvas((canvas) => ({
      ...canvas,
      viewport: { width: 1483, height: 1106 },
    }));
    result.current.changeNamedView({ type: 'apply', id: 'view' });
  });
  expect(result.current.camera).toEqual(savedCamera); // No focus in pre-fix bookmarks.
  const beforeOld = result.current.document as RecursiveDocument;
  act(() => {
    result.current.setCamera(laterCamera);
    result.current.changeNamedView({ type: 'apply', id: 'old' });
  });
  expect(result.current.camera).toEqual(laterCamera);
  expect((result.current.document as RecursiveDocument).layouts).toEqual(
    beforeOld.layouts,
  );
});

it('validates optional camera and layout snapshots while accepting stale IDs', () => {
  const d = snapshotDocument();
  const saved = d.namedViews!.view;
  const badViews = [
    { ...saved, camera: null },
    ...[0, -1, Infinity, '1'].map((scale) => ({
      ...saved,
      camera: { ...savedCamera, scale },
    })),
    { ...saved, camera: { x: '0', y: 0, scale: 1 } },
    ...[null, {}, { x: '0', y: 1 }, { x: 0, y: Infinity }].map(
      (cameraFocus) => ({
        ...saved,
        cameraFocus,
      }),
    ),
    { ...saved, camera: undefined, cameraFocus: { x: 1, y: 2 } },
    { ...saved, layouts: [] },
    { ...saved, layouts: { missingRoot: {} } },
    ...[
      { width: 0 },
      { height: -1 },
      { x: '0' },
      { y: Infinity },
      { parentId: '__proto__' },
    ].map((patch) => ({
      ...saved,
      layouts: { app: { app: { ...saved.layouts!.app.app, ...patch } } },
    })),
  ];
  for (const view of badViews)
    expect(() =>
      validateRecursiveDocument({ ...d, namedViews: { view } }),
    ).toThrow();
  const stale = {
    ...saved,
    rootDepths: { missingRoot: 2 },
    layouts: {
      missingRoot: {
        deleted: { x: 1, y: 2, width: 3, height: 4, parentId: 'deletedParent' },
      },
    },
  };
  expect(() =>
    validateRecursiveDocument({ ...d, namedViews: { view: stale } }),
  ).not.toThrow();
});
