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
}: FileToolbarProps) {
  return (
    <>
      <div className="dropdown-label">File</div>
      <button type="button" onClick={onNewDocument} disabled={isLoading}>
        <Icon name="file" /> New
      </button>
      <button type="button" onClick={onOpenFile} disabled={isLoading}>
        <Icon name="folder-open" /> Open
      </button>
      <button
        type="button"
        onClick={onReload}
        disabled={isLoading || !hasSource}
      >
        Reload
      </button>
      {hasDocument && (
        <>
          <button type="button" onClick={onSave} disabled={isLoading}>
            <Icon name="save" /> Save
          </button>
          <button type="button" onClick={onSaveAs} disabled={isLoading}>
            <Icon name="save" /> Save As...
          </button>
          <div className="dropdown-separator" />
        </>
      )}
    </>
  );
}
