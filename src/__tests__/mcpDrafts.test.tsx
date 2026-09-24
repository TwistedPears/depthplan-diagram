import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import useDocumentDraft, {
  DocumentDrafts,
} from '../renderer/hooks/useDocumentDraft';
import useMcpDrafts from '../renderer/hooks/useMcpDrafts';
import { recursiveFixture } from './recursiveFixtures';
import { editObject } from '../shared/documentTransactions';

it('requires explicit current draft identity/version and invokes the same Apply callback once', () => {
  const { result } = renderHook(
    () => {
      const owner = useDocumentState(recursiveFixture(), 'app');
      const [value, setValue] = useState('');
      useDocumentDraft({
        label: 'name',
        active: () => !!value,
        apply: () => {
          owner.transact(editObject('app', { name: value }));
          setValue('');
        },
        discard: () => setValue(''),
      });
      return { owner, value, setValue, drafts: useMcpDrafts(owner) };
    },
    { wrapper: DocumentDrafts },
  );
  act(() => result.current.setValue('First'));
  const read = result.current.drafts.list();
  if (!read.ok) throw new Error('Draft read failed');
  const draft = read.data.drafts[0],
    s = result.current.owner.snapshot();
  const request = {
    handle: { appInstanceId: 'app', sessionId: s.sessionId },
    expectedRevision: s.revision,
    expectedViewRevision: s.viewRevision,
    requestId: 'resolve',
    id: draft.id,
    draftVersion: draft.version,
    action: 'apply',
  };
  act(() => result.current.setValue('Second'));
  expect(result.current.drafts.resolve(request)).toMatchObject({
    ok: false,
    error: { code: 'STALE_REVISION' },
  });
  const current = result.current.drafts.list();
  if (!current.ok) throw new Error('Draft read failed');
  const fresh = { ...request, draftVersion: current.data.drafts[0].version };
  act(() =>
    expect(result.current.drafts.resolve(fresh)).toMatchObject({ ok: true }),
  );
  expect(result.current.owner.document?.metadata.title).toBe('Fixture');
  expect(result.current.owner.revision).toBe(1);
  expect(result.current.value).toBe('');
  expect(result.current.drafts.resolve(fresh)).toMatchObject({
    ok: true,
    data: { replayed: true },
  });
  expect(result.current.owner.revision).toBe(1);
});
