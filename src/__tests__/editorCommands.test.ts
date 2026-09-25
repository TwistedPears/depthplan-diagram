import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { createRecursiveDocument } from '../shared/recursiveDocument';
import type { ApiResult } from '../shared/depthApiContract';
import { mcpTools } from '../shared/mcpRegistry';
import { editInput } from '../shared/editorApiContract';

function setup() {
  const hook = renderHook(() =>
    useDocumentState(createRecursiveDocument('test', 'Test'), 'app'),
  );
  let sequence = 0;
  const request = (extra: Record<string, unknown>) => {
    const s = hook.result.current.snapshot();
    return {
      handle: { appInstanceId: s.appInstanceId, sessionId: s.sessionId },
      expectedRevision: s.revision,
      expectedViewRevision: s.viewRevision,
      requestId: `request-${++sequence}`,
      ...extra,
    };
  };
  const call = (
    kind: Parameters<typeof hook.result.current.editorCommand>[0],
    args: Record<string, unknown>,
  ) => {
    let result!: ApiResult<any>;
    act(() => {
      result = hook.result.current.editorCommand(kind, args);
    });
    if (!result.ok) throw new Error(result.error.message);
    return result;
  };
  const doc = () => {
    const d = hook.result.current.snapshot().document;
    if (!d) throw new Error('No document');
    return d;
  };
  return { ...hook, request, call, doc };
}
const shape = (id: string, parentId: string | null = null) => ({
  type: 'create_object',
  id,
  shape: 'rectangle',
  parentId,
  geometry: { x: 300, y: 300, width: 120, height: 80, z: 3, rotation: 15 },
  name: id,
});
it('captures MCP camera focus in a batch and shares viewport-aware apply/reset with the UI', () => {
  const { result, request, call, doc } = setup();
  act(() =>
    result.current.setCanvas((canvas) => ({
      ...canvas,
      viewport: { width: 1024, height: 696 },
    })),
  );
  call(
    'edit',
    request({
      camera: { x: -5, y: -1464, scale: 0.43 },
      actions: [
        shape('root'),
        {
          type: 'bookmark',
          action: { type: 'create', id: 'view', name: 'View' },
        },
      ],
    }),
  );
  act(() =>
    result.current.setCanvas((canvas) => ({
      ...canvas,
      viewport: { width: 1483, height: 1106 },
    })),
  );
  call('bookmarks', request({ action: { type: 'apply', id: 'view' } }));
  expect(result.current.camera.x).toBeCloseTo(224.5);
  expect(result.current.camera.y).toBeCloseTo(-1259);
  expect(result.current.camera.scale).toBe(0.43);
  call(
    'edit',
    request({
      actions: [
        { type: 'bookmark', action: { type: 'apply', id: 'view' } },
        {
          type: 'bookmark',
          action: { type: 'create', id: 'copy', name: 'Copy' },
        },
      ],
    }),
  );
  expect(doc().namedViews!.copy.cameraFocus).toEqual(
    doc().namedViews!.view.cameraFocus,
  );
  call(
    'camera',
    request({ action: { type: 'set', camera: { x: 50, y: 100, scale: 2 } } }),
  );
  call('bookmarks', request({ action: { type: 'reset', id: 'view' } }));
  act(() => {
    result.current.setCanvas((canvas) => ({
      ...canvas,
      viewport: { width: 1024, height: 696 },
    }));
    result.current.changeNamedView({ type: 'apply', id: 'view' });
  });
  expect(result.current.camera).toEqual({ x: -179.5, y: -105, scale: 2 });
});

