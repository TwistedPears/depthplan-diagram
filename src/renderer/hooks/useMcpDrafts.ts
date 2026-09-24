import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { useDrafts } from './useDocumentDraft';
import type useDocumentState from './useDocumentState';
import { draftInput } from '../../shared/editorApiContract';
import {
  boundedResult,
  checkHandle,
  editorFailure,
  EditorError,
} from '../../shared/editorQueries';

export default function useMcpDrafts(
  owner: ReturnType<typeof useDocumentState>,
) {
  const drafts = useDrafts();
  const receipts = useRef(new Map<string, string>());
  return {
    hasActive: () =>
      [...(drafts?.values() ?? [])].some((entry) => entry.current.active()),
    list: () =>
      boundedResult(owner.snapshot(), {
        drafts: [...(drafts?.entries() ?? [])]
          .filter(([, entry]) => entry.current.active())
          .map(([id, entry]) => ({
            id,
            version: entry.version,
            label: entry.current.label,
            canApply: !!entry.current.apply,
          })),
      }),
    resolve: (input: unknown) => {
      const s = owner.snapshot();
      try {
        const args = draftInput.parse(input);
        checkHandle(s, args.handle);
        const key = `${s.sessionId}/${args.requestId}`,
          payload = JSON.stringify(args);
        const previous = receipts.current.get(key);
        if (previous && previous !== payload)
          throw new EditorError(
            'REQUEST_ID_REUSED',
            'Use a new requestId for another decision',
          );
        if (previous) return boundedResult(s, { replayed: true });
        if (
          args.expectedRevision !== s.revision ||
          args.expectedViewRevision !== s.viewRevision
        )
          throw new EditorError(
            'STALE_REVISION',
            'Refresh state before resolving a draft',
          );
        if (
          owner
            .busyReasons()
            .some((reason) =>
              [
                'closing',
                'transition',
                'canvas-gesture',
                'mcp-operation',
                'file-operation',
              ].includes(reason),
            )
        )
          throw new EditorError(
            'BUSY',
            'Finish the active gesture or operation first',
          );
        const entry = drafts?.get(args.id);
        if (!entry?.current.active() || entry.version !== args.draftVersion)
          throw new EditorError(
            'STALE_REVISION',
            'Draft changed; inspect current drafts before deciding',
          );
        if (args.action !== 'cancel') {
          const action =
            args.action === 'apply'
              ? entry.current.apply
              : entry.current.discard;
          if (!action)
            throw new EditorError(
              'INVALID_REQUEST',
              'This draft cannot be applied',
            );
          flushSync(action);
          if (drafts?.get(args.id)?.current.active())
            throw new EditorError(
              'INVALID_REQUEST',
              'Correct the draft validation errors before applying it',
            );
        }
        receipts.current.set(key, payload);
        if (receipts.current.size > 256)
          receipts.current.delete(receipts.current.keys().next().value!);
        return boundedResult(owner.snapshot(), {
          replayed: false,
          resolved: args.action !== 'cancel',
        });
      } catch (error) {
        return editorFailure(owner.snapshot(), error);
      }
    },
  };
}
