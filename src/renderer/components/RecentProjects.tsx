import { useEffect, useState } from 'react';
import type { RecentProject } from '../../shared/projectContract';
import useProjectWorkspace from '../hooks/useProjectWorkspace';
import FormDialog from './FormDialog';

export default function RecentProjects() {
  const workspace = useProjectWorkspace()!;
  const [entries, setEntries] = useState<RecentProject[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void window.desktop.projects
      .recents()
      .then((result) => {
        if (result.status === 'success') setEntries(result.entries);
        else if (result.status === 'error') setError(result.error);
      })
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <FormDialog
      title="Recent Projects"
      description="Tabs and camera positions are saved on this computer. Undo history starts fresh when a board reopens."
      onCancel={() => workspace.setDialog(null)}
      cancelDisabled={workspace.busy}
    >
      {!entries.length && <p>No recent projects on this computer.</p>}
      {entries.map((entry) => (
        <section
          className="form-dialog-section"
          key={entry.key}
          aria-label={entry.name}
        >
          <h3>{entry.name}</h3>
          <p>{entry.location}</p>
          {!entry.available && (
            <p>
              Project unavailable. Locate its new location, or remove this
              recent entry.
            </p>
          )}
          <div className="form-dialog-inline-actions">
            <button
              type="button"
              disabled={workspace.busy}
              onClick={() => {
                void workspace
                  .openProject(() =>
                    window.desktop.projects.openRecent(
                      entry.key,
                      !entry.available,
                    ),
                  )
                  .then((opened) => {
                    if (opened) workspace.setDialog(null);
                  });
              }}
            >
              {entry.available ? `Open ${entry.name}` : `Locate ${entry.name}…`}
            </button>
            <button
              type="button"
              disabled={workspace.busy}
              onClick={() => {
                void window.desktop.projects
                  .forget(entry.key)
                  .then((result) => {
                    if (result.status === 'success')
                      setEntries((all) =>
                        all.filter((item) => item.key !== entry.key),
                      );
                    else if (result.status === 'error') setError(result.error);
                  })
                  .catch((e) => setError(String(e)));
              }}
            >
              Remove {entry.name} from Recents
            </button>
          </div>
        </section>
      ))}
      {(error || workspace.error) && (
        <p role="alert">{error || workspace.error}</p>
      )}
    </FormDialog>
  );
}
