import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { mcpTools } from '../shared/mcpRegistry';
import { editObject } from '../shared/documentTransactions';
import type { ApiResult } from '../shared/depthApiContract';

const data = <T>(result: ApiResult<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};
const setup = () => {
  const hook = renderHook(() => useDocumentState(recursiveFixture(), 'app'));
  const handle = {
    appInstanceId: 'app',
    sessionId: hook.result.current.sessionId,
  };
  return { ...hook, handle };
};
it('reads hidden objects and effective geometry with bounded revision-bound pages', () => {
  const { result, handle } = setup();
  const args = { handle, collection: 'objects', pageSize: 1 };
  const first = data(result.current.editorQueries.query(args));
  expect(first.items[0]).toMatchObject({
    id: 'api',
    visible: true,
    activeGeometry: { x: 10 },
    worldGeometry: { x: 410 },
  });
  const second = data(
    result.current.editorQueries.query({ ...args, cursor: first.nextCursor }),
  );
  expect(second.items[0].id).toBe('app');
  const hidden = data(
    result.current.editorQueries.query({
      handle,
      collection: 'objects',
      ids: ['endpoint'],
    }),
  );
  expect(hidden.items[0]).toMatchObject({
    visible: false,
    worldGeometry: null,
    value: { name: 'endpoint' },
  });
  act(() => result.current.setCamera({ x: 2, y: 3, scale: 2 }));
  expect(
    result.current.editorQueries.query({ ...args, cursor: first.nextCursor }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_CURSOR' } });
  expect(result.current.snapshot()).toMatchObject({
    revision: 0,
    viewRevision: 1,
    dirty: false,
    canUndo: false,
  });
  expect(
    mcpTools.depthplan_get_state.output.safeParse(
      result.current.editorQueries.getState(),
    ).success,
  ).toBe(true);
});
it('does not truncate large content and supports complete versioned chunk reads', () => {
  const { result, handle } = setup();
  const text = '🦊'.repeat(300000);
  act(() =>
    result.current.transact(
      editObject('app', { content: [{ type: 'paragraph', runs: [{ text }] }] }),
    ),
  );
  expect(
    result.current.editorQueries.query({
      handle,
      collection: 'objects',
      ids: ['app'],
    }),
  ).toMatchObject({ ok: false, error: { code: 'RESPONSE_TOO_LARGE' } });
  let assembled = '',
    offset: number | null = 0;
  while (offset !== null) {
    const part: {
      text: string;
      totalLength: number;
      nextOffset: number | null;
    } = data(
      result.current.editorQueries.readChunk({
        handle,
        collection: 'objects',
        id: 'app',
        expectedRevision: 1,
        offset,
      }),
    );
    assembled += part.text;
    offset = part.nextOffset;
  }
  expect(JSON.parse(assembled).content[0].runs[0].text).toBe(text);
  expect(
    result.current.editorQueries.readChunk({
      handle,
      collection: 'objects',
      id: 'app',
      expectedRevision: 0,
    }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
});
it('rejects wrong sessions, changed query filters, and nonexistent layouts', () => {
  const { result, handle } = setup();
  const page = data(
    result.current.editorQueries.query({
      handle,
      collection: 'objects',
      pageSize: 1,
    }),
  );
  expect(
    result.current.editorQueries.query({
      handle,
      collection: 'connections',
      cursor: page.nextCursor,
    }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_CURSOR' } });
  expect(
    result.current.editorQueries.query({
      handle: { ...handle, sessionId: 'old' },
      collection: 'objects',
    }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_SESSION' } });
  expect(
    result.current.editorQueries.query({
      handle,
      collection: 'layouts',
      rootId: 'app',
      depth: 20,
    }),
  ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});
