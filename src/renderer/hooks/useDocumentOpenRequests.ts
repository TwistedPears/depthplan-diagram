import { useEffect, useRef, useState } from 'react';

/** One workspace queue survives empty projects and active-board changes. */
export default function useDocumentOpenRequests(
  busy: boolean,
  open: (id: string) => Promise<unknown>,
  onError: (message: string) => void,
) {
  const requests = useRef<string[]>([]);
  const handling = useRef<string | null>(null);
  const [, update] = useState(0);
  useEffect(
    () =>
      window.desktop.fileSystem.onOpenRequested((id) => {
        if (handling.current !== id && !requests.current.includes(id)) {
          requests.current.push(id);
          update((version) => version + 1);
        }
      }),
    [],
  );
  useEffect(() => {
    if (busy || handling.current) return;
    const id = requests.current.shift();
    if (!id) return;
    handling.current = id;
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
        handling.current = null;
        update((version) => version + 1);
      }
    })();
  });
}
