import { useCallback, useEffect, useState } from 'react';
import type useDocumentState from './useDocumentState';
import { RecoveryScheduler } from '../utils/recoveryScheduler';

export default function useRecovery(
  owner: ReturnType<typeof useDocumentState>,
) {
  const [status, setStatus] = useState('');
  const [scheduler] = useState(
    () => new RecoveryScheduler(window.desktop.recovery, setStatus),
  );
  useEffect(() => {
    if (owner.document && owner.dirty)
      scheduler.update({
        sessionId: owner.sessionId,
        revision: owner.revision,
        document: owner.document,
        sourceId: owner.source?.id,
      });
  }, [
    scheduler,
    owner.document,
    owner.dirty,
    owner.sessionId,
    owner.revision,
    owner.source,
  ]);
  useEffect(() => () => scheduler.dispose(), [scheduler]);
  const saved = useCallback(
    async (sessionId: string, revision: number) => {
      try {
        await scheduler.remove(sessionId, revision);
      } catch (error) {
        setStatus(
          `Saved, but recovery cleanup failed: ${String(error)}. Retry by saving again.`,
        );
      }
    },
    [scheduler],
  );
  // Undo back to a saved baseline makes that accepted revision unnecessary too.
  useEffect(() => {
    if (owner.document && !owner.dirty)
      void saved(owner.sessionId, owner.revision);
  }, [saved, owner.document, owner.dirty, owner.sessionId, owner.revision]);
  return {
    status,
    saved,
    leave: (sessionId: string) => scheduler.remove(sessionId),
  };
}
