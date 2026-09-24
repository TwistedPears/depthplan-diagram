import {
  createContext,
  useContext,
  useLayoutEffect,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
export interface DocumentDraft {
  label: string;
  active: () => boolean;
  apply?: () => void;
  discard: () => void;
}
const Drafts = createContext<Map<
  string,
  { current: DocumentDraft; version: number }
> | null>(null);
export function DocumentDrafts({ children }: { children: ReactNode }) {
  const drafts = useRef(
    new Map<string, { current: DocumentDraft; version: number }>(),
  );
  useEffect(() => {
    // Uncontrolled forms and ProseMirror edits need versioning even without a React render.
    const changed = () => {
      for (const entry of drafts.current.values())
        if (entry.current.active()) entry.version += 1;
    };
    const events = ['input', 'change', 'pointerdown', 'keydown'] as const;
    for (const event of events) document.addEventListener(event, changed, true);
    return () => {
      for (const event of events)
        document.removeEventListener(event, changed, true);
    };
  }, []);
  return <Drafts.Provider value={drafts.current}>{children}</Drafts.Provider>;
}
export function useDrafts() {
  return useContext(Drafts);
}
/** Drafts keep their own state; the guard only invokes their normal Apply/Cancel paths. */
export default function useDocumentDraft(draft: DocumentDraft) {
  const drafts = useDrafts(),
    current = useRef({ current: draft, version: 0 });
  current.current.current = draft;
  current.current.version += 1;
  useLayoutEffect(() => {
    const id = crypto.randomUUID();
    drafts?.set(id, current.current);
    return () => {
      drafts?.delete(id);
    };
  }, [drafts]);
}
