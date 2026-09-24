import { depthTools } from '../shared/depthApiContract';

const handle = { appInstanceId: 'a', sessionId: 's1' };
const state = { ...handle, documentId: 'd', revision: 7, dirty: true };
test('contract represents duplicate roots at independent depths and a leaf', () => {
  const tool = depthTools.depthplan_get_context;
  expect(tool.input.parse({ pageSize: 1 })).toEqual({ pageSize: 1 });
  const result = {
    ok: true,
    state,
    data: {
      appInstanceId: 'a',
      document: {
        title: 'Untitled',
        titleTruncated: false,
        formatVersion: 2,
        supported: true,
      },
      roots: [
        {
          id: 'r1',
          name: 'Service',
          nameTruncated: false,
          selectedDepth: 1,
          maximumDepth: 3,
        },
        {
          id: 'r2',
          name: 'Service',
          nameTruncated: false,
          selectedDepth: 0,
          maximumDepth: 0,
        },
      ],
      hasMore: false,
      nextCursor: null,
    },
  };
  expect(tool.output.parse(result)).toEqual(result);
});
test('contract rejects unknown fields, ambiguous labels, fractional depths and unbounded pages', () => {
  const base = { handle, rootId: 'r1', requestId: 'q1', expectedRevision: 7 };
  expect(
    depthTools.depthplan_set_depth.input.parse({ ...base, depth: 0 }).depth,
  ).toBe(0);
  for (const depth of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(
      depthTools.depthplan_set_depth.input.safeParse({ ...base, depth })
        .success,
    ).toBe(false);
  expect(
    depthTools.depthplan_reveal_all.input.safeParse({
      ...base,
      name: 'Service',
    }).success,
  ).toBe(false);
  expect(
    depthTools.depthplan_get_context.input.safeParse({ pageSize: 201 }).success,
  ).toBe(false);
});
test('hierarchy exposes ancestry for a hidden nested target without content', () => {
  const result = {
    ok: true,
    state,
    data: {
      objectId: 'n2',
      rootId: 'r1',
      hasMore: false,
      nextCursor: null,
      items: [
        {
          id: 'n2',
          parentId: 'n1',
          rootId: 'r1',
          name: 'Detail',
          nameTruncated: false,
          generation: 2,
          relativeGeneration: 0,
          childCount: 1,
          visible: false,
        },
      ],
    },
  };
  expect(depthTools.depthplan_get_hierarchy.output.parse(result)).toEqual(
    result,
  );
});
test('stale session result and idempotent command replay have explicit state', () => {
  const error = {
    ok: false,
    state: { ...state, sessionId: 's2' },
    error: {
      code: 'STALE_SESSION',
      message: 'Refresh context',
      retryable: false,
    },
  };
  expect(depthTools.depthplan_set_depth.output.parse(error)).toEqual(error);
  expect(
    depthTools.depthplan_set_depth.output.parse({
      ok: true,
      state: { ...state, revision: 9 },
      data: {
        rootId: 'r1',
        selectedDepth: 2,
        maximumDepth: 3,
        changed: false,
        replayed: true,
        appliedRevision: 8,
      },
    }).ok,
  ).toBe(true);
});
