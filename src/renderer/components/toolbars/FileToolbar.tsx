import Icon from '../Icon';

interface FileToolbarProps {
  isLoading: boolean;
  hasDocument: boolean;
  hasSource: boolean;
  onReload: () => void;
  onNewDocument: () => void;
  onOpenFile: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onClose: () => void;
  onAction?: () => void;
  isProject?: boolean;
}

export default function FileToolbar({
  isLoading,
  hasDocument,
  hasSource,
  onReload,
  onNewDocument,
  onOpenFile,
  onSave,
  onSaveAs,
  onClose,
  onAction = () => {},
  isProject = false,
}: FileToolbarProps) {
  const action = (handler: () => void) => () => {
    handler();
    onAction();
  };
  return (
    <>
      <div className="dropdown-label">Boards</div>
      <button
        type="button"
        onClick={action(onNewDocument)}
        disabled={isLoading}
      >
        <Icon name="file" /> {isProject ? 'New Board…' : 'New'}
      </button>
      <button type="button" onClick={action(onOpenFile)} disabled={isLoading}>
        <Icon name="folder-open" /> Open Board…
      </button>
      <button
        type="button"
        onClick={action(onReload)}
        disabled={isLoading || !hasSource}
      >
        Reload
      </button>
      {(hasDocument || isProject) && (
        <>
          <button type="button" onClick={action(onSave)} disabled={isLoading}>
            <Icon name="save" /> Save
          </button>
          <button type="button" onClick={action(onSaveAs)} disabled={isLoading}>
            <Icon name="save" /> Save As…
          </button>
          <button type="button" onClick={action(onClose)} disabled={isLoading}>
            Close
          </button>
        </>
      )}
    </>
  );
}
