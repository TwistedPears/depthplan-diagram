import useMcpWorkflows from './hooks/useMcpWorkflows';
import { projectNameSchema } from '../shared/projectContract';
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
import {
  Activity,
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import useDocumentSessions, {
  DocumentSessions,
  type BoardSession,
} from './hooks/useDocumentSessions';
import useDocumentHistoryActions from './hooks/useDocumentHistoryActions';
import useDocumentState from './hooks/useDocumentState';
import useDocumentFiles from './hooks/useDocumentFiles';
import useDocumentTransitions from './hooks/useDocumentTransitions';
import useDocumentOpenRequests from './hooks/useDocumentOpenRequests';
import { DocumentDrafts, useHasDrafts } from './hooks/useDocumentDraft';
import RecursiveCanvas from './components/RecursiveCanvas';
import NamedViews from './components/NamedViews';
import type useAutomation from './hooks/useAutomation';
import useWorkspaceAutomation from './hooks/useWorkspaceAutomation';
import './App.css';
import UnifiedToolbar from './components/UnifiedToolbar';
import exportAsJSON from './utils/jsonExport';
import useProjectWorkspace, {
  ProjectWorkspace,
} from './hooks/useProjectWorkspace';
import ProjectNavigation from './components/ProjectNavigation';
import useProjectAutosave from './hooks/useProjectAutosave';
import { objectLinkTarget } from '../shared/recursiveDocument';

export default function App() {
  return (
    <DocumentSessions>
      <Workspace />
    </DocumentSessions>
  );
}
export function Workspace() {
  return (
    <ProjectWorkspace>
      <SessionWorkspace />
    </ProjectWorkspace>
  );
}
const TemplateLibrary = lazy(() => import('./components/TemplateLibrary'));

function SessionWorkspace() {
  const projectWorkspace = useProjectWorkspace()!;
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
  const registry = useDocumentSessions();
  const automation = useWorkspaceAutomation(appInstanceId);
  useEffect(() => {
    const follow = (event: Event) => {
      const target = (
        event as CustomEvent<NonNullable<ReturnType<typeof objectLinkTarget>>>
      ).detail;
      const entry = [...registry.controllers].find(
        ([, c]) => c.owner.snapshot().document?.id === target.board,
      );
      if (!entry) {
        projectWorkspace.setError(
          'Open the target board in DepthPlan before following this object link.',
        );
        return;
      }
      const [key, { owner }] = entry;
      try {
        if (owner.isBusy() || projectWorkspace.busy || !registry.activate(key))
          throw new Error(
            'Finish the current edit before following this object link.',
          );
        owner.focusEntity(target.collection, target.id);
        projectWorkspace.setError('');
      } catch (error) {
        projectWorkspace.setError(
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    window.addEventListener('depthplan:open-object', follow);
    return () => window.removeEventListener('depthplan:open-object', follow);
  });
  useDocumentOpenRequests(
    projectWorkspace.busy ||
      !!projectWorkspace.dialog ||
      !projectWorkspace.recoveryReady ||
      !registry.canSwitch(),
    projectWorkspace.openRequest,
    projectWorkspace.setError,
  );
  useEffect(() =>
    window.desktop.transitions.onRequest((id) => {
      void (async () => {
        // Naming a first save can outlast the native close watchdog.
        const heartbeat = setInterval(() => {
          void window.desktop.transitions.keepAlive(id).catch(() => {});
        }, 10000);
        try {
          if (projectWorkspace.busy || projectWorkspace.dialog) {
            await window.desktop.transitions.reply(id, false);
            return;
          }
          await projectWorkspace.remember();
          const approved =
            (await projectWorkspace.guardProject()) &&
            (await registry.closeAll());
          await window.desktop.transitions.reply(id, approved);
        } catch {
          registry.release();
          await window.desktop.transitions.reply(id, false);
        } finally {
          clearInterval(heartbeat);
        }
      })();
    }),
  );
  return (
    <>
      {registry.sessions.map((session) => (
        <DocumentDrafts
          key={session.key}
          active={session.key === registry.activeKey}
        >
          <BoardWorkspace
            automation={automation}
            appInstanceId={appInstanceId}
            session={session}
            active={session.key === registry.activeKey}
          />
        </DocumentDrafts>
      ))}
      <ProjectNavigation automation={automation} />
    </>
  );
}
function BoardWorkspace({
  automation,
  appInstanceId,
  session,
  active,
}: {
  automation: ReturnType<typeof useAutomation>;
  appInstanceId: string | null;
  session: BoardSession;
  active: boolean;
}) {
  const registry = useDocumentSessions();
  const projectWorkspace = useProjectWorkspace()!;
  // Release the Konva stage before Activity defers updates to the hidden tree.
  const [visible, setVisible] = useState(active);
  useLayoutEffect(() => setVisible(active), [active]);
  const owner = useDocumentState(session.document, appInstanceId, {
    source: session.source,
  });
  const recovery = useRecovery(
    owner,
    projectWorkspace.project?.location ? session.project : undefined,
  );
  const hasDrafts = useHasDrafts();
  const { report } = registry;
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
  const [templatesOpen, setTemplatesOpen] = useState<
    false | 'gallery' | 'selection'
  >(false);
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
  const files = useDocumentFiles(owner, showStatus, recovery, session.project);
  useProjectAutosave(
    owner,
    files,
    projectWorkspace.autosave &&
      (session.project ? !!projectWorkspace.project?.location : !!owner.source),
  );
  const { scheduleRemember } = projectWorkspace;
  useEffect(() => {
    if (session.project) scheduleRemember();
  }, [owner.camera, session.project, scheduleRemember]);
  const transitions = useDocumentTransitions(
    owner,
    files,
    showStatus,
    recovery.leave,
    active,
  );
  const boardStatus = [
    files.failure
      ? files.failure.conflict
        ? 'Conflict'
        : 'Save failed'
      : session.project && !projectWorkspace.project?.location
        ? 'In memory'
        : files.loading
          ? 'Saving'
          : dirty
            ? session.project
              ? 'Saving'
              : 'Unsaved changes'
            : hasDrafts
              ? ''
              : 'Saved',
    hasDrafts ? 'Draft not saved' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  useEffect(
    () => report(session.key, boardStatus),
    [report, session.key, boardStatus],
  );
  useLayoutEffect(
    () => () => {
      registry.controllers.delete(session.key);
    },
    [registry.controllers, session.key],
  );
  const mcpWorkflows = useMcpWorkflows({
    project: session.project,
    isActive: () => registry.snapshot().activeKey === session.key,
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
      if (
        !templatesOpen &&
        !transitions.isPending() &&
        !mcpWorkflows.activeOperation
      )
        undo();
    },
    () => {
      if (
        !templatesOpen &&
        !transitions.isPending() &&
        !mcpWorkflows.activeOperation
      )
        redo();
    },
    active,
  );
  const isLoading =
    exportLoading ||
    projectWorkspace.busy ||
    !!projectWorkspace.dialog ||
    files.blocking ||
    transitions.active ||
    !!mcpWorkflows.activeOperation;
  const handleNewDocument = () => {
    if (!isLoading) {
      if (projectWorkspace.project) projectWorkspace.newBoard();
      else return transitions.request('new');
    }
  };
  const handleOpenFile = () => {
    if (!isLoading)
      return projectWorkspace.project
        ? projectWorkspace.setDialog({ kind: 'openBoard' })
        : transitions.request('open');
  };
  const handleReloadFile = () => {
    if (!isLoading) return transitions.request('reload');
  };
  const handleSave = () => {
    if (!isLoading) return projectWorkspace.saveAll();
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

  const handleSaveAs = async () => {
    if (isLoading) return;
    const captured = owner.snapshot().sessionId;
    await files.wait();
    if (owner.snapshot().sessionId === captured) return files.save(true);
  };

  // Only the visible board subscribes to window/menu events.
  useEffect(() => {
    if (!active) return;
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

  const handlers = {
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
    depthplan_search: owner.editorQueries.search,
    depthplan_read_chunk: owner.editorQueries.readChunk,
    depthplan_get_context: getContext,
    depthplan_get_hierarchy: getHierarchy,
    depthplan_set_depth: (input) => guardedMcp(() => setDepth(input)),
    depthplan_reveal_all: (input) => guardedMcp(() => revealAll(input)),
  } satisfies import('./hooks/useAutomation').AutomationHandlers;
  useLayoutEffect(() => {
    registry.controllers.set(session.key, {
      owner,
      files,
      transitions,
      leave: recovery.leave,
      hasDrafts,
      handlers,
      work: mcpWorkflows,
    });
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
      filename={
        session.project
          ? projectWorkspace.project?.manifest.boards
              .find((board) => board.id === session.project!.boardId)
              ?.path.split('/')
              .at(-1)
          : currentFilePath?.split(/[\\/]/).at(-1)
      }
      unsaved={dirty || hasDrafts || (!!session.project && !owner.source)}
      onRenameDocument={
        session.project
          ? (name) =>
              projectWorkspace.renameBoard(session.project!.boardId, name)
          : (name) =>
              projectWorkspace.run(async () => {
                if (!projectNameSchema.safeParse(name).success)
                  throw new Error('Enter a valid board name.');
                return (
                  owner.transact((draft) => {
                    draft.metadata.title = name;
                  })?.status !== 'rejected'
                );
              })
      }
      onRenameFile={
        session.project
          ? (name) =>
              projectWorkspace.renameFilename(session.project!.boardId, name)
          : owner.source
            ? (name) =>
                projectWorkspace.run(async () => {
                  if (!(await registry.prepare([session.key], true)))
                    return false;
                  if (
                    owner.snapshot().dirty &&
                    (await files.save()).status !== 'success'
                  )
                    return false;
                  const current = owner.snapshot();
                  const filename =
                    name.replace(/\.depthplan(?:\.json)?$/i, '') + '.depthplan';
                  if (!name) throw new Error('Enter a filename.');
                  const result = await window.desktop.fileSystem.renameDocument(
                    current.source!.id,
                    filename,
                  );
                  if (result.status === 'error') throw new Error(result.error);
                  if (result.status !== 'success') return false;
                  owner.relocate(
                    current.document!.metadata.title,
                    result.source,
                  );
                  return true;
                })
            : undefined
      }
      isLoading={isLoading}
      onTemplates={() => {
        if (!isLoading && !isBusy() && !hasDrafts) setTemplatesOpen('gallery');
        else showStatus('Finish the current edit before opening Templates.');
      }}
      onNewDocument={handleNewDocument}
      onOpenFile={handleOpenFile}
      onSave={() => handleSave()}
      onSaveAs={handleSaveAs}
      onExportSVG={handleExportSVG}
    />
  );
  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      {templatesOpen && currentDocument && (
        <Suspense fallback={null}>
          <TemplateLibrary
            owner={owner}
            initialAuthoring={
              templatesOpen === 'selection' ? 'selection' : null
            }
            onClose={() => setTemplatesOpen(false)}
            onStatus={showStatus}
          />
        </Suspense>
      )}
      <div
        className="workspace"
        data-board-session={session.key}
        data-active={active}
        id={session.project ? `board-${session.project.boardId}` : undefined}
        role={session.project ? 'region' : undefined}
        aria-label={
          session.project ? currentDocument?.metadata.title : undefined
        }
        tabIndex={session.project ? -1 : undefined}
      >
        <div
          inert={
            transitions.active ||
            !!mcpWorkflows.activeOperation ||
            projectWorkspace.busy
          }
          style={{ display: 'contents' }}
        >
          {!session.source && (
            <RecoveryChoices
              onReady={projectWorkspace.setRecoveryReady}
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
          )}
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
                active={active}
                document={currentDocument}
                hasHistory={canUndo || canRedo}
                stamp={editorStamp(owner)}
                fitRef={owner.fitCanvas}
                focusRef={owner.focusCanvas}
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
                onSaveTemplate={() => setTemplatesOpen('selection')}
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
    </Activity>
  );
}
