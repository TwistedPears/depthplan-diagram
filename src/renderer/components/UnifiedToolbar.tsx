import { createPortal } from 'react-dom';
import SettingsMenu from './SettingsMenu';
import type useAutomation from '../hooks/useAutomation';
import Icon from './Icon';
import InlineEdit from './InlineEdit';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecursiveDocument } from '../../shared/recursiveDocument';

import './UnifiedToolbar.css';
import FileToolbar from './toolbars/FileToolbar';
import useProjectWorkspace from '../hooks/useProjectWorkspace';
import { ProjectMenu } from './ProjectNavigation';
import RecentProjects from './RecentProjects';
interface UnifiedToolbarProps {
  automation: ReturnType<typeof useAutomation>;
  operation: { kind: string; status: string; cancel: () => void } | null;
  blocked: boolean;
  currentDocument: RecursiveDocument | null;
  isLoading: boolean;
  filename?: string;
  unsaved?: boolean;
  onRenameDocument?: (name: string) => Promise<boolean>;
  onRenameFile?: (name: string) => Promise<boolean>;
  onNewDocument: () => void;
  onOpenFile: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportSVG: () => void;
}

function UnifiedToolbar({
  automation,
  operation,
  blocked,
  currentDocument,
  isLoading,
  filename,
  unsaved = false,
  onRenameDocument,
  onRenameFile,
  onNewDocument,
  onOpenFile,
  onSave,
  onSaveAs,
  onExportSVG,
}: UnifiedToolbarProps) {
  const workspace = useProjectWorkspace();
  const project = workspace?.project;
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [editing, setEditing] = useState('');
  const editor = (field: string) => ({
    editing: editing === field,
    onEditing: (on: boolean) => setEditing(on ? field : ''),
  });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(event.target as Node)
      ) {
        setOpenDropdown(null);
      }
    };

    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        toolbarRef.current?.querySelector('.dropdown-menu:not([hidden])') &&
        !document.querySelector('dialog[open]')
      ) {
        setOpenDropdown(null);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  const toggleDropdown = useCallback(
    (dropdownId: string) => {
      setOpenDropdown(openDropdown === dropdownId ? null : dropdownId);
    },
    [openDropdown],
  );

  const closeDropdown = useCallback(() => {
    setOpenDropdown(null);
    menuButton.current?.focus();
  }, []);

  // Keep MCP access available while document operations make the canvas inert.
  return createPortal(
    <div ref={toolbarRef} className="unified-toolbar">
      {/* Hamburger: consolidates File, Depth, Zoom, Views */}
      <div className="toolbar-section document-switcher">
        <button
          type="button"
          className={`toolbar-button ${openDropdown === 'hamburger' ? 'active' : ''}`}
          onClick={() => toggleDropdown('hamburger')}
          ref={menuButton}
          title="Menu"
          aria-label="Menu"
          aria-expanded={openDropdown === 'hamburger'}
          aria-controls="document-menu"
        >
          <Icon name="bars" />
        </button>

        <div className="document-caption">
          <InlineEdit
            {...editor('name')}
            className="document-name"
            label="Board name"
            value={currentDocument?.metadata.title ?? 'Untitled Board'}
            disabled={isLoading || !onRenameDocument}
            unsaved={unsaved}
            onSave={onRenameDocument ?? (async () => false)}
          />
          <InlineEdit
            {...editor('filename')}
            className="document-state"
            label="Board filename"
            value={filename ?? 'Not saved yet'}
            disabled={isLoading || !onRenameFile}
            onSave={onRenameFile ?? (async () => false)}
          />
        </div>
        <div
          className="dropdown-menu"
          id="document-menu"
          hidden={openDropdown !== 'hamburger'}
        >
          <div inert={blocked}>
            <RecentProjects
              active={openDropdown === 'hamburger'}
              onAction={closeDropdown}
            />
            <div className="dropdown-separator" />
            <FileToolbar
              isLoading={isLoading}
              hasDocument={!!currentDocument}
              onNewDocument={onNewDocument}
              onOpenFile={onOpenFile}
              onSave={onSave}
              isProject={!!project}
              onSaveAs={onSaveAs}
              onClose={() => {
                void workspace?.standalone();
              }}
              onAction={closeDropdown}
            >
              {openDropdown === 'hamburger' && (
                <ProjectMenu onAction={closeDropdown} />
              )}
            </FileToolbar>
            <div className="dropdown-separator" />
            {currentDocument && (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  onExportSVG();
                  closeDropdown();
                }}
              >
                Export
              </button>
            )}
          </div>
          <SettingsMenu
            active={openDropdown === 'hamburger'}
            automation={automation}
            operation={operation}
            onAction={closeDropdown}
          />
        </div>
      </div>

      <div className="document-actions" inert={blocked}>
        <button
          type="button"
          className="quick-save"
          aria-label="Save document"
          title="Save document"
          disabled={isLoading || !currentDocument}
          onClick={onSave}
        >
          <Icon name="save" />
        </button>
        <button
          type="button"
          className="primary-button"
          aria-label="Export current diagram"
          disabled={isLoading || !currentDocument}
          onClick={onExportSVG}
        >
          <Icon name="file-export" />
          Export
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default UnifiedToolbar;
