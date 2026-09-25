import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { mcpTools } from '../shared/mcpRegistry';
import { editObject } from '../shared/documentTransactions';
import { deleteSelection } from '../shared/recursiveDeletion';
import type { ApiResult } from '../shared/depthApiContract';
import {
  generateStressDocument,
  stressPresets,
} from '../shared/stressDocument';

const data = <T>(result: ApiResult<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};
function fixture() {
  const doc = recursiveFixture();
  doc.objects.app.name = 'Admin engine';
  doc.objects.endpoint.name = 'Admin::Person';
  doc.objects.endpoint.content = [
    {
      type: 'paragraph',
      runs: [{ text: 'Aliases: peo' }, { text: 'ple crm_members' }],
    },
    {
      type: 'quote',
      blocks: [{ type: 'heading', level: 2, runs: [{ text: 'HTTPClient' }] }],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            type: 'code',
            language: 'plaintext',
            text: 'engines/admin/app/models/person.rb\nAdmin::Person.find(id)',
          },
        ],
      ],
    },
  ];
  doc.objects.payments.name = 'Billing::Person';
  doc.namedViews = {
    overview: {
      id: 'overview',
      name: 'People overview',
      rootDepths: { ...doc.rootDepths },
    },
  };
  doc.connections = {
    relation: {
      id: 'relation',
      ownerId: null,
      kind: 'arrow',
      z: 0,
      start: { kind: 'object', objectId: 'api', side: 'right', offset: 0.5 },
      end: { kind: 'object', objectId: 'payments', side: 'left', offset: 0.5 },
      label: 'People route',
    },
    free: {
      id: 'free',
      ownerId: 'api',
      kind: 'line',
      z: 0,
      start: { kind: 'free', x: 0, y: 0 },
      end: { kind: 'free', x: 10, y: 0 },
      label: 'People detail',
    },
  };
  return doc;
}
function setup(doc = fixture()) {
  const hook = renderHook(() => useDocumentState(doc, 'app'));
  const handle = {
    appInstanceId: 'app',
    sessionId: hook.result.current.sessionId,
  };
  const search = (query: string, filters: Record<string, unknown> = {}) =>
    hook.result.current.editorQueries.search({ handle, query, ...filters });
  return { ...hook, handle, search };
}

it('finds literal names, nested rich/code content, paths and recorded Rails aliases including hidden descendants', () => {
  const { search } = setup();
  for (const query of [
    'Admin::Person',
    'person.rb',
    'CRM_MEMBERS',
    'people httpclient find(id)',
    'admin::person engines/admin/app/models/person.rb',
  ]) {
    const page = data(search(query));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'endpoint',
      collection: 'objects',
      label: 'Admin::Person',
      rootId: 'app',
      ancestorIds: ['app', 'api'],
      visible: false,
    });
  }
  expect(
    data(search('Person', { collection: 'objects' })).items.map(
      (item) => item.id,
    ),
  ).toEqual(['endpoint', 'payments']);
  for (const query of [
    'Persons',
    'unrecorded_alias',
    '.*',
    'person missing',
    '  \n ',
  ])
    expect(data(search(query)).items).toEqual([]);
});

it('distinguishes collections and defines inclusive root/subtree and connection scopes without inventing bookmark associations', () => {
  const { search } = setup();
  expect(
    data(search('people')).items.map(({ collection, id }) => [collection, id]),
  ).toEqual([
    ['objects', 'endpoint'],
    ['connections', 'free'],
    ['connections', 'relation'],
    ['bookmarks', 'overview'],
  ]);
  expect(
    data(search('people', { subtreeId: 'api' })).items.map(({ id }) => id),
  ).toEqual(['endpoint', 'free', 'relation']);
  expect(
    data(search('person', { rootId: 'payments' })).items.map(({ id }) => id),
  ).toEqual(['payments']);
  expect(
    data(search('person', { rootId: 'app', subtreeId: 'endpoint' })).items.map(
      ({ id }) => id,
    ),
  ).toEqual(['endpoint']);
  expect(
    data(search('people', { collection: 'bookmarks' })).items[0],
  ).not.toHaveProperty('rootId');
  expect(data(search('route')).items[0]).toMatchObject({
    collection: 'connections',
    visible: true,
    ownerId: null,
    start: { objectId: 'api' },
    end: { objectId: 'payments' },
  });
  expect(data(search('detail')).items[0].visible).toBe(false);
  for (const [filters, code] of [
    [{ rootId: 'missing' }, 'NOT_FOUND'],
    [{ subtreeId: 'missing' }, 'NOT_FOUND'],
    [{ rootId: 'api' }, 'NOT_ROOT'],
    [{ rootId: 'payments', subtreeId: 'api' }, 'INVALID_REQUEST'],
    [{ collection: 'bookmarks', subtreeId: 'api' }, 'INVALID_REQUEST'],
  ] as const)
    expect(search('people', filters)).toMatchObject({
      ok: false,
      error: { code },
    });
});

it('includes collapsed descendants and reports connection visibility without changing document or view state', () => {
  const doc = fixture();
  doc.extensions = { collapsedObjects: ['app'] };
  const { search, result } = setup(doc);
  const before = JSON.parse(JSON.stringify(result.current.snapshot()));
  expect(data(search('person')).items[0].visible).toBe(false);
  expect(data(search('route')).items[0].visible).toBe(false);
  expect(result.current.snapshot()).toEqual(before);
  expect(result.current.snapshot().document).toEqual(doc);
  expect(mcpTools.depthplan_search.readOnly).toBe(true);
  expect(
    mcpTools.depthplan_search.output.safeParse(search('person')).success,
  ).toBe(true);
});

