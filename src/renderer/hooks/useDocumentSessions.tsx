import {
  createContext,
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

export type BoardSession = {
  key: string;
  document: RecursiveDocument;
  source: SourceFile | null;
};
export type SessionController = {
  owner: ReturnType<typeof useDocumentState>;
  files: ReturnType<typeof useDocumentFiles>;
  transitions: ReturnType<typeof useDocumentTransitions>;
  leave: (sessionId: string) => Promise<void>;
};

function useRegistry() {
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
  const [activeKey, setActiveKey] = useState(sessions[0].key);
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
          [
            'canvas-gesture',
            'connection-gesture',
            'mcp-operation',
            'closing',
          ].includes(reason),
        )
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
          { key, document: candidate.document, source: candidate.source },
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
    if (!activate(key)) return false;
    const controller = controllers.current.get(key);
    if (!controller) return false;
    closing.current = true;
    try {
      if (!(await controller.transitions.request('close'))) return false;
      const next = current.current.sessions.filter(
        (session) => session.key !== key,
      );
      current.current.sessions = next;
      focus.current.delete(key);
      flushSync(() => setSessions(next));
      show(next[0]?.key ?? '');
      return true;
    } finally {
      release();
    }
  };
  const closeAll = async () => {
    if (!canSwitch() || opening.current.size) return false;
    closing.current = true;
    let approved = false;
    try {
      // Resolve every board before retiring any recovery data. Cancel retains all sessions.
      for (const session of current.current.sessions) {
        show(session.key);
        const controller = controllers.current.get(session.key)!;
        if (!(await controller.transitions.request('prepare-close')))
          return false;
      }
      for (const controller of controllers.current.values())
        await controller.leave(controller.owner.snapshot().sessionId);
      approved = true;
      return true;
    } finally {
      if (!approved) release();
    }
  };
  return {
    sessions,
    activeKey,
    controllers: controllers.current,
    open,
    activate,
    close,
    closeAll,
    release,
  };
}

const Sessions = createContext<ReturnType<typeof useRegistry> | null>(null);
export function DocumentSessions({ children }: { children: ReactNode }) {
  return (
    <Sessions.Provider value={useRegistry()}>{children}</Sessions.Provider>
  );
}
export default function useDocumentSessions() {
  const sessions = useContext(Sessions);
  if (!sessions) throw new Error('DocumentSessions provider is required');
  return sessions;
}
