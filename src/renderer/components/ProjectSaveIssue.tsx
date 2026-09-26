import useDocumentSessions from '../hooks/useDocumentSessions';
import useProjectWorkspace from '../hooks/useProjectWorkspace';
import FormDialog from './FormDialog';
import ProjectDefinitionActions from './ProjectDefinitionActions';

export default function ProjectSaveIssue({ boardId }: { boardId: string }) {
  const workspace = useProjectWorkspace()!;
  const registry = useDocumentSessions();
  const project = workspace.project!;
  const controller = registry.controllers.get(workspace.key(boardId))!;
  const board = project.manifest.boards.find(
    (member) => member.id === boardId,
  )!;
  const save = (copy = false, overwrite = false) => {
    void workspace.run(async () => {
      const result = await controller.files.save(
        copy,
        overwrite
          ? {
              write: (document) =>
                window.desktop.projects.writeBoard(
                  project.sessionId,
                  boardId,
                  controller.owner.snapshot().source?.fingerprint ?? '',
                  document,
                  true,
                ),
            }
          : {},
      );
      if (result.status === 'success' && !copy) workspace.setDialog(null);
      return result.status === 'success';
    });
  };
  return (
    <FormDialog
      title={`Save ${board.name}`}
      description="Your accepted edits remain in this session. Autosave is paused until the source can be saved safely. Unapplied drafts are separate."
      onCancel={() => workspace.setDialog(null)}
      cancelLabel="Keep editing"
      cancelDisabled={workspace.busy}
    >
      <p>{controller.owner.source?.path}</p>
      <p role="alert">
        {controller.files.failure?.message ?? 'Save completed.'}
      </p>
      <ProjectDefinitionActions
        message={controller.files.failure?.message ?? ''}
      />
      {controller.hasDrafts && (
        <p>Draft not saved. Apply it in the board editor to include it.</p>
      )}
      <div className="form-dialog-inline-actions">
        <button type="button" disabled={workspace.busy} onClick={() => save()}>
          Retry Save
        </button>
        <button
          type="button"
          disabled={workspace.busy}
          onClick={() => save(true)}
        >
          Save a copy…
        </button>
        <button
          type="button"
          disabled={workspace.busy}
          onClick={() => {
            void workspace.run(async () => {
              const loaded = await controller.transitions.request('reload');
              if (loaded) workspace.setDialog(null);
              return loaded;
            });
          }}
        >
          Reload from disk…
        </button>
        <button
          type="button"
          disabled={workspace.busy}
          onClick={() => save(false, true)}
        >
          Overwrite source…
        </button>
      </div>
      {workspace.error && <p role="alert">{workspace.error}</p>}
    </FormDialog>
  );
}
