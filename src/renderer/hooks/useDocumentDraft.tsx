import {
  createContext,
  useContext,
  useLayoutEffect,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
export interface DocumentDraft {
  label: string;
  active: () => boolean;
  canSuspend?: () => boolean;
  apply?: () => void;
  discard: () => void;
}
function createDrafts() {
  const entries = new Map<
    string,
    { current: DocumentDraft; version: number }
  >();
  const listeners = new Set<() => void>();
  return {
    entries,
    changed: () => {
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hasActive: () =>
      [...entries.values()].some((entry) => entry.current.active()),
  };
}
const Drafts = createContext<ReturnType<typeof createDrafts> | null>(null);
export function DocumentDrafts({
  children,
  active = true,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  const drafts = useRef<ReturnType<typeof createDrafts> | null>(null);
  if (!drafts.current) drafts.current = createDrafts();
  const registry = drafts.current;
  useEffect(() => {
    if (!active) return;
    // Uncontrolled forms and ProseMirror edits need versioning even without a React render.
    const changed = () => {
      for (const entry of registry.entries.values())
        if (entry.current.active()) entry.version += 1;
      registry.changed();
    };
    const events = ['input', 'change', 'pointerdown', 'keydown'] as const;
    for (const event of events) document.addEventListener(event, changed, true);
    return () => {
      for (const event of events)
        document.removeEventListener(event, changed, true);
    };
  }, [active, registry]);
  return <Drafts.Provider value={registry}>{children}</Drafts.Provider>;
}
export function useDrafts() {
  return useContext(Drafts)?.entries ?? null;
}
export function useHasDrafts() {
  const registry = useContext(Drafts)!;
  return useSyncExternalStore(registry.subscribe, registry.hasActive);
}
/** Drafts keep their own state; the guard only invokes their normal Apply/Cancel paths. */
export default function useDocumentDraft(draft: DocumentDraft) {
  const registry = useContext(Drafts),
    current = useRef({ current: draft, version: 0 });
  current.current.current = draft;
  current.current.version += 1;
  useLayoutEffect(() => {
    const id = crypto.randomUUID();
    registry?.entries.set(id, current.current);
    registry?.changed();
    return () => {
      registry?.entries.delete(id);
      registry?.changed();
    };
  }, [registry]);
  useLayoutEffect(() => registry?.changed());
}
