import useProjectWorkspace from '../hooks/useProjectWorkspace';

export default function ProjectDefinitionActions({
  message,
}: {
  message: string;
}) {
  const workspace = useProjectWorkspace()!;
  if (!/manifest changed/i.test(message)) return null;
  return (
    <div className="form-dialog-inline-actions">
      <button
        type="button"
        disabled={workspace.busy}
        onClick={() => {
          void workspace.resolveDefinition(false);
        }}
      >
        Reload project definition…
      </button>
      <button
        type="button"
        disabled={workspace.busy}
        onClick={() => {
          void workspace.resolveDefinition(true);
        }}
      >
        Overwrite project definition…
      </button>
    </div>
  );
}
