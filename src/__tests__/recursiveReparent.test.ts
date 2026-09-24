import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture, geometry } from './recursiveFixtures';
import { reparentLayouts } from '../shared/recursiveReparent';
import { transactDocument } from '../shared/documentTransactions';
import {
  validateRecursiveDocument,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
const move = (d: RecursiveDocument, id: string, parent: string | null) => {
  const r = transactDocument(d, reparentLayouts(id, parent));
  if (r.status === 'rejected') throw new Error(r.error);
  validateRecursiveDocument(r.document);
  return r.document;
};
it('promotes saved D2 to D1 and restores exact original source arrangements on inverse', () => {
  const original = recursiveFixture();
  original.rootDepths.app = 2;
  original.layouts.app[0].api = { ...geometry, x: 999 };
  original.layouts.app[2].app.rotation = 37;
  const beforeWorld = activeWorldGeometry(original).get('api')!;
  const promoted = move(original, 'api', null);
  expect(promoted.layouts.api[1].endpoint).toEqual(
    original.layouts.app[2].endpoint,
  );
  expect(promoted.layouts.api[1].api.x).toBeCloseTo(beforeWorld.x);
  expect(promoted.rootDepths.api).toBe(1);
  expect(promoted.objects.endpoint.parentId).toBe('api');
  expect(promoted.extensions?.layoutArchive).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceDepth: 0,
        destinationDepth: null,
        geometry: { api: original.layouts.app[0].api },
      }),
    ]),
  );
  const returned = move(promoted, 'api', 'app');
  expect(returned.layouts).toEqual(original.layouts);
  expect(returned.objects).toEqual(original.objects);
});
it('cross-root moves initialize skipped destination depths and preserve unrelated geometry', () => {
  const original = recursiveFixture();
  original.rootDepths.app = 2;
  const before = JSON.parse(JSON.stringify(original));
  const moved = move(original, 'api', 'payments');
  expect(moved.layouts.payments[2].endpoint).toEqual(
    original.layouts.app[2].endpoint,
  );
  expect(moved.layouts.payments[2].payments).toEqual(
    original.layouts.payments[0].payments,
  );
  expect(moved.layouts.payments[2].api.x).toBeCloseTo(510 - 900);
  expect(moved.rootDepths.payments).toBe(1);
  expect(original).toEqual(before);
  const returned = move(moved, 'api', 'app');
  expect(returned.layouts).toEqual(original.layouts);
});
it('same-root generation changes preserve conflicting layouts and restore exact inverse', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  d.layouts.app[0].endpoint = { ...geometry, x: 777 };
  d.layouts.app[1].endpoint = { ...geometry, x: 888 };
  const moved = move(d, 'endpoint', 'app');
  expect(moved.layouts.app[1].endpoint.x).toBe(120);
  expect(moved.extensions?.layoutArchive).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceDepth: 1,
        geometry: { endpoint: d.layouts.app[1].endpoint },
      }),
    ]),
  );
  expect(move(moved, 'endpoint', 'api').layouts).toEqual(d.layouts);
});
it('archives newer conflicting edits during inverse instead of losing them', () => {
  const d = recursiveFixture();
  const promoted = move(d, 'api', null);
  promoted.layouts.api[1].api.x = 12345;
  const returned = move(promoted, 'api', 'app');
  expect(returned.layouts.app[2].api).toEqual(d.layouts.app[2].api);
  expect(returned.extensions?.layoutArchive).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        geometry: expect.objectContaining({
          api: expect.objectContaining({ x: 12345 }),
        }),
      }),
    ]),
  );
});
it('rejects cycles, missing targets and malformed archives atomically; same-parent is a no-op', () => {
  const d = recursiveFixture();
  for (const parent of ['endpoint', 'missing']) {
    const r = transactDocument(d, reparentLayouts('api', parent));
    expect(r.status).toBe('rejected');
    expect(r.document).toBe(d);
  }
  expect(transactDocument(d, reparentLayouts('api', 'app')).status).toBe(
    'noop',
  );
  d.extensions = { layoutArchive: [{ broken: true }] };
  expect(transactDocument(d, reparentLayouts('api', null)).status).toBe(
    'rejected',
  );
});

it('keeps destination arrangements edited while a subtree was away', () => {
  const d = recursiveFixture();
  const moved = move(d, 'api', 'payments');
  moved.layouts.payments[2].payments.x = 4321;
  const returned = move(moved, 'api', 'app');
  expect(returned.layouts.payments[2].payments.x).toBe(4321);
  expect(returned.layouts.app).toEqual(d.layouts.app);
});

it('one Undo restores all structural data and Redo restores the exact accepted move', () => {
  const original = recursiveFixture();
  const { result } = renderHook(() => useDocumentState(original));
  act(() => result.current.transact(reparentLayouts('api', null)));
  const moved = result.current.document;
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(original);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(moved);
});