it('pages deterministically and rejects changed filters, view/document revisions, sessions and query cursors', () => {
  const { search, result, handle } = setup();
  const first = data(search('people', { pageSize: 1 }));
  expect(first.items[0].id).toBe('endpoint');
  let cursor = first.nextCursor;
  const ids = ['endpoint'];
  while (cursor) {
    const page = data(search('people', { pageSize: 1, cursor }));
    ids.push(...page.items.map(({ id }) => id));
    cursor = page.nextCursor;
  }
  expect(ids).toEqual(['endpoint', 'free', 'relation', 'overview']);
  for (const filters of [
    { pageSize: 2 },
    { collection: 'objects' },
    { rootId: 'app' },
  ])
    expect(
      search('people', { pageSize: 1, ...filters, cursor: first.nextCursor }),
    ).toMatchObject({ ok: false, error: { code: 'STALE_CURSOR' } });
  expect(
    search('other', { pageSize: 1, cursor: first.nextCursor }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_CURSOR' } });
  const queryCursor = data(
    result.current.editorQueries.query({
      handle,
      collection: 'objects',
      pageSize: 1,
    }),
  ).nextCursor;
  expect(search('people', { pageSize: 1, cursor: queryCursor })).toMatchObject({
    ok: false,
    error: { code: 'STALE_CURSOR' },
  });
  expect(
    result.current.editorQueries.query({
      handle,
      collection: 'objects',
      pageSize: 1,
      cursor: first.nextCursor,
    }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_CURSOR' } });
  act(() => result.current.setCamera({ x: 1, y: 2, scale: 1 }));
  expect(
    search('people', { pageSize: 1, cursor: first.nextCursor }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_CURSOR' } });
  const fresh = data(search('people', { pageSize: 1 }));
  act(() => result.current.transact(editObject('api', { name: 'Changed' })));
  expect(
    search('people', { pageSize: 1, cursor: fresh.nextCursor }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_CURSOR' } });
  expect(
    search('people', { handle: { ...handle, sessionId: 'old' } }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_SESSION' } });
  expect(
    search('people', { handle: { ...handle, appInstanceId: 'old' } }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_APP' } });
});

it('reflects edits and deletion immediately and returns useful bounded snippets from large content', () => {
  const { search, result } = setup();
  const text = `${'unrelated '.repeat(10000)}Target::Find(path)${' trailing'.repeat(1000)}`;
  act(() =>
    result.current.transact(
      editObject('endpoint', {
        name: 'Long '.repeat(1000),
        content: [{ type: 'code', language: 'plaintext', text }],
      }),
    ),
  );
  expect(data(search('Admin::Person')).items).toEqual([]);
  const item = data(search('Target::Find(path)')).items[0];
  expect(item.label.length).toBe(512);
  expect(item.labelTruncated).toBe(true);
  expect(item.snippet).toContain('Target::Find(path)');
  expect(item.snippet.length).toBeLessThanOrEqual(240);
  expect(item.snippetTruncated).toBe(true);
  act(() => result.current.transact(deleteSelection(['endpoint'])));
  expect(data(search('Target::Find(path)')).items).toEqual([]);
});

it('bounds and paginates large documents without duplicating matches or retaining stale pages', () => {
  const doc = generateStressDocument({
    ...stressPresets.large,
    seed: 'search-v1',
  }).document;
  for (const object of Object.values(doc.objects)) object.name = 'Shared';
  const { search } = setup(doc);
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const response = search('shared', {
      collection: 'objects',
      pageSize: 200,
      ...(cursor ? { cursor } : {}),
    });
    const page = data(response);
    expect(
      new TextEncoder().encode(JSON.stringify(response)).length,
    ).toBeLessThan(1024 * 1024);
    expect(page.items.length).toBeLessThanOrEqual(200);
    ids.push(...page.items.map(({ id }) => id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toEqual(Object.keys(doc.objects).sort());
});

it('rejects invalid inputs and bounds retained cursors', () => {
  const { search } = setup();
  for (const filters of [
    { pageSize: 201 },
    { collection: 'layouts' },
    { extra: true },
    { cursor: 'bad' },
  ])
    expect(search('people', filters)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
  expect(search('a'.repeat(1025))).toMatchObject({
    ok: false,
    error: { code: 'INVALID_REQUEST' },
  });
  const first = data(search('people', { pageSize: 1 }));
  for (let i = 0; i < 256; i++) data(search('people', { pageSize: 1 }));
  expect(
    search('people', { pageSize: 1, cursor: first.nextCursor }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_CURSOR' } });
});

it('positions snippets correctly when Unicode case folding changes string length', () => {
  const doc = fixture();
  doc.objects.endpoint.content = [
    {
      type: 'code',
      language: 'plaintext',
      text: `${'İ'.repeat(1000)} Target::Find(旧)`,
    },
  ];
  const { search } = setup(doc);
  expect(data(search('Target::Find(旧)')).items[0].snippet).toContain(
    'Target::Find(旧)',
  );
});

it('invalidates search cursors across document replacement even when revisions repeat', () => {
  const { search, result } = setup();
  const first = data(search('people', { pageSize: 1 }));
  act(() => result.current.replace(fixture()));
  expect(
    search('people', {
      pageSize: 1,
      cursor: first.nextCursor,
      handle: { appInstanceId: 'app', sessionId: result.current.sessionId },
    }),
  ).toMatchObject({ ok: false, error: { code: 'STALE_CURSOR' } });
});
