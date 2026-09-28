import { useEffect, useRef } from 'react';
import type useDocumentState from './useDocumentState';
import type useDocumentFiles from './useDocumentFiles';

/** Each mounted board owner schedules its own accepted content, including inactive boards. */
export default function useProjectAutosave(
  owner: ReturnType<typeof useDocumentState>,
  files: ReturnType<typeof useDocumentFiles>,
  enabled: boolean,
) {
  const latest = useRef({ owner, files });
  latest.current = { owner, files };
  const pendingSince = useRef<number | null>(null);
  useEffect(() => {
    pendingSince.current = null;
  }, [owner.sessionId, files.savedAt, enabled]);
  useEffect(() => {
    if (!owner.dirty) pendingSince.current = null;
    if (!enabled || !owner.dirty || files.loading || files.failure) return;
    pendingSince.current ??= Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const save = () => {
      const current = latest.current;
      if (current.files.failure || !current.owner.snapshot().dirty) return;
      if (
        current.owner
          .busyReasons()
          .some((reason) =>
            [
              'transition',
              'closing',
              'mcp-operation',
              'file-operation',
              'canvas-gesture',
              'connection-gesture',
            ].includes(reason),
          )
      ) {
        timer = setTimeout(save, 100);
        return;
      }
      void current.files.save(false, { background: true });
    };
    timer = setTimeout(
      save,
      Math.max(0, Math.min(1000, pendingSince.current + 5000 - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [
    enabled,
    owner.dirty,
    owner.revision,
    owner.sessionId,
    files.loading,
    files.failure,
    files.savedAt,
  ]);
}
