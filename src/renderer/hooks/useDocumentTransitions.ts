import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type useDocumentState from './useDocumentState';
import type useDocumentFiles from './useDocumentFiles';
import type { FileAccess, FileActionResult } from './useDocumentFiles';
import { useDrafts } from './useDocumentDraft';
export type TransitionAccess = FileAccess & {
  confirm?: typeof window.desktop.transitions.confirm;
  ignoreBusy?: string;
};

/** One pending decision for all destructive entry points. Nothing is queued behind it. */
export default function useDocumentTransitions(
  owner: ReturnType<typeof useDocumentState>,
  files: ReturnType<typeof useDocumentFiles>,
  onStatus: (message: string) => void,
  leave?: (sessionId: string) => Promise<void>,
) {
  const pending = useRef(false),
    drafts = useDrafts();
  const [active, setActive] = useState(false);
  const lastResult = useRef<FileActionResult | null>(null);
  const pointerHeld = useRef(false);
  useEffect(() => {
    const down = (event: PointerEvent) => {
      pointerHeld.current = event.target instanceof HTMLCanvasElement;
    };
    const up = () => {
      pointerHeld.current = false;
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);
  const resolveDrafts = async (access: TransitionAccess) => {
    for (;;) {
      const entry = [...(drafts?.values() ?? [])].find((item) =>
        item.current.active(),
      );
      if (!entry) break;
      const choice = await (
        access.confirm ?? window.desktop.transitions.confirm
      )('draft', entry.current.label, !!entry.current.apply);
      if (choice === 'cancel') return false;
      const action =
        choice === 'save' ? entry.current.apply : entry.current.discard;
      if (!action) return false;
      // Commands execute synchronously; temporarily let this explicit draft commit
      // through the normal command guard. No MCP callback can interleave here.
      owner.setBusy('transition', false);
      try {
        flushSync(action);
      } finally {
        owner.setBusy('transition', true);
      }
      if (
        [...(drafts?.values() ?? [])].includes(entry) &&
        entry.current.active()
      ) {
        onStatus('Finish or correct the editor draft before continuing.');
        return false;
      }
    }
    const busy = owner
      .busyReasons()
      .filter(
        (reason) => reason !== 'transition' && reason !== access.ignoreBusy,
      );
    if (busy.length) {
      onStatus('Finish or cancel the current gesture before continuing.');
      return false;
    }
    return true;
  };
  const guard = async (access: TransitionAccess) => {
    if (!(await resolveDrafts(access))) return false;
    for (;;) {
      const current = owner.snapshot();
      if (!current.dirty) return true;
      if (access.permit?.() === false) return false;
      const choice = await (
        access.confirm ?? window.desktop.transitions.confirm
      )(
        'document',
        current.document?.metadata.title ?? 'Untitled Document',
        true,
      );
      if (choice === 'cancel') return false;
      // The prompt authorizes only the state it describes.
      const latest = owner.snapshot();
      if (latest.sessionId !== current.sessionId) return false;
      if (latest.revision !== current.revision) continue;
      if (choice === 'discard') return true;
      const saved = await files.save(false, access);
      lastResult.current = saved;
      if (saved.status !== 'success') return false;
      // Saving A does not authorize losing B accepted while the write awaited I/O.
    }
  };
  const release = () => {
    pending.current = false;
    setActive(false);
    owner.setBusy('transition', false);
    owner.setBusy('closing', false);
  };
  const request = async (
    kind: 'new' | 'open' | 'reload' | 'close' | 'restore',
    install?: () => void,
    access: TransitionAccess = {},
  ) => {
    if (pending.current || files.loading) return false;
    if (pointerHeld.current) {
      onStatus('Finish or cancel the current gesture before continuing.');
      return false;
    }
    pending.current = true;
    lastResult.current = null;
    setActive(true);
    owner.setBusy('transition', true);
    let closing = false;
    try {
      if (kind === 'close' || kind === 'restore') {
        if (!(await guard(access))) return false;
        if (access.permit?.() === false) return false;
        owner.setBusy('closing', true);
        await leave?.(owner.snapshot().sessionId);
        if (kind === 'restore') {
          owner.setBusy('closing', false);
          install!();
          return true;
        }
        closing = true;
        return true;
      }
      if (!(await resolveDrafts(access))) return false;
      const result = await files.load(kind, () => guard(access), access);
      lastResult.current = result;
      return result.status === 'success';
    } catch (error) {
      const current = owner.snapshot();
      lastResult.current = {
        status: 'error',
        sessionId: current.sessionId,
        revision: current.revision,
        error: error instanceof Error ? error.message : String(error),
      };
      onStatus(
        `Transition canceled: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    } finally {
      if (!closing) release();
    }
  };
  return {
    active,
    request,
    release,
    isPending: () => pending.current,
    lastResult: () => lastResult.current,
  };
}
