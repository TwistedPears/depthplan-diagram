import { createEditorCommands } from '../../shared/editorCommands';
import {
  initialCanvasState,
  type CanvasState,
} from '../../shared/editorApiContract';
import { createEditorQueries } from '../../shared/editorQueries';
import {
  editNamedView,
  resolveNamedView,
  resolveNamedViewCamera,
  type NamedViewAction,
  type NamedViewResult,
} from '../../shared/namedViews';
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type SetStateAction,
} from 'react';
import {
  queryDocumentContext,
  queryDocumentHierarchy,
} from '../../shared/depthQueries';
import { createDepthCommands } from '../../shared/depthCommands';
import { selectRootDepth } from '../../shared/recursiveLayouts';
import type { Camera } from '../../shared/recursiveCamera';
import type { SourceFile } from '../../shared/fileContract';
import {
  validateRecursiveDocument,
  type RecursiveDocument,
} from '../../shared/recursiveDocument';
import {
  type DocumentEdit,
  type TransactionResult,
  transactDocument,
} from '../../shared/documentTransactions';

// Save completion compares captured content, never a later live revision.
function contentKey(document: RecursiveDocument | null) {
  return (
    document && {
      ...document,
      metadata: { ...document.metadata, modified: '' },
    }
  );
}
function matchesSaved(
  document: RecursiveDocument | null,
  saved: State['saved'],
) {
  const current = contentKey(document);
  if (current === null || saved === null) return current === saved;
  const keys = Object.keys(current) as (keyof RecursiveDocument)[];
  return (
    JSON.stringify(keys) === JSON.stringify(Object.keys(saved)) &&
    keys.every(
      (key) =>
        current[key] === saved[key] ||
        JSON.stringify(current[key]) === JSON.stringify(saved[key]),
    )
  );
}
type HistoryEntry = { document: RecursiveDocument; camera?: Camera };
type State = {
  document: RecursiveDocument | null;
  sessionId: string;
  revision: number;
  result: TransactionResult | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  camera: Camera;
  canvas: CanvasState;
  viewRevision: number;
  saved: ReturnType<typeof contentKey> | null;
  source: SourceFile | null;
  dirty: boolean;
};
type Action =
  | { type: 'edit'; edit: DocumentEdit; now: string; camera?: Camera }
  | { type: 'camera'; update: SetStateAction<Camera> }
  | { type: 'canvas'; update: SetStateAction<CanvasState> }
  | {
      type: 'replace';
      options?: {
        dirty?: boolean;
        source?: SourceFile | null;
        sessionId?: string;
      };
      update: RecursiveDocument | null;
      sessionId: string;
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | {
      type: 'saved';
      document: RecursiveDocument;
      sessionId: string;
      source?: SourceFile;
    };
function initialState(
  document: RecursiveDocument | null,
  sessionId: string,
  options: {
    dirty?: boolean;
    source?: SourceFile | null;
    sessionId?: string;
  } = {},
): State {
  if (document) validateRecursiveDocument(document);
  return {
    document,
    sessionId,
    revision: 0,
    result: null,
    past: [],
    future: [],
    camera: { x: 0, y: 0, scale: 1 },
    canvas: initialCanvasState(),
    viewRevision: 0,
    saved: options.dirty ? null : contentKey(document),
    source: options.source ?? null,
    dirty: !!options.dirty,
  };
}
function reduce(state: State, action: Action): State {
  if (action.type === 'canvas') {
    const canvas =
      typeof action.update === 'function'
        ? action.update(state.canvas)
        : action.update;
    return JSON.stringify(canvas) === JSON.stringify(state.canvas)
      ? state
      : { ...state, canvas, viewRevision: state.viewRevision + 1 };
  }
  if (action.type === 'camera') {
    const camera =
      typeof action.update === 'function'
        ? action.update(state.camera)
        : action.update;
    return camera.x === state.camera.x &&
      camera.y === state.camera.y &&
      camera.scale === state.camera.scale
      ? state
      : { ...state, camera, viewRevision: state.viewRevision + 1 };
  }
  if (action.type === 'saved')
    return action.sessionId === state.sessionId
      ? {
          ...state,
          saved: contentKey(action.document),
          source: action.source ?? state.source,
        }
      : state;
  if (action.type === 'replace')
    return initialState(action.update, action.sessionId, action.options);
  if (!state.document) return state;
  if (action.type === 'undo' || action.type === 'redo') {
    const from = action.type === 'undo' ? state.past : state.future;
    const entry = from.at(-1);
    if (!entry) return state;
    const inverse: HistoryEntry = {
      document: state.document,
      ...(entry.camera ? { camera: state.camera } : {}),
    };
    return {
      ...state,
      document: entry.document,
      camera: entry.camera ?? state.camera,
      viewRevision: state.viewRevision + (entry.camera ? 1 : 0),
      revision: state.revision + 1,
      result: null,
      past:
        action.type === 'undo'
          ? state.past.slice(0, -1)
          : [...state.past, inverse],
      future:
        action.type === 'redo'
          ? state.future.slice(0, -1)
          : [...state.future, inverse],
    };
  }
  let result = transactDocument(state.document, action.edit, action.now);
  if (result.status === 'rejected') return { ...state, result };
  const camera = action.camera ?? state.camera;
  const cameraChanged =
    camera.x !== state.camera.x ||
    camera.y !== state.camera.y ||
    camera.scale !== state.camera.scale;
  if (result.status === 'noop') {
    if (!cameraChanged) return { ...state, result };
    result = {
      status: 'accepted',
      before: state.document,
      document: state.document,
    };
  }
  return {
    ...state,
    document: result.document,
    camera,
    viewRevision: state.viewRevision + (cameraChanged ? 1 : 0),
    revision: state.revision + 1,
    result,
    past: [
      ...state.past,
      {
        document: result.before,
        ...(action.camera ? { camera: state.camera } : {}),
      },
    ],
    future: [],
  };
}

/** The sole document owner; one validated command is one session history entry. */
export default function useDocumentState(
  initial: RecursiveDocument | null,
  appInstanceId: string | null = null,
  options: { source?: SourceFile | null } = {},
) {
  const [state, setState] = useState(() =>
    initialState(initial, crypto.randomUUID(), options),
  );
  const live = useRef(state);
  const fitCanvas = useRef<(() => void) | null>(null);
  const busySources = useRef(new Set<string>());
  const instance = useRef(appInstanceId);
  instance.current = appInstanceId;
  // Publish to the authoritative owner synchronously, then schedule its React view.
  // Consecutive commands in one event turn must observe each other's revisions.
  const dispatch = useCallback((action: Action) => {
    if (busySources.current.has('closing')) return live.current;
    let next = reduce(live.current, action);
    if (next === live.current) return next;
    next = {
      ...next,
      dirty:
        next.document === live.current.document &&
        next.saved === live.current.saved
          ? live.current.dirty
          : !matchesSaved(next.document, next.saved),
    };
    if (next.sessionId !== live.current.sessionId) busySources.current.clear();
    live.current = next;
    setState(next);
    return next;
  }, []);
  const setBusy = useCallback((source: string, busy: boolean) => {
    if (busy) busySources.current.add(source);
    else busySources.current.delete(source);
  }, []);
  const isBusy = useCallback(() => busySources.current.size > 0, []);
  const transact = useCallback(
    (edit: DocumentEdit, camera?: Camera) =>
      dispatch({ type: 'edit', edit, camera, now: new Date().toISOString() })
        .result,
    [dispatch],
  );
  const setCamera = useCallback(
    (update: SetStateAction<Camera>) => {
      dispatch({ type: 'camera', update });
    },
    [dispatch],
  );
  const setCanvas = useCallback(
    (update: SetStateAction<CanvasState>) => {
      dispatch({ type: 'canvas', update });
    },
    [dispatch],
  );
  const changeNamedView = useCallback(
    (action: NamedViewAction): NamedViewResult => {
      const document = live.current.document;
      if (!document || busySources.current.size)
        return {
          status: 'rejected',
          error:
            'Finish the current edit or gesture before changing bookmarks.',
          adjustments: [],
        };
      try {
        const adjustments =
          action.type === 'apply'
            ? resolveNamedView(document, action.id).adjustments
            : [];
        const result = dispatch({
          type: 'edit',
          edit: editNamedView(
            action,
            live.current.camera,
            live.current.canvas.viewport,
          ),
          now: new Date().toISOString(),
          camera:
            action.type === 'apply'
              ? resolveNamedViewCamera(
                  document.namedViews?.[action.id],
                  live.current.canvas.viewport,
                )
              : undefined,
        }).result!;
        return {
          status: result.status,
          ...(result.status === 'rejected' ? { error: result.error } : {}),
          adjustments,
        };
      } catch (error) {
        return {
          status: 'rejected',
          error: error instanceof Error ? error.message : String(error),
          adjustments: [],
        };
      }
    },
    [dispatch],
  );
  const replace = useCallback(
    (
      update: RecursiveDocument | null,
      options?: {
        dirty?: boolean;
        source?: SourceFile | null;
        sessionId?: string;
      },
    ) =>
      dispatch({
        options,
        type: 'replace',
        update,
        sessionId: options?.sessionId ?? crypto.randomUUID(),
      }),
    [dispatch],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), [dispatch]);
  const redo = useCallback(() => dispatch({ type: 'redo' }), [dispatch]);
  const markSaved = useCallback(
    (document: RecursiveDocument, sessionId: string, source?: SourceFile) =>
      dispatch({ type: 'saved', document, sessionId, source }),
    [dispatch],
  );
  const snapshot = useCallback(
    () => ({
      appInstanceId: instance.current,
      document: live.current.document,
      sessionId: live.current.sessionId,
      revision: live.current.revision,
      dirty: live.current.dirty,
      source: live.current.source,
      camera: live.current.camera,
      canvas: live.current.canvas,
      viewRevision: live.current.viewRevision,
      canUndo: live.current.past.length > 0,
      canRedo: live.current.future.length > 0,
    }),
    [],
  );
  const selectDepth = useCallback(
    (rootId: string, depth: number | 'all') =>
      transact(selectRootDepth(rootId, depth)),
    [transact],
  );
  const command = useMemo(
    () =>
      createDepthCommands({
        snapshot,
        selectDepth,
        busy: () => busySources.current.size > 0,
      }),
    [snapshot, selectDepth],
  );
  const setDepth = useCallback(
    (request: unknown) => command('set', request),
    [command],
  );
  const revealAll = useCallback(
    (request: unknown) => command('all', request),
    [command],
  );
  const getContext = useCallback(
    (request: unknown = {}) => queryDocumentContext(snapshot(), request),
    [snapshot],
  );
  const getHierarchy = useCallback(
    (request: unknown) => queryDocumentHierarchy(snapshot(), request),
    [snapshot],
  );
  const editorQueries = useMemo(
    () =>
      createEditorQueries({
        snapshot,
        busyReasons: () => [...busySources.current],
      }),
    [snapshot],
  );
  const editorCommand = useMemo(
    () =>
      createEditorCommands({
        snapshot,
        busyReasons: () => [...busySources.current],
        transact,
        setCamera,
        setCanvas,
        undo,
        redo,
        fit: () => {
          if (!fitCanvas.current) throw new Error('Canvas is not ready');
          fitCanvas.current();
        },
      }),
    [snapshot, transact, setCamera, setCanvas, undo, redo],
  );
  useEffect(() => () => editorCommand.dispose(), [editorCommand]);
  return {
    ...state,
    snapshot,
    editorQueries,
    editorCommand,
    fitCanvas,
    setCanvas,
    getContext,
    getHierarchy,
    changeNamedView,
    setCamera,
    selectDepth,
    setDepth,
    revealAll,
    setBusy,
    busyReasons: () => [...busySources.current],
    isBusy,
    transact,
    replace,
    undo,
    redo,
    markSaved,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
