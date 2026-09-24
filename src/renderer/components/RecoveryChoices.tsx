import { flushSync } from 'react-dom';
import useDocumentDraft from '../hooks/useDocumentDraft';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RecoveryCandidate,
  RecoveryEntry,
} from '../../shared/recoveryContract';
export default function RecoveryChoices({
  onRestore,
  refresh = 0,
}: {
  refresh?: number;
  onRestore: (candidate: RecoveryCandidate) => Promise<boolean>;
}) {
  const [entries, setEntries] = useState<RecoveryEntry[]>([]),
    [warnings, setWarnings] = useState<string[]>([]);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  useDocumentDraft({
    label: 'recovery choices',
    active: () => open,
    discard: () => setOpen(false),
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const discover = useCallback(
    async (show = true) => {
      try {
        const result = await window.desktop.recovery.discover();
        setEntries(result.entries);
        setWarnings((previous) => [
          ...new Set([...previous, ...result.warnings]),
        ]);
        if (
          show ||
          (refresh === 0 && (result.entries.length || result.warnings.length))
        )
          setOpen(true);
      } catch (error) {
        setWarnings([
          `Could not inspect recovery files: ${String(error)}. Reopen Recovery to retry.`,
        ]);
        setOpen(true);
      }
    },
    [refresh],
  );
  useEffect(() => {
    setOpen(false);
    void discover(false);
  }, [discover]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const choose = async (entry: RecoveryEntry, restore: boolean) => {
    setBusy(true);
    let prepared = false;
    try {
      if (restore) {
        const candidate = await window.desktop.recovery.prepare(entry.id);
        prepared = true;
        flushSync(() => setOpen(false));
        if (!(await onRestore(candidate))) {
          await window.desktop.recovery.release(entry.id);
          prepared = false;
          setOpen(true);
          return;
        }
      } else await window.desktop.recovery.discard(entry.id);
      setEntries((previous) => previous.filter((item) => item.id !== entry.id));
      if (entries.length === 1) setOpen(false);
    } catch (error) {
      if (prepared)
        await window.desktop.recovery.release(entry.id).catch(() => {});
      setWarnings((previous) => [...previous, String(error)]);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        hidden={entries.length === 0}
        onClick={() => {
          void discover();
        }}
        className="recovery-control"
      >
        Recovery ({entries.length})
      </button>
      <dialog
        ref={dialog}
        aria-label="Recover unsaved work"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setOpen(false);
        }}
        style={{ maxWidth: 660, maxHeight: '80vh' }}
      >
        <h2>Recover unsaved work</h2>
        <p>
          Restore opens a new unsaved document. Discard permanently removes only
          the selected recovery entry.
        </p>
        {warnings.map((message) => (
          <p role="status" key={message}>
            {message}
          </p>
        ))}
        {!entries.length && <p>No recoverable work found.</p>}
        {entries.map((entry) => (
          <section
            key={entry.id}
            aria-label={entry.title}
            style={{ borderTop: '1px solid #ccc', padding: '12px 0' }}
          >
            <h3>{entry.title}</h3>
            <p>
              {entry.sourcePath ?? 'Never saved to a file'}
              <br />
              {new Date(entry.capturedAt).toLocaleString()} · revision{' '}
              {entry.revision}
            </p>
            <small>
              Session {entry.sessionId} · App {entry.instanceId}
            </small>
            <div>
              <button
                disabled={busy}
                onClick={() => {
                  void choose(entry, true);
                }}
              >
                Restore
              </button>{' '}
              <button
                disabled={busy}
                onClick={() => {
                  void choose(entry, false);
                }}
              >
                Discard
              </button>
            </div>
          </section>
        ))}
        <button disabled={busy} onClick={() => setOpen(false)}>
          Continue without restoring
        </button>
      </dialog>
    </>
  );
}
