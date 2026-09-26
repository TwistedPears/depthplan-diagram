import { useLayoutEffect, useRef, useState } from 'react';
import { projectNameSchema } from '../../shared/projectContract';
import useProjectWorkspace from '../hooks/useProjectWorkspace';
import FormDialog from './FormDialog';

export default function ProjectSettings() {
  const workspace = useProjectWorkspace()!;
  const { manifest, location, sessionId } = workspace.project!;
  const [settings, setSettings] = useState({
    name: manifest.name,
    description: manifest.description,
    homeBoardId: manifest.homeBoardId,
    autosave: manifest.autosave,
  });
  const [submitted, setSubmitted] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const error = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (workspace.error) error.current?.scrollIntoView({ block: 'nearest' });
  }, [workspace.error]);
  const valid = projectNameSchema.safeParse(settings.name.trim()).success;
  return (
    <FormDialog
      title="Project Settings"
      description="These settings travel with the project. Your open tabs and board views stay on this computer."
      initialFocus={input}
      submitLabel={workspace.busy ? 'Applying…' : 'Apply'}
      submitDisabled={workspace.busy}
      cancelDisabled={workspace.busy}
      onCancel={() => {
        workspace.setDialog(null);
        workspace.setError('');
      }}
      onSubmit={() => {
        setSubmitted(true);
        if (!valid) return;
        void workspace.run(async () => {
          const saved = await workspace.apply({
            kind: 'settings',
            ...settings,
            name: settings.name.trim(),
          });
          if (saved) workspace.setDialog(null);
          return !!saved;
        });
      }}
    >
      <label className="form-dialog-field">
        Project name
        <input
          ref={input}
          value={settings.name}
          maxLength={120}
          aria-invalid={submitted && !valid}
          aria-describedby="settings-name-help"
          onChange={(e) => setSettings({ ...settings, name: e.target.value })}
        />
      </label>
      <p
        id="settings-name-help"
        className={submitted && !valid ? 'project-error' : 'field-hint'}
      >
        {submitted && !valid
          ? 'Enter a name without path separators, control characters or a trailing period.'
          : 'Changing the name keeps the folder and filename unchanged.'}
      </p>
      <label className="form-dialog-field">
        Description
        <textarea
          rows={3}
          maxLength={4000}
          value={settings.description}
          onChange={(e) =>
            setSettings({ ...settings, description: e.target.value })
          }
        />
      </label>
      <label className="form-dialog-field">
        Home board
        <select
          value={settings.homeBoardId ?? ''}
          onChange={(e) =>
            setSettings({ ...settings, homeBoardId: e.target.value || null })
          }
        >
          <option value="">First available board</option>
          {manifest.boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name} — {board.path}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">
        If the home board is unavailable, the first readable board opens.
      </p>
      <label>
        <input
          type="checkbox"
          checked={settings.autosave}
          onChange={(e) =>
            setSettings({ ...settings, autosave: e.target.checked })
          }
        />
        Automatically save accepted board changes
      </label>
      <p className="field-hint">
        Unapplied editor drafts remain separate from saved board content.{' '}
        Autosave replaces the current file; it does not keep backups or version
        history.
      </p>
      <label className="form-dialog-field">
        Project location
        <input readOnly value={location} />
      </label>
      <button
        type="button"
        disabled={workspace.busy}
        onClick={() => {
          void workspace.run(() => window.desktop.projects.reveal(sessionId));
        }}
      >
        Reveal in File Manager
      </button>
      {workspace.error && (
        <p ref={error} role="alert" className="project-error">
          {workspace.error}
        </p>
      )}
    </FormDialog>
  );
}
