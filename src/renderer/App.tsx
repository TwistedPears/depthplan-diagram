import useMcpWorkflows from './hooks/useMcpWorkflows';
import type { RecursiveExportHandle } from './components/RecursiveExport';
import {
  editorStamp,
  editorFailure,
  EditorError,
} from '../shared/editorQueries';
import useMcpDrafts from './hooks/useMcpDrafts';
import Icon from './components/Icon';
import RecoveryChoices from './components/RecoveryChoices';
import useRecovery from './hooks/useRecovery';
import { useCallback, useEffect, useRef, useState } from 'react';
import useDocumentHistoryActions from './hooks/useDocumentHistoryActions';
import useDocumentState from './hooks/useDocumentState';
import useDocumentFiles from './hooks/useDocumentFiles';
import useDocumentTransitions from './hooks/useDocumentTransitions';
import useDocumentOpenRequests from './hooks/useDocumentOpenRequests';
import { DocumentDrafts } from './hooks/useDocumentDraft';
import RecursiveCanvas from './components/RecursiveCanvas';
import NamedViews from './components/NamedViews';
import useAutomation from './hooks/useAutomation';
import './App.css';
import { createRecursiveDocument } from '../shared/recursiveDocument';
import UnifiedToolbar from './components/UnifiedToolbar';
import exportAsJSON from './utils/jsonExport';

