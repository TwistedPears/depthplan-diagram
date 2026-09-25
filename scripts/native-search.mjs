import assert from 'node:assert/strict';

export async function searchProbe(probe) {
  const initial = await probe.call('depthplan_get_state');
  const command = (state, requestId) => ({
    handle: state.data.handle,
    expectedRevision: state.data.revision,
    expectedViewRevision: state.data.viewRevision,
    requestId,
  });
  const edited = await probe.call('depthplan_edit', {
    ...command(initial, 'search-fixture'),
    actions: [
      { type: 'edit_object', id: 'api', name: 'Billing::Person' },
      {
        type: 'edit_object',
        id: 'endpoint',
        name: 'Admin::Person',
        content: [
          {
            type: 'paragraph',
            runs: [{ text: 'Aliases: people crm_members' }],
          },
          {
            type: 'code',
            language: 'plaintext',
            text: 'engines/admin/app/models/person.rb\nAdmin::Person.find(id)',
          },
        ],
      },
      { type: 'depth', rootId: 'app', depth: 0 },
      {
        type: 'bookmark',
        action: { type: 'create', id: 'search-view', name: 'People overview' },
      },
      {
        type: 'create_connection',
        id: 'search-route',
        kind: 'line',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
      },
      { type: 'edit_connection', id: 'search-route', label: 'People route' },
    ],
  });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  const before = await probe.call('depthplan_get_state');
  const search = (query, filters = {}) =>
    probe.call('depthplan_search', {
      handle: before.data.handle,
      query,
      ...filters,
    });
  const page = await search('person', { collection: 'objects', pageSize: 1 });
  assert.equal(page.ok, true, JSON.stringify(page));
  assert.equal(page.data.items[0].id, 'api');
  assert.equal(page.data.hasMore, true);
  const next = await search('person', {
    collection: 'objects',
    pageSize: 1,
    cursor: page.data.nextCursor,
  });
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.deepEqual(next.data.items[0], {
    collection: 'objects',
    id: 'endpoint',
    label: 'Admin::Person',
    labelTruncated: false,
    snippet:
      'Aliases: people crm_members engines/admin/app/models/person.rb Admin::Person.find(id)',
    snippetTruncated: false,
    rootId: 'app',
    ancestorIds: ['app', 'api'],
    visible: false,
  });
  assert.equal(next.data.hasMore, false);
  const scoped = await search('CRM_MEMBERS person.rb', {
    rootId: 'app',
    subtreeId: 'api',
  });
  assert.deepEqual(
    scoped.data.items.map(({ id }) => id),
    ['endpoint'],
  );
  const mixed = await search('people');
  assert.deepEqual(
    mixed.data.items.map(({ collection }) => collection),
    ['objects', 'connections', 'bookmarks'],
  );
  assert.equal((await search('persons')).data.items.length, 0);
  assert.equal((await search('  ')).data.items.length, 0);
  assert.deepEqual(
    await probe.call('depthplan_get_state'),
    before,
    'Search must not alter live state',
  );
  const undone = await probe.call('depthplan_history', {
    ...command(before, 'search-undo'),
    direction: 'undo',
  });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal((await search('CRM_MEMBERS')).data.items.length, 0);
  assert.equal(
    (
      await search('person', {
        collection: 'objects',
        pageSize: 1,
        cursor: page.data.nextCursor,
      })
    ).error.code,
    'STALE_CURSOR',
  );
  console.log(
    'PASS native MCP search: discovery, namespaces/aliases/paths, hidden scope, typed results, pagination, immutable state and stale cursors.',
  );
}
