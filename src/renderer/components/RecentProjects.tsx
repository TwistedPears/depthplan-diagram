import { useState } from 'react';
import type { RecentProject } from '../../shared/projectContract';
import useProjectWorkspace from '../hooks/useProjectWorkspace';

export default function RecentProjects({ onAction }: { onAction: () => void }) {
  const workspace = useProjectWorkspace()!;
  const [entries, setEntries] = useState<RecentProject[]>([]);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    void window.desktop.projects
      .recents()
      .then((result) => {
        if (result.status === 'success') setEntries(result.entries);
        else if (result.status === 'error') setError(result.error);
      })
      .catch((e) => setError(String(e)));
  };
  return (
    <details
      className="recent-projects"
      onToggle={(event) => {
        if (event.currentTarget.open) load();
      }}
    >
      <summary>
        Recent Projects <span aria-hidden="true">›</span>
      </summary>
      <div className="recent-projects-menu" aria-label="Recent projects">
        {!entries.length && <p>No recent projects.</p>}
        {entries.slice(0, 5).map((entry) => (
          <button
            key={entry.key}
            type="button"
            disabled={workspace.busy}
            title={entry.location}
            aria-label={
              entry.available ? `Open ${entry.name}` : `Locate ${entry.name}…`
            }
            onClick={() => {
              onAction();
              void workspace.openProject(() =>
                window.desktop.projects.openRecent(entry.key, !entry.available),
              );
            }}
          >
            {entry.name}
            {!entry.available && ' (locate…)'}
            <small>{entry.location}</small>
          </button>
        ))}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