it('creates a hierarchy and two saved views atomically, then restores camera and geometry with Undo/Redo', () => {
  const { result, request, call, doc } = setup();
  call(
    'edit',
    request({
      camera: { x: 50, y: 70, scale: 0.5 },
      actions: [
        shape('root'),
        shape('child', 'root'),
        {
          type: 'bookmark',
          action: { type: 'create', id: 'overview', name: 'Overview' },
        },
      ],
    }),
  );
  expect(doc().namedViews?.overview.layouts?.root.child).toBeDefined();
  const overviewRoot = { ...doc().layouts.root[1].root };
  expect(overviewRoot.width).toBeGreaterThan(120);
  expect(result.current.past).toHaveLength(1);
  call(
    'edit',
    request({
      camera: { x: 120, y: -20, scale: 1.5 },
      actions: [
        { type: 'geometry', id: 'root', patch: { x: 700, width: 250 } },
        {
          type: 'bookmark',
          action: { type: 'create', id: 'detail', name: 'Children View' },
        },
      ],
    }),
  );
  expect(doc().layouts.root[1].root).toMatchObject({ z: 3, rotation: 15 });
  call('bookmarks', request({ action: { type: 'apply', id: 'overview' } }));
  expect(doc().layouts.root[1].root).toEqual(overviewRoot);
  expect(result.current.camera).toEqual({ x: 50, y: 70, scale: 0.5 });
  call('history', request({ direction: 'undo' }));
  expect(doc().layouts.root[1].root).toMatchObject({ x: 700, width: 250 });
  expect(result.current.camera.scale).toBe(1.5);
  call('history', request({ direction: 'redo' }));
  expect(result.current.camera.scale).toBe(0.5);
  const state = result.current.editorQueries.getState();
  expect(mcpTools.depthplan_get_state.output.safeParse(state).success).toBe(
    true,
  );
});
it('rolls back an invalid compound edit and retains an exact retry after Undo without recreating objects', () => {
  const { result, request, call, doc } = setup();
  const bad = request({
    camera: { x: 1, y: 2, scale: 2 },
    actions: [shape('one'), shape('one')],
  });
  act(() =>
    expect(result.current.editorCommand('edit', bad)).toMatchObject({
      ok: false,
    }),
  );
  expect(doc().objects).toEqual({});
  expect(result.current.snapshot()).toMatchObject({
    revision: 0,
    viewRevision: 0,
    canUndo: false,
  });
  const create = request({ actions: [shape('one')] });
  call('edit', create);
  call('history', request({ direction: 'undo' }));
  expect(call('edit', create).data.replayed).toBe(true);
  expect(doc().objects).toEqual({});
  act(() =>
    expect(
      result.current.editorCommand('edit', {
        ...create,
        actions: [shape('two')],
      }),
    ).toMatchObject({ ok: false, error: { code: 'REQUEST_ID_REUSED' } }),
  );
});
it('protects camera-dependent snapshots and active drafts without adding navigation to document history', () => {
  const { result, request, call } = setup();
  const stale = request({ actions: [shape('one')] });
  call(
    'camera',
    request({ action: { type: 'set', camera: { x: 22, y: 0, scale: 1 } } }),
  );
  expect(result.current.snapshot()).toMatchObject({
    revision: 0,
    viewRevision: 1,
    dirty: false,
    canUndo: false,
  });
  act(() =>
    expect(result.current.editorCommand('edit', stale)).toMatchObject({
      ok: false,
      error: { code: 'STALE_VIEW' },
    }),
  );
  result.current.setBusy('canvas-draft', true);
  const blocked = request({ actions: [shape('one')] });
  act(() =>
    expect(result.current.editorCommand('edit', blocked)).toMatchObject({
      ok: false,
      error: { code: 'BUSY' },
    }),
  );
  result.current.setBusy('canvas-draft', false);
  call('edit', blocked);
  call('selection', request({ action: 'set', objects: ['one'] }));
  expect(result.current.canvas.selected).toEqual(['object-one']);
  expect(result.current.revision).toBe(1);
});
it('keeps omitted patch fields omitted and rejects unknown actions and reserved IDs', () => {
  const { request } = setup();
  expect(
    editInput.parse(
      request({
        actions: [{ type: 'geometry', id: 'x', patch: { width: 3 } }],
      }),
    ).actions[0],
  ).toMatchObject({ patch: { width: 3 } });
  expect(
    editInput.safeParse(request({ actions: [shape('__proto__')] })).success,
  ).toBe(false);
  expect(
    editInput.safeParse(request({ actions: [{ type: 'evaluate', code: '1' }] }))
      .success,
  ).toBe(false);
});

