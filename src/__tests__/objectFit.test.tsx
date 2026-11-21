import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import type { ApiResult } from '../shared/depthApiContract';
import type { RichBlock } from '../shared/recursiveDocument';
import {
  SHRINK_FLOOR,
  bodyFit,
  contentHeight,
  overflowingObjects,
  shrinkScale,
} from '../shared/objectFit';
import { editObject, transactDocument } from '../shared/documentTransactions';
import { recursiveFixture } from './recursiveFixtures';

const text = (words: number): RichBlock[] => [
  {
    type: 'paragraph',
    runs: [{ text: Array.from({ length: words }, () => 'word').join(' ') }],
  },
];
// Fixture objects are 100×60 with a name: the body is 88 wide and 28 tall.
function clippedFixture() {
  const document = recursiveFixture();
  document.objects.api.content = text(40); // visible, overflowing
  document.objects.app.content = text(40); // expanded parent: body not painted
  document.objects.endpoint.content = text(40); // hidden at depth 1
  document.objects.payments.content = text(2); // fits
  return document;
}
function setup() {
  const hook = renderHook(() => useDocumentState(clippedFixture(), 'app'));
  const ok = <T,>(result: ApiResult<T>) => {
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  };
  const handle = () => {
    const s = hook.result.current.snapshot();
    return { appInstanceId: s.appInstanceId, sessionId: s.sessionId };
  };
  const query = (extra: Record<string, unknown>) =>
    ok(
      hook.result.current.editorQueries.query({
        handle: handle(),
        collection: 'objects',
        pageSize: 200,
        ...extra,
      }),
    ).items as { id: string; overflow: boolean; activeGeometry: any }[];
  const edit = (actions: unknown[]) => {
    let result!: ApiResult<unknown>;
    act(() => {
      const s = hook.result.current.snapshot();
      result = hook.result.current.editorCommand('edit', {
        handle: handle(),
        expectedRevision: s.revision,
        expectedViewRevision: s.viewRevision,
        requestId: crypto.randomUUID(),
        actions,
      });
    });
    return ok(result);
  };
  return { ...hook, query, edit };
}

it('reports and filters every clipped object in the active layout', () => {
  const { query } = setup();
  expect(query({ overflow: true }).map((item) => item.id)).toEqual(['api']);
  expect(query({}).find((item) => item.id === 'payments')?.overflow).toBe(
    false,
  );
  expect(
    query({ overflow: false })
      .map((item) => item.id)
      .sort(),
  ).toEqual(['app', 'endpoint', 'payments']);
});

it('grow-height clears overflow and grows the active layout in one undo step', () => {
  const { query, edit, result } = setup();
  const before = result.current.snapshot().document!;
  edit([{ type: 'edit_object', id: 'api', style: { fit: 'grow-height' } }]);
  expect(query({ overflow: true })).toEqual([]);
  const after = result.current.snapshot().document!;
  const grown = after.layouts.app[1].api;
  expect(grown.height).toBeGreaterThan(60);
  // The top edge stays where it was.
  expect(grown.y - grown.height / 2).toBeCloseTo(
    before.layouts.app[1].api.y - 30,
  );
  // Other depths keep their authored size and may still clip there.
  expect(after.layouts.app[2].api.height).toBe(60);
  // Growing is applied again when content changes, but never shrinks.
  edit([{ type: 'edit_object', id: 'api', content: text(80) }]);
  const taller = result.current.snapshot().document!.layouts.app[1].api;
  expect(taller.height).toBeGreaterThan(grown.height);
  edit([{ type: 'edit_object', id: 'api', content: text(1) }]);
  expect(result.current.snapshot().document!.layouts.app[1].api.height).toBe(
    taller.height,
  );
  act(() => result.current.undo());
  act(() => result.current.undo());
  act(() => result.current.undo());
  expect(result.current.snapshot().document).toEqual(before);
  expect(query({ overflow: true }).map((item) => item.id)).toEqual(['api']);
});

it('computes a shrink-text scale with a floor that then counts as overflow', () => {
  const measure = (value: string) => value.length * 6;
  expect(shrinkScale(text(2), 100, 40, measure)).toEqual({
    scale: 1,
    overflow: false,
  });
  const fitted = shrinkScale(text(30), 100, 60, measure);
  expect(fitted.overflow).toBe(false);
  expect(fitted.scale).toBeGreaterThan(SHRINK_FLOOR);
  expect(fitted.scale).toBeLessThan(1);
  expect(
    contentHeight(text(30), 100 / fitted.scale, measure) * fitted.scale,
  ).toBeLessThanOrEqual(60.5);
  expect(shrinkScale(text(300), 100, 60, measure)).toEqual({
    scale: SHRINK_FLOOR,
    overflow: true,
  });
  const document = clippedFixture();
  const api = {
    ...document.objects.api,
    style: { fit: 'shrink-text' },
    content: text(8),
  };
  expect(bodyFit(api, api.content, 100, 60, true, false)).toMatchObject({
    overflow: false,
  });
  expect(bodyFit(api, api.content, 100, 60, true, false).scale).toBeLessThan(1);
});

it('leaves default (clip) documents unchanged', () => {
  const document = clippedFixture();
  const edited = transactDocument(
    document,
    editObject('api', { content: text(200) }),
  );
  expect(edited.status).toBe('accepted');
  expect(edited.document.layouts).toBe(document.layouts);
  expect([...overflowingObjects(edited.document)]).toEqual(['api']);
  expect(
    transactDocument(document, editObject('payments', { name: 'payments' }))
      .status,
  ).toBe('noop');
});
