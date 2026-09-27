import type { ReactNode } from 'react';

interface FileToolbarProps {
  children: ReactNode;
  isLoading: boolean;
  hasDocument: boolean;
  onNewDocument: () => void;
  onOpenFile: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onClose: () => void;
  onAction?: () => void;
  isProject?: boolean;
}

export default function FileToolbar({
  children,
  isLoading,
  hasDocument,
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
        New Board
      </button>
      <button type="button" onClick={action(onOpenFile)} disabled={isLoading}>
        Open Board…
      </button>
      {children}
      <div className="dropdown-separator" />
      {(hasDocument || isProject) && (
        <>
          <button type="button" onClick={action(onSave)} disabled={isLoading}>
            Save
          </button>
          <button type="button" onClick={action(onSaveAs)} disabled={isLoading}>
            Save As…
          </button>
          <button type="button" onClick={action(onClose)} disabled={isLoading}>
            {isProject ? 'Close Project' : 'Close Board'}
          </button>
        </>
      )}
    </>
  );
}