it('retains MCP named-boundary and bridge repair commands alongside editor operations', () => {
  const { result, request, call, doc } = setup();
  call(
    'edit',
    request({
      actions: [
        shape('root'),
        shape('a', 'root'),
        shape('b', 'root'),
        {
          type: 'edit_object',
          id: 'a',
          name: 'Worker',
          style: { fill: '#abcdef', opacity: 0.5 },
          content: [
            {
              type: 'heading',
              level: 2,
              runs: [{ text: 'Service', marks: { bold: true } }],
            },
            {
              type: 'code',
              language: 'typescript',
              text: 'const ok = true;',
              wrap: true,
            },
          ],
        },
        { type: 'geometry', id: 'b', patch: { x: 120, y: 100 } },
        { type: 'arrange', ids: ['a', 'b'], action: 'align-left' },
        { type: 'arrange', ids: ['a', 'b'], action: 'make-same-width' },
        { type: 'move', ids: ['a', 'b'], delta: { x: 10, y: 20 } },
        {
          type: 'boundary',
          action: 'create',
          objectId: 'root',
          pointId: 'port',
          point: { side: 'left', offset: 0.5 },
        },
        {
          type: 'bridge',
          id: 'inside',
          kind: 'arrow',
          source: { objectId: 'root', pointId: 'port' },
          target: 'a',
          point: { x: 300, y: 300 },
        },
        {
          type: 'reattach_bridge',
          id: 'inside',
          target: 'b',
          point: { x: 420, y: 400 },
        },
        {
          type: 'edit_connection',
          id: 'inside',
          label: 'Retain this label',
          style: { stroke: '#ff0000', lineType: 'curved' },
        },
      ],
    }),
  );
  expect(doc().objects.a.content[1]).toMatchObject({
    type: 'code',
    language: 'typescript',
  });
  expect(doc().objects.a.style).toMatchObject({
    fill: '#abcdef',
    stroke: '#64748b',
  });
  call(
    'edit',
    request({
      actions: [
        {
          type: 'boundary',
          action: 'delete',
          objectId: 'root',
          pointId: 'port',
        },
      ],
    }),
  );
  expect(doc().connections.inside.start.kind).toBe('free');
  call(
    'edit',
    request({
      actions: [
        {
          type: 'create_connection',
          id: 'route',
          kind: 'arrow',
          start: { x: 300, y: 300 },
          end: { x: 400, y: 400 },
          startTarget: 'a',
          endTarget: 'b',
        },
        {
          type: 'edit_connection',
          id: 'route',
          label: 'Retain this label',
          style: { stroke: '#ff0000' },
        },
        { type: 'reparent', id: 'a', parentId: null },
      ],
    }),
  );
  expect(doc().connectionRepairs?.route).toBeUndefined();
  expect(doc().connections.route).toMatchObject({
    ownerId: null,
    end: { objectId: 'b' },
  });
  // Documents from older versions may still contain pending repairs.
  act(() =>
    result.current.transact((draft) => {
      draft.connectionRepairs = {
        route: {
          connection: draft.connections.route,
          ownerGeometry: null,
          start: { x: 300, y: 300 },
          end: { x: 400, y: 400 },
          reason: 'Legacy crossing',
        },
      };
      delete draft.connections.route;
    }),
  );
  call(
    'edit',
    request({
      actions: [
        {
          type: 'boundary',
          action: 'create',
          objectId: 'root',
          pointId: 'replacement',
          point: { side: 'left', offset: 0.3 },
        },
        {
          type: 'bridge',
          id: 'new-route',
          kind: 'arrow',
          source: { objectId: 'root', pointId: 'replacement' },
          target: 'b',
          point: { x: 400, y: 400 },
        },
        { type: 'repair', id: 'route', replacementId: 'new-route' },
      ],
    }),
  );
  expect(doc().connections.route).toMatchObject({
    label: 'Retain this label',
    style: { stroke: '#ff0000' },
    start: { pointId: 'replacement' },
  });
  expect(doc().connectionRepairs?.route).toBeUndefined();
  call(
    'edit',
    request({ actions: [{ type: 'reparent', id: 'a', parentId: null }] }),
  );
  expect(doc().objects.a.parentId).toBeNull();
  call('edit', request({ actions: [{ type: 'delete', objects: ['root'] }] }));
  expect(Object.keys(doc().objects)).toEqual(['a']);
});

it('assembles large rich content without partial publication and consumes it in one undoable edit', () => {
  const { result, request, call, doc } = setup();
  call('edit', request({ actions: [shape('one')] }));
  const value = [{ type: 'paragraph', runs: [{ text: '🦊'.repeat(30000) }] }];
  const text = JSON.stringify(value);
  call(
    'content',
    request({
      action: { type: 'begin', id: 'text', totalLength: text.length },
    }),
  );
  for (let offset = 0; offset < text.length; offset += 8192)
    call(
      'content',
      request({
        action: {
          type: 'append',
          id: 'text',
          offset,
          text: text.slice(offset, offset + 8192),
        },
      }),
    );
  expect(result.current.revision).toBe(1);
  expect(doc().objects.one.content).toEqual([]);
  const command = request({
    actions: [{ type: 'edit_object', id: 'one', contentTransfer: 'text' }],
  });
  call('edit', command);
  expect(doc().objects.one.content).toEqual(value);
  expect(call('edit', command).data).toMatchObject({
    replayed: true,
    changed: false,
  });
  call('history', request({ direction: 'undo' }));
  expect(doc().objects.one.content).toEqual([]);
});

it('rejects invalid styles and links without publishing any part of a batch', () => {
  const { result, request, doc } = setup();
  for (const patch of [
    { style: { opacity: 2 } },
    { style: { unknownProperty: true } },
    {
      content: [
        {
          type: 'paragraph',
          runs: [{ text: 'bad', marks: { link: 'javascript:alert(1)' } }],
        },
      ],
    },
  ]) {
    act(() =>
      expect(
        result.current.editorCommand(
          'edit',
          request({
            actions: [
              shape('one'),
              { type: 'edit_object', id: 'one', ...patch },
            ],
          }),
        ),
      ).toMatchObject({ ok: false }),
    );
    expect(doc().objects).toEqual({});
  }
});
