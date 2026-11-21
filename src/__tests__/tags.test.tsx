import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import {
  createRecursiveDocument,
  validateRecursiveDocument,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
import type { ApiResult } from '../shared/depthApiContract';
import {
  editTagDefinition,
  legendEntries,
  legendContent,
  setEntityTags,
  tagPillLayout,
  tagStyledConnection,
} from '../shared/tags';
import { transactDocument } from '../shared/documentTransactions';
import {
  copySelection,
  pasteSelection,
  readSelection,
} from '../shared/recursiveClipboard';
import { duplicateSelection } from '../shared/recursiveDuplication';
import { createTemplate, insertTemplate } from '../shared/templates';
import { bundledTemplates } from '../shared/bundledTemplates';
import { searchObjects } from '../shared/objectSearch';
import { recursiveFixture } from './recursiveFixtures';
import SelectionProperties from '../renderer/components/SelectionProperties';

const confirm = { id: 'confirm', name: 'To confirm', color: '#d97706' };
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
  const ok = <T,>(result: ApiResult<T>) => {
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  };
  const call = (
    kind: Parameters<typeof hook.result.current.editorCommand>[0],
    args: Record<string, unknown>,
  ) => {
    let result!: ApiResult<any>;
    act(() => {
      result = hook.result.current.editorCommand(kind, request(args));
    });
    return ok(result);
  };
  const handle = () => request({}).handle;
  const queries = () => hook.result.current.editorQueries;
  const doc = () => hook.result.current.snapshot().document!;
  return { ...hook, call, ok, handle, queries, doc };
}
const objectIds = Array.from({ length: 12 }, (_, i) => `box-${i}`);
const connectionIds = Array.from({ length: 6 }, (_, i) => `wire-${i}`);
function tagMap() {
  const harness = setup();
  harness.call('edit', {
    actions: [
      {
        type: 'tag_definition',
        action: 'create',
        id: confirm.id,
        name: confirm.name,
        color: confirm.color,
        strokeStyle: 'dashed',
      },
      ...objectIds.map((id, i) => ({
        type: 'create_object',
        id,
        shape: 'rectangle',
        geometry: { x: i * 200, y: 0, width: 160, height: 80 },
        name: id,
      })),
      ...connectionIds.map((id, i) => ({
        type: 'create_connection',
        id,
        kind: 'line',
        start: { x: i * 200, y: 200 },
        end: { x: i * 200 + 100, y: 300 },
      })),
      {
        type: 'tags',
        tagIds: ['confirm'],
        objects: objectIds.slice(0, 10),
        connections: connectionIds.slice(0, 5),
      },
    ],
  });
  return harness;
}

