import { useEffect, useRef, useState } from 'react';

/** One workspace queue survives empty projects and active-board changes. */
export default function useDocumentOpenRequests(
  busy: boolean,
  open: (id: string) => Promise<unknown>,
  onError: (message: string) => void,
) {
  const [requests, setRequests] = useState<string[]>([]);
  const handling = useRef(false);
  useEffect(
    () =>
      window.desktop.fileSystem.onOpenRequested((id) => {
        setRequests((pending) =>
          pending.includes(id) ? pending : [...pending, id],
        );
      }),
    [],
  );
  useEffect(() => {
    const id = requests[0];
    if (busy || handling.current || !id) return;
    handling.current = true;
    void (async () => {
      try {
        await open(id);
      } catch (error) {
        onError(String(error));
      } finally {
        try {
          await window.desktop.fileSystem.releaseOpenRequest(id);
        } catch (error) {
          onError(`Could not release file open request: ${String(error)}`);
        }
        handling.current = false;
        setRequests((pending) => pending.filter((request) => request !== id));
      }
    })();
  });
}
