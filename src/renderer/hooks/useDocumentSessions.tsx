import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import {
  createRecursiveDocument,
  validateRecursiveDocument,
  type RecursiveDocument,
} from '../../shared/recursiveDocument';
import type {
  FileCandidate,
  FileResult,
  SourceFile,
} from '../../shared/fileContract';
import type useDocumentState from './useDocumentState';
import type useDocumentFiles from './useDocumentFiles';
import type useDocumentTransitions from './useDocumentTransitions';
import type { AutomationHandlers } from './useAutomation';
import type useMcpWorkflows from './useMcpWorkflows';

export type BoardSession = {
  key: string;
  document: RecursiveDocument;
  source: SourceFile | null;
  project?: { sessionId: string; boardId: string };
};
export type SessionController = {
  owner: ReturnType<typeof useDocumentState>;
  files: ReturnType<typeof useDocumentFiles>;
  transitions: ReturnType<typeof useDocumentTransitions>;
  leave: (sessionId: string) => Promise<void>;
  hasDrafts?: boolean;
  handlers?: AutomationHandlers;
  work?: ReturnType<typeof useMcpWorkflows>;
};

function useRegistry() {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const report = useCallback(
    (key: string, status: string) =>
      setStatuses((all) =>
        all[key] === status ? all : { ...all, [key]: status },
      ),
    [],
  );
  const [sessions, setSessions] = useState<BoardSession[]>(() => [
    {
      key: crypto.randomUUID(),
      document: createRecursiveDocument(
        crypto.randomUUID(),
        'Untitled Document',
      ),
      source: null,
    },
  ]);
  const [activeKey, setActiveKey] = useState(() => sessions[0].key);
  const current = useRef({ sessions, activeKey });
  const controllers = useRef(new Map<string, SessionController>());
  const opening = useRef(new Map<string, Promise<string | null>>());
  const closing = useRef(false);
  const navigation = useRef(0);
  const focus = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target;
      const key =
        target instanceof HTMLElement
          ? target.closest<HTMLElement>('[data-board-session]')?.dataset
              .boardSession
          : undefined;
      if (key) focus.current.set(key, target as HTMLElement);
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);
  const canSwitch = () => {
    const controller = controllers.current.get(current.current.activeKey);
    return (
      !closing.current &&
      !controller?.transitions.isPending() &&
      (controller?.transitions.canDeactivate() ?? true) &&
      !controller?.owner
        .busyReasons()
        .some((reason) =>
          ['canvas-gesture', 'connection-gesture', 'closing'].includes(reason),
        ) &&
      controller?.work?.active()?.kind !== 'export'
    );
  };
  const show = (key: string) => {
    navigation.current += 1;
    const previous = current.current.activeKey;
    if (previous === key) return;
    current.current.activeKey = key;
    flushSync(() => setActiveKey(key));
    const target = focus.current.get(key);
    if (target?.isConnected) target.focus();
  };
  const activate = (key: string) => {
    if (
      !canSwitch() ||
      !current.current.sessions.some((session) => session.key === key)
    )
      return false;
    show(key);
    return true;
  };
  const open = (
    key: string,
    read: () => Promise<FileResult<FileCandidate>>,
    project?: BoardSession['project'],
  ) => {
    if (current.current.sessions.some((session) => session.key === key))
      return Promise.resolve(activate(key) ? key : null);
    const pending = opening.current.get(key);
    if (pending) return pending;
    if (!canSwitch()) return Promise.resolve(null);
    const origin = ++navigation.current;
    const operation = (async () => {
      const candidate = await read();
      if (candidate.status === 'canceled') return null;
      if (candidate.status === 'error') throw new Error(candidate.error);
      validateRecursiveDocument(candidate.document);
      if (closing.current) return null;
      const duplicate = current.current.sessions.find(
        (session) =>
          controllers.current.get(session.key)?.owner.snapshot().source
            ?.path === candidate.source.path,
      );
      const nextKey = duplicate?.key ?? key;
      if (!duplicate) {
        const next = [
          ...current.current.sessions,
          {
            key,
            document: candidate.document,
            source: candidate.source,
            project,
          },
        ];
        current.current.sessions = next;
        flushSync(() => setSessions(next));
      }
      // A late read must not steal focus from a newer navigation request.
      if (navigation.current === origin) activate(nextKey);
      return nextKey;
    })().finally(() => opening.current.delete(key));
    opening.current.set(key, operation);
    return operation;
  };
  const release = () => {
    closing.current = false;
    for (const controller of controllers.current.values())
      controller.transitions.release();
  };
  const close = async (key: string) => {
    const previous = current.current.activeKey;
    if (!activate(key)) return false;
    const controller = controllers.current.get(key);
    if (!controller) return false;
    let closed = false;
    try {
      if (!(await prepare([key]))) return false;
      await retire([key]);
      drop(key);
      closed = true;
      return true;
    } finally {
      release();
      if (!closed) show(previous);
    }
  };
  const prepare = async (
    keys = current.current.sessions.map((s) => s.key),
    copyKey?: string,
  ) => {
    if (!canSwitch() || opening.current.size) return false;
    const previous = current.current.activeKey;
    closing.current = true;
    let approved = false;
    try {
      const selected = current.current.sessions.filter((session) =>
        keys.includes(session.key),
      );
      if (
        selected.some((session) =>
          controllers.current.get(session.key)?.work?.active(),
        )
      )
        return false;
      // Resolve every board before retiring any recovery data. Cancel retains all sessions.
      for (const session of selected) {
        show(session.key);
        const controller = controllers.current.get(session.key)!;
        if (
          !(await controller.transitions.request(
            session.project || session.key === copyKey
              ? 'prepare-copy'
              : 'prepare-close',
          ))
        )
          return false;
        if (
          session.project &&
          session.key !== copyKey &&
          controller.owner.snapshot().dirty
        ) {
          const saved = await controller.files.save();
          if (saved.status !== 'success' || controller.owner.snapshot().dirty)
            return false;
        }
      }
      approved = true;
      return true;
    } finally {
      if (!approved) {
        release();
        show(previous);
      }
    }
  };
  const retire = async (keys = current.current.sessions.map((s) => s.key)) => {
    for (const key of keys) {
      const controller = controllers.current.get(key);
      if (controller)
        await controller.leave(controller.owner.snapshot().sessionId);
    }
  };
  const install = (next: BoardSession[], active = next[0]?.key ?? '') => {
    navigation.current += 1;
    current.current = { sessions: next, activeKey: active };
    const keys = new Set(next.map((session) => session.key));
    for (const key of focus.current.keys())
      if (!keys.has(key)) focus.current.delete(key);
    flushSync(() => {
      setSessions(next);
      setActiveKey(active);
      setStatuses((all) =>
        Object.fromEntries(
          Object.entries(all).filter(([key]) => keys.has(key)),
        ),
      );
    });
    release();
  };
  const drop = (key: string) => {
    const index = current.current.sessions.findIndex((s) => s.key === key);
    const next = current.current.sessions.filter((s) => s.key !== key);
    install(
      next,
      current.current.activeKey === key
        ? (next[index]?.key ?? next[index - 1]?.key ?? '')
        : current.current.activeKey,
    );
  };
  const closeAll = async () => {
    if (!(await prepare())) return false;
    await retire();
    return true;
  };
  const saveAll = async (keys = current.current.sessions.map((s) => s.key)) => {
    const results = await Promise.all(
      keys.map(async (key) => {
        const controller = controllers.current.get(key);
        if (!controller) return false;
        await controller.files.wait();
        return (
          !controller.owner.snapshot().dirty ||
          (await controller.files.save()).status === 'success'
        );
      }),
    );
    return results.every(Boolean);
  };
  return {
    sessions,
    snapshot: () => current.current,
    statuses,
    report,
    activeKey,
    controllers: controllers.current,
    open,
    activate,
    close,
    closeAll,
    saveAll,
    prepare,
    retire,
    install,
    drop,
    canSwitch,
    release,
  };
}

const Sessions = createContext<ReturnType<typeof useRegistry> | null>(null);
export function DocumentSessions({ children }: { children: ReactNode }) {
  const registry = useRegistry();
  return <Sessions.Provider value={registry}>{children}</Sessions.Provider>;
}
export default function useDocumentSessions() {
  const sessions = useContext(Sessions);
  if (!sessions) throw new Error('DocumentSessions provider is required');
  return sessions;
}
