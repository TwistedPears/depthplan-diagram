import { useState } from 'react';
import useDocumentSessions, {
  type CloseReview,
} from '../hooks/useDocumentSessions';
import FormDialog from './FormDialog';

/** No sessions are disposed until all rows have completed their explicit guards. */
export default function ProjectCloseReview({
  request,
}: {
  request: CloseReview;
}) {
  const registry = useDocumentSessions();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<string[]>([]);
  const [error, setError] = useState('');
  const review = async (keys: string[], saveOnly: boolean) => {
    setBusy(true);
    setError('');
    const completed = [...ready];
    try {
      for (const key of keys) {
        if (completed.includes(key)) continue;
        registry.showForClose(key);
        const controller = registry.controllers.get(key)!;
        await controller.files.wait();
        if (
          !(await controller.transitions.request(
            saveOnly ? 'prepare-copy' : 'prepare-close',
          ))
        )
          continue;
        if (
          saveOnly &&
          controller.owner.snapshot().dirty &&
          (await controller.files.save()).status !== 'success'
        ) {
          controller.transitions.release();
          continue;
        }
        completed.push(key);
      }
      setReady(completed);
      if (request.keys.every((key) => completed.includes(key)))
        request.finish(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      title="Review open boards"
      description="Resolve each board before continuing. Keep open preserves every session. Drafts must be applied or explicitly discarded before accepted changes are saved."
      cancelLabel="Keep open"
      cancelDisabled={busy}
      onCancel={() => request.finish(false)}
      submitLabel={busy ? 'Working…' : 'Save all and continue'}
      submitDisabled={busy}
      onSubmit={() => {
        void review(request.keys, true);
      }}
    >
      {request.keys.map((key) => {
        const controller = registry.controllers.get(key)!;
        const snapshot = controller.owner.snapshot();
        const name = snapshot.document?.metadata.title ?? 'Untitled board';
        return (
          <section key={key} className="form-dialog-section" aria-label={name}>
            <h3>{name}</h3>
            <p>
              {ready.includes(key)
                ? 'Ready to close — review completed'
                : (registry.statuses[key] ??
                  (snapshot.dirty ? 'Unsaved' : 'Saved'))}
            </p>
            {controller.files.failure && (
              <p role="alert">{controller.files.failure.message}</p>
            )}
            {controller.hasDrafts && (
              <p>Unapplied draft is not saved or recoverable.</p>
            )}
            {!ready.includes(key) && (
              <div className="form-dialog-inline-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void review([key], false);
                  }}
                >
                  Review {name}…
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void review([key], true);
                  }}
                >
                  Retry save for {name}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void controller.files
                      .save(true)
                      .finally(() => setBusy(false));
                  }}
                >
                  Save a copy of {name}…
                </button>
              </div>
            )}
          </section>
        );
      })}
      {error && <p role="alert">{error}</p>}
    </FormDialog>
  );
}
