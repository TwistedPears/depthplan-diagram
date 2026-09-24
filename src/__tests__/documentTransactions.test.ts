import { act, renderHook } from '@testing-library/react';
import { recursiveFixture } from './recursiveFixtures';
import {
  editActiveGeometry,
  editObject,
  transactDocument,
} from '../shared/documentTransactions';
import useDocumentState from '../renderer/hooks/useDocumentState';

it('shares content and changes only active geometry with one before/after', () => {
  const d = recursiveFixture();
  const old = JSON.stringify(d);
  const result = transactDocument(
    d,
    (draft) => {
      editObject('api', {
        name: 'Renamed',
        content: [
          { type: 'code', text: 'const x = 1;', language: 'javascript' },
        ],
      })(draft);
      editActiveGeometry('api', {
        x: 55,
        y: 66,
        z: 7,
        width: 180,
        height: 95,
        rotation: 45,
      })(draft);
    },
    'changed',
  );
  expect(result.status).toBe('accepted');
  if (result.status !== 'accepted') throw new Error('Expected accepted');
  expect(result.before).toBe(d);
  expect(result.document.objects.api.name).toBe('Renamed');
  expect(result.document.layouts.app['1'].api).toMatchObject({
    x: 55,
    z: 7,
    rotation: 45,
  });
  expect(result.document.layouts.app['2']).toEqual(d.layouts.app['2']);
  expect(result.document.layouts.app['2']).toBe(d.layouts.app['2']);
  expect(result.document.objects.app).toBe(d.objects.app);
  expect(result.document.objects.api.geometry).toBe(d.objects.api.geometry);
  expect(result.document.objects.api.geometry).toEqual(d.objects.api.geometry);
  expect(JSON.stringify(d)).toBe(old);
});

it('rejects partial deletion, missing references and invalid geometry atomically', () => {
  const d = recursiveFixture();
  for (const edit of [
    (draft: typeof d) => {
      delete draft.objects.api;
    },
    editActiveGeometry('api', { width: 0 }),
    editObject('missing', { name: 'No' }),
    (draft: typeof d) => {
      draft.id = 'other';
    },
  ]) {
    const result = transactDocument(d, edit);
    expect(result.status).toBe('rejected');
    expect(result.document).toBe(d);
  }
  const result = transactDocument(d, (draft) => {
    delete draft.objects.endpoint;
    for (const layout of Object.values(draft.layouts.app))
      delete layout.endpoint;
  });
  expect(result.status).toBe('accepted');
});

it('no-op retains identity and timestamp including metadata-only touches', () => {
  const d = recursiveFixture();
  expect(
    transactDocument(d, editObject('api', { name: d.objects.api.name })),
  ).toEqual({ status: 'noop', document: d });
  expect(
    transactDocument(d, (draft) => {
      draft.metadata.modified = 'unused';
    }).document,
  ).toBe(d);
});

it('queued commands use latest document; rejected/noop commands do not advance revisions', () => {
  const initial = recursiveFixture();
  const { result } = renderHook(() => {
    const state = useDocumentState(initial);
    if (!state.document) throw new Error('Expected recursive state');
    return { ...state, document: state.document };
  });
  act(() => {
    result.current.transact(editObject('app', { name: 'First' }));
    result.current.transact(editObject('api', { name: 'Second' }));
    result.current.transact(editActiveGeometry('api', { x: 250 }));
  });
  expect(result.current.revision).toBe(3);
  expect(result.current.document.objects.app.name).toBe('First');
  expect(result.current.document.objects.api.name).toBe('Second');
  expect(result.current.document.layouts.app['1'].api.x).toBe(250);
  const before = result.current.document;
  act(() => result.current.transact(editActiveGeometry('api', { width: -1 })));
  expect(result.current.result?.status).toBe('rejected');
  expect(result.current.document).toBe(before);
  expect(result.current.revision).toBe(3);
  act(() => result.current.transact(() => {}));
  expect(result.current.revision).toBe(3);
  const replacement = recursiveFixture();
  replacement.objects.app.name = 'Replacement with same ID';
  act(() => result.current.replace(replacement));
  expect(result.current.document).toBe(replacement);
  expect(result.current.revision).toBe(0);
});

it('detaches command payloads from the published snapshot', () => {
  const content = [
    { type: 'paragraph' as const, runs: [{ text: 'Original' }] },
  ];
  const result = transactDocument(
    recursiveFixture(),
    editObject('api', { content }),
  );
  content[0].runs[0].text = 'Mutated after dispatch';
  expect(result.document.objects.api.content).toEqual([
    { type: 'paragraph', runs: [{ text: 'Original' }] },
  ]);
});

it('shares unchanged history while revoking drafts and detaching new empty maps and arrays', () => {
  const original = recursiveFixture();
  let retained!: typeof original;
  const result = transactDocument(original, (draft) => {
    retained = draft;
    draft.objects.api.name = 'Accepted';
    draft.extensions = { empty: {}, list: [], nested: { values: [1, 2] } };
  });
  expect(result.status).toBe('accepted');
  expect(() => {
    retained.objects.api.name = 'Too late';
  }).toThrow();
  expect(result.document.objects.api.name).toBe('Accepted');
  expect(result.document.objects.app).toBe(original.objects.app);
  expect(result.document.extensions).toEqual({
    empty: {},
    list: [],
    nested: { values: [1, 2] },
  });
  const later = transactDocument(
    result.document,
    editActiveGeometry('api', { x: 99 }),
  );
  expect(later.document.objects).toBe(result.document.objects);
  expect(later.document.extensions).toBe(result.document.extensions);
  expect(result.document.layouts.app['1'].api.x).not.toBe(99);
});

it('treats nested JSON prototype-like keys as data, never as inherited snapshot branches', () => {
  const result = transactDocument(recursiveFixture(), (draft) => {
    draft.extensions = {
      nested: JSON.parse('{"__proto__":{},"constructor":[]}'),
    };
  });
  expect(result.status).toBe('accepted');
  const nested = result.document.extensions!.nested as Record<string, unknown>;
  expect(Object.hasOwn(nested, '__proto__')).toBe(true);
  expect(nested.__proto__).toEqual({});
  expect(nested.__proto__).not.toBe(Object.prototype);
  expect(nested.constructor).toEqual([]);
});

it('normalizes changed fields using their JSON property key and preserves deletion', () => {
  const original = recursiveFixture();
  const result = transactDocument(original, (draft) => {
    draft.extensions = {
      toJSON: (key: string) => ({ key, value: -0 }),
    } as any;
  });
  expect(result.status).toBe('accepted');
  expect(result.document.extensions).toEqual({ key: 'extensions', value: 0 });
  expect(result.document.objects).toBe(original.objects);
  const removed = transactDocument(result.document, (draft) => {
    delete draft.extensions;
  });
  expect(removed.status).toBe('accepted');
  expect(Object.hasOwn(removed.document, 'extensions')).toBe(false);
});
