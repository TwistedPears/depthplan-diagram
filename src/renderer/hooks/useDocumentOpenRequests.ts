import { useEffect, useRef, useState } from 'react';
import type useDocumentTransitions from './useDocumentTransitions';

/** OS opens use the same draft/unsaved-work guards as the Open command. */
export default function useDocumentOpenRequests(
  transitions: ReturnType<typeof useDocumentTransitions>,
  busy: boolean,
  onStatus: (message: string) => void,
  enabled = true,
) {
  const [requests, setRequests] = useState<string[]>([]);
  const handling = useRef(false);
  useEffect(
    () =>
      enabled
        ? window.desktop.fileSystem.onOpenRequested((id) => {
            setRequests((pending) =>
              pending.includes(id) ? pending : [...pending, id],
            );
          })
        : undefined,
    [enabled],
  );
  useEffect(() => {
    const id = requests[0];
    if (!enabled || busy || handling.current || !id) return;
    handling.current = true;
    void (async () => {
      try {
        await transitions.request('open', undefined, {
          read: () => window.desktop.fileSystem.readOpenRequest(id),
        });
      } finally {
        try {
          await window.desktop.fileSystem.releaseOpenRequest(id);
        } catch (error) {
          onStatus(`Could not release file open request: ${String(error)}`);
        }
        handling.current = false;
        setRequests((pending) => pending.filter((request) => request !== id));
      }
    })();
  });
}