it('tags 10 objects and 5 connections in one edit and queries exactly those 15', () => {
  const { call, ok, handle, queries, doc, result } = tagMap();
  expect(result.current.canUndo).toBe(true);
  const query = (collection: string, tag: string) =>
    ok(queries().query({ handle: handle(), collection, tag, pageSize: 200 }))
      .items as { id: string; value: { tags?: string[] } }[];
  const objects = query('objects', 'To confirm');
  const connections = query('connections', 'to CONFIRM');
  expect(objects.map((item) => item.id)).toEqual(objectIds.slice(0, 10).sort());
  expect(connections.map((item) => item.id)).toEqual(connectionIds.slice(0, 5));
  expect(objects[0].value.tags).toEqual(['confirm']);
  expect(query('objects', 'confirm')).toHaveLength(10);
  const search = ok(
    queries().search({
      handle: handle(),
      query: '',
      tag: 'To confirm',
      pageSize: 200,
    }),
  ).items as { id: string; tags: string[] }[];
  expect(search).toHaveLength(15);
  expect(search.every((item) => item.tags[0] === 'confirm')).toBe(true);
  expect(
    ok(
      queries().search({ handle: handle(), query: 'box-1', tag: 'confirm' }),
    ).items.map((item: { id: string }) => item.id),
  ).toEqual(['box-1']);
  expect(ok(queries().getState()).tagDefinitions).toEqual([
    { ...confirm, strokeStyle: 'dashed' },
  ]);
  expect(
    queries().query({ handle: handle(), collection: 'objects', tag: 'nope' }),
  ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

  // The legend lists the tag with its color and usage count.
  expect(legendEntries(doc()).tags).toEqual([
    { ...confirm, strokeStyle: 'dashed', count: 15 },
  ]);
  expect(JSON.stringify(legendContent(doc()))).toContain('To confirm');
  // Fills and lines are counted, not named by color code; swatches are outlined
  // so a white or pale fill stays visible on a white legend.
  const rows = legendContent(doc()).flatMap((block) =>
    block.type === 'paragraph' ? [block.runs] : [],
  );
  const swatches = rows.filter((runs) => runs[0].text === '■');
  expect(swatches.length).toBe(legendEntries(doc()).fills.length);
  expect(swatches.length).toBeGreaterThan(0);
  for (const runs of swatches) {
    expect(runs[0].marks).toMatchObject({ outline: '#64748b' });
    expect(runs[1].text).toMatch(/^ \d+ shapes?$/);
  }
  expect(rows.some((runs) => /^ \d+ connectors?$/.test(runs[1]?.text))).toBe(
    legendEntries(doc()).lines.length > 0,
  );
  expect(JSON.stringify(rows)).not.toMatch(/"text":"[^"]*#[0-9a-f]{3,6}/i);
  // The tag line style applies only where the connection sets none.
  const wire = doc().connections['wire-0'];
  expect(
    tagStyledConnection(wire, doc().tagDefinitions).style?.strokeStyle,
  ).toBe('dashed');
  expect(tagStyledConnection(wire, doc().tagDefinitions)).toBe(
    tagStyledConnection(wire, doc().tagDefinitions),
  );
  expect(
    tagStyledConnection(doc().connections['wire-5'], doc().tagDefinitions),
  ).toBe(doc().connections['wire-5']);

  // Deleting the definition strips every reference in the same undo step.
  const tagged = doc();
  call('edit', {
    actions: [{ type: 'tag_definition', action: 'delete', id: 'confirm' }],
  });
  expect(doc().tagDefinitions).toBeUndefined();
  expect(
    [...Object.values(doc().objects), ...Object.values(doc().connections)].some(
      (entity) => entity.tags,
    ),
  ).toBe(false);
  call('history', { direction: 'undo' });
  expect(doc()).toEqual(tagged);
  call('history', { direction: 'undo' });
  expect(doc().tagDefinitions).toBeUndefined();
  expect(Object.keys(doc().objects)).toHaveLength(0);
});

it('rejects duplicate names, unknown tags and missing targets atomically', () => {
  const { result, doc } = tagMap();
  const before = doc();
  for (const actions of [
    [
      {
        type: 'tag_definition',
        action: 'create',
        id: 'other',
        name: ' to confirm ',
        color: 'red',
      },
    ],
    [{ type: 'tags', tagIds: ['missing'], objects: ['box-0'] }],
    [{ type: 'tags', tagIds: ['confirm'], objects: ['nowhere'] }],
    [{ type: 'tag_definition', action: 'update', id: 'missing', name: 'x' }],
  ]) {
    let outcome!: ApiResult<unknown>;
    act(() => {
      const s = result.current.snapshot();
      outcome = result.current.editorCommand('edit', {
        handle: { appInstanceId: s.appInstanceId, sessionId: s.sessionId },
        expectedRevision: s.revision,
        expectedViewRevision: s.viewRevision,
        requestId: crypto.randomUUID(),
        actions,
      });
    });
    expect(outcome.ok).toBe(false);
    expect(doc()).toBe(before);
  }
});

it('validates tag shapes but ignores unknown tag IDs', () => {
  const document = recursiveFixture() as RecursiveDocument;
  document.tagDefinitions = { confirm };
  document.objects.app.tags = ['confirm', 'missing'];
  expect(() => validateRecursiveDocument(document)).not.toThrow();
  expect(legendEntries(document).tags).toEqual([{ ...confirm, count: 1 }]);
  for (const mutate of [
    (d: any) => (d.objects.app.tags = 'confirm'),
    (d: any) => (d.objects.app.tags = [3]),
    (d: any) => (d.tagDefinitions.confirm.name = ' '),
    (d: any) => (d.tagDefinitions.confirm.strokeStyle = 'wavy'),
    (d: any) => (d.tagDefinitions.confirm.id = 'other'),
  ]) {
    const copy = JSON.parse(JSON.stringify(document));
    mutate(copy);
    expect(() => validateRecursiveDocument(copy)).toThrow();
  }
});

function taggedFixture() {
  const result = transactDocument(recursiveFixture(), (draft) => {
    editTagDefinition('create', 'confirm', confirm)(draft);
    editTagDefinition('create', 'unused', { name: 'Unused', color: '#000' })(
      draft,
    );
    setEntityTags('add', ['confirm'], ['payments'], [])(draft);
  });
  if (result.status !== 'accepted') throw new Error('setup');
  return result.document;
}
it('carries tags through duplicate, copy/paste across documents and templates', () => {
  const source = taggedFixture();
  const duplicate = duplicateSelection(source, ['object-payments'], 24);
  const duplicated = transactDocument(source, duplicate.edit).document;
  const copyId = duplicate.selection[0].slice(7);
  expect(duplicated.objects[copyId].tags).toEqual(['confirm']);

  const clipboard = readSelection(copySelection(source, ['object-payments']))!;
  expect(Object.keys(clipboard.tagDefinitions!)).toEqual(['confirm']);
  // Another document: the definition is carried.
  const empty = createRecursiveDocument('other', 'Other');
  const pasted = transactDocument(
    empty,
    pasteSelection(clipboard, 24).edit,
  ).document;
  expect(pasted.tagDefinitions).toEqual({ confirm });
  expect(Object.values(pasted.objects)[0].tags).toEqual(['confirm']);
  // A same-named tag in the destination is reused instead of duplicated.
  const named = transactDocument(empty, (draft) =>
    editTagDefinition('create', 'mine', { name: 'TO CONFIRM', color: '#f00' })(
      draft,
    ),
  ).document;
  const merged = transactDocument(
    named,
    pasteSelection(clipboard, 24).edit,
  ).document;
  expect(Object.keys(merged.tagDefinitions!)).toEqual(['mine']);
  expect(Object.values(merged.objects)[0].tags).toEqual(['mine']);

  const template = createTemplate(source, {
    ...bundledTemplates[0].extensions.template,
    components: [],
  });
  const inserted = transactDocument(
    empty,
    insertTemplate(template, empty).edit,
  ).document;
  expect(inserted.tagDefinitions?.confirm).toEqual(confirm);
  expect(
    Object.values(inserted.objects).filter((o) => o.tags?.includes('confirm')),
  ).toHaveLength(1);
});

it('filters UI search by tag terms', () => {
  const document = taggedFixture();
  expect(searchObjects(document, 'tag:"To confirm"').map((r) => r.id)).toEqual([
    'payments',
  ]);
  expect(searchObjects(document, 'tag:unused')).toEqual([]);
  expect(searchObjects(document, 'tag:"to confirm" app')).toEqual([]);
  expect(searchObjects(document, 'tag:missing')).toEqual([]);
});

it('lays out pills in one row with a +N overflow pill', () => {
  const tags = ['Seen', 'Inferred', 'To confirm'].map((name) => ({
    id: name,
    name,
    color: '#123456',
  }));
  const measure = (text: string) => text.length * 6;
  expect(tagPillLayout(tags, 500, measure).map((p) => p.text)).toEqual([
    'Seen',
    'Inferred',
    'To confirm',
  ]);
  expect(tagPillLayout(tags, 100, measure).map((p) => p.text)).toEqual([
    'Seen',
    '+2',
  ]);
});

it('assigns, creates and deletes tags from the selection panel in undoable steps', () => {
  const document = taggedFixture();
  let state: ReturnType<typeof useDocumentState>;
  function Editor() {
    state = useDocumentState(document);
    return (
      <SelectionProperties
        document={state.document!}
        selection={['object-app']}
        textMode={false}
        onEdit={state.transact}
      />
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Add tag' }), {
    target: { value: 'confirm' },
  });
  expect(state!.document!.objects.app.tags).toEqual(['confirm']);
  expect(
    screen.getByRole('button', { name: 'Remove tag To confirm' }),
  ).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Add tag' }), {
    target: { value: '__new' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'New tag name' }), {
    target: { value: 'Planned' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  const planned = Object.values(state!.document!.tagDefinitions!).find(
    (tag) => tag.name === 'Planned',
  )!;
  expect(state!.document!.objects.app.tags).toEqual(['confirm', planned.id]);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show tag legend' }));
  expect(state!.document!.objects.app.style?.legend).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete tag To confirm' }),
  );
  expect(state!.document!.tagDefinitions!.confirm).toBeUndefined();
  expect(state!.document!.objects.payments.tags).toBeUndefined();
  expect(state!.document!.objects.app.tags).toEqual([planned.id]);
  act(() => state!.undo());
  expect(state!.document!.objects.payments.tags).toEqual(['confirm']);
});