export default function App() {
  return (
    <DocumentDrafts>
      <Workspace />
    </DocumentDrafts>
  );
}
function Workspace() {
  const [appInstanceId, setAppInstanceId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    window.desktop
      .getAppInstanceId()
      .then((id) => {
        if (active) setAppInstanceId(id);
      })
      .catch((error) =>
        console.error('Application identity unavailable', error),
      );
    return () => {
      active = false;
    };
  }, []);
  // Main application state
  const [initialDocument] = useState(() =>
    createRecursiveDocument(crypto.randomUUID(), 'Untitled Document'),
  );
  const owner = useDocumentState(initialDocument, appInstanceId);
  const recovery = useRecovery(owner);
  const {
    document: currentDocument,
    sessionId,
    undo,
    redo,
    canUndo,
    canRedo,
    dirty,
    transact,
    selectDepth,
    getContext,
    getHierarchy,
    setDepth,
    revealAll,
    setBusy,
    isBusy,
    changeNamedView,
    camera,
    setCamera,
    result: transactionResult,
  } = owner;
  const currentFilePath = owner.source?.path;
  const [exportLoading, setLoading] = useState(false);
  const setIsLoading = useCallback(
    (loading: boolean) => {
      setBusy('document-transition', loading);
      setLoading(loading);
    },
    [setBusy],
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const recursiveExport = useRef<RecursiveExportHandle>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(statusTimer.current), []);
  const showStatus = useCallback((message: string) => {
    setStatusMessage(message);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatusMessage(''), 3000);
  }, []);

  const mcpDrafts = useMcpDrafts(owner);
  const guardedMcp = <T,>(action: () => T) =>
    mcpDrafts.hasActive()
      ? editorFailure(
          owner.snapshot(),
          new EditorError(
            'BUSY',
            'Finish or explicitly resolve the active UI draft',
          ),
        )
      : action();
  const editorCommand = (
    kind: Parameters<typeof owner.editorCommand>[0],
    input: unknown,
  ) => guardedMcp(() => owner.editorCommand(kind, input));
  const files = useDocumentFiles(owner, showStatus, recovery);
  const transitions = useDocumentTransitions(
    owner,
    files,
    showStatus,
    recovery.leave,
  );
  const mcpWorkflows = useMcpWorkflows({
    owner,
    files,
    transitions,
    exportRef: recursiveExport,
    hasDrafts: mcpDrafts.hasActive,
    onStatus: showStatus,
  });
  useDocumentHistoryActions(
    !!currentDocument,
    () => {
      if (!transitions.isPending() && !mcpWorkflows.activeOperation) undo();
    },
    () => {
      if (!transitions.isPending() && !mcpWorkflows.activeOperation) redo();
    },
  );
  const isLoading =
    exportLoading ||
    files.loading ||
    transitions.active ||
    !!mcpWorkflows.activeOperation;
  useDocumentOpenRequests(transitions, isLoading, showStatus);
  const handleNewDocument = () => {
    if (!isLoading) return transitions.request('new');
  };
  const handleOpenFile = () => {
    if (!isLoading) return transitions.request('open');
  };
  const handleReloadFile = () => {
    if (!isLoading) return transitions.request('reload');
  };
  const handleSave = (saveAs = false) => {
    if (!isLoading) return files.save(saveAs);
  };

  const handleExportSVG = () => {
    if (!isLoading && currentDocument) recursiveExport.current?.();
  };

  const handleExportJSON = async () => {
    if (isLoading) return;
    if (!currentDocument) return;

    setIsLoading(true);
    try {
      const result = await exportAsJSON(currentDocument);
      if (result) {
        showStatus(`Exported: ${result.split(/[\\/]/).pop()}`);
      }
    } catch (error) {
      console.error('Failed to export JSON:', error);
      showStatus('Failed to export JSON');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveAs = () => handleSave(true);

  useEffect(() =>
    window.desktop.transitions.onRequest((id) => {
      void transitions.request('close').then(async (approved) => {
        try {
          await window.desktop.transitions.reply(id, approved);
        } catch {
          transitions.release();
          showStatus('Could not complete the close request. Please try again.');
        }
      });
    }),
  );

  // Handle menu events
  useEffect(() => {
    const removeNewListener = window.desktop.events.on(
      'menu:new',
      handleNewDocument,
    );
    const removeOpenListener = window.desktop.events.on(
      'menu:open',
      handleOpenFile,
    );
    const removeReloadListener = window.desktop.events.on(
      'menu:reload-document',
      handleReloadFile,
    );
    const removeSaveListener = window.desktop.events.on(
      'menu:save',
      handleSave,
    );
    const removeSaveAsListener = window.desktop.events.on(
      'menu:save-as',
      handleSaveAs,
    );
    const removeExportSVGListener = window.desktop.events.on(
      'menu:export-svg',
      handleExportSVG,
    );
    const removeExportJSONListener = window.desktop.events.on(
      'menu:export-json',
      handleExportJSON,
    );

    return () => {
      removeNewListener();
      removeOpenListener();
      removeReloadListener();
      removeSaveListener();
      removeSaveAsListener();
      removeExportSVGListener();
      removeExportJSONListener();
    };
  }); // Rebind with current document and loading state.

  const automation = useAutomation({
    depthplan_get_access: mcpWorkflows.access,
    depthplan_files: (input) => mcpWorkflows.start('files', input),
    depthplan_export: (input) => mcpWorkflows.start('export', input),
    depthplan_get_operation: mcpWorkflows.read,
    depthplan_cancel_operation: mcpWorkflows.cancel,
    depthplan_decide: mcpWorkflows.decide,
    depthplan_get_recovery: mcpWorkflows.recovery,
    depthplan_recovery: (input) => mcpWorkflows.start('recovery', input),
    depthplan_get_drafts: mcpDrafts.list,
    depthplan_resolve_draft: mcpDrafts.resolve,
    depthplan_controls: (input) => editorCommand('controls', input),
    depthplan_content_transfer: (input) => editorCommand('content', input),
    depthplan_delete_preview: owner.editorQueries.deletePreview,
    depthplan_edit: (input) => editorCommand('edit', input),
    depthplan_bookmarks: (input) => {
      const result = editorCommand('bookmarks', input);
      if (result.ok && input.action.type === 'apply') {
        const doc = owner.snapshot().document;
        if (doc)
          showStatus(
            `Bookmark ${doc.namedViews?.[input.action.id]?.name ?? ''} shown`,
          );
      }
      return result;
    },
    depthplan_camera: (input) => editorCommand('camera', input),
    depthplan_selection: (input) => editorCommand('selection', input),
    depthplan_history: (input) => editorCommand('history', input),
    depthplan_get_state: owner.editorQueries.getState,
    depthplan_query: owner.editorQueries.query,
    depthplan_read_chunk: owner.editorQueries.readChunk,
    depthplan_get_context: getContext,
    depthplan_get_hierarchy: getHierarchy,
    depthplan_set_depth: (input) => guardedMcp(() => setDepth(input)),
    depthplan_reveal_all: (input) => guardedMcp(() => revealAll(input)),
  });

  const renderToolbar = () => (
    <UnifiedToolbar
      automation={automation}
      operation={
        mcpWorkflows.activeOperation && {
          ...mcpWorkflows.activeOperation,
          cancel: mcpWorkflows.cancelActive,
        }
      }
      blocked={transitions.active || !!mcpWorkflows.activeOperation}
      currentDocument={currentDocument}
      hasSource={!!currentFilePath}
      documentStatus={
        dirty ? 'Unsaved changes' : currentFilePath ? 'Saved' : 'New document'
      }
      onReload={handleReloadFile}
      isLoading={isLoading}
      onNewDocument={handleNewDocument}
      onOpenFile={handleOpenFile}
      onSave={() => handleSave()}
      onSaveAs={handleSaveAs}
      onExportSVG={handleExportSVG}
      onExportJSON={handleExportJSON}
    />
  );
  return (
    <div className="workspace">
      <div
        inert={transitions.active || !!mcpWorkflows.activeOperation}
        style={{ display: 'contents' }}
      >
        <RecoveryChoices
          refresh={mcpWorkflows.recoveryVersion()}
          onRestore={async (candidate) =>
            transitions.request('restore', () => {
              owner.replace(candidate.document, {
                dirty: true,
                source: candidate.source,
                sessionId: candidate.sessionId,
              });
              showStatus('Recovered work — save to keep this document.');
            })
          }
        />
        {recovery.status && (
          <div
            role="status"
            style={{
              position: 'fixed',
              bottom: 50,
              left: 16,
              zIndex: 2000,
              background: '#fff3cd',
              color: '#553d00',
              padding: 12,
            }}
          >
            {recovery.status}
          </div>
        )}
        {statusMessage && (
          <div role="status" className="workspace-notice">
            {statusMessage}
          </div>
        )}

        {/* Full screen canvas */}
        {currentDocument && (
          <>
            <RecursiveCanvas
              key={sessionId}
              document={currentDocument}
              stamp={editorStamp(owner)}
              fitRef={owner.fitCanvas}
              canvas={owner.canvas}
              setCanvas={owner.setCanvas}
              camera={camera}
              setCamera={setCamera}
              onEdit={transact}
              onSelectDepth={selectDepth}
              onBusyChange={setBusy}
              exportRef={recursiveExport}
              isBusy={isBusy}
              onStatus={showStatus}
            />
            {renderToolbar()}
            {transactionResult?.status === 'rejected' && (
              <div
                role="alert"
                style={{
                  position: 'absolute',
                  top: 130,
                  left: 16,
                  background: 'white',
                  padding: 8,
                }}
              >
                {transactionResult.error}
              </div>
            )}
            <div
              role="toolbar"
              aria-label="Document history"
              className="document-history"
            >
              <NamedViews
                key={sessionId}
                document={currentDocument}
                onCommand={changeNamedView}
                isBusy={isBusy}
                onBusy={setBusy}
                onStatus={showStatus}
              />
              <button
                type="button"
                aria-label="Undo"
                title="Undo"
                onClick={undo}
                disabled={!canUndo}
              >
                <Icon name="rotate-left" />
              </button>
              <button
                type="button"
                aria-label="Redo"
                title="Redo"
                onClick={redo}
                disabled={!canRedo}
              >
                <Icon name="rotate-right" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
