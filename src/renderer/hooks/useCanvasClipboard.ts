import { useEffect, useEffectEvent, useRef } from 'react';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import type {
  DocumentEdit,
  TransactionResult,
} from '../../shared/documentTransactions';
import {
  copySelection,
  readSelection,
  pasteSelection,
} from '../../shared/recursiveClipboard';
import { isEditingText } from './useDocumentHistoryActions';
import { deleteSelection } from '../../shared/recursiveDeletion';

type ClipboardAction = 'copy' | 'cut' | 'paste';

export default function useCanvasClipboard({
  document,
  selection,
  isBusy,
  onEdit,
  onSelect,
  onStatus,
}: {
  document: RecursiveDocument;
  selection: string[];
  isBusy: () => boolean;
  onEdit: (edit: DocumentEdit) => TransactionResult | null;
  onSelect: (selection: string[]) => void;
  onStatus: (message: string) => void;
}) {
  const queue = useRef(Promise.resolve());
  const lifetime = useRef({ active: false });
  const previous = useRef({ text: '', pastes: 0 });
  const paste = (text: string) => {
    if (
      isBusy() ||
      isEditingText(window.document.activeElement) ||
      window.document.querySelector('dialog[open]')
    )
      return;
    const source = readSelection(text);
    if (!source) return;
    const count =
      previous.current.text === text ? previous.current.pastes + 1 : 1;
    const copy = pasteSelection(source, count * 24);
    const result = onEdit(copy.edit);
    if (result?.status === 'accepted') {
      previous.current = { text, pastes: count };
      onSelect(copy.selection);
    } else if (result?.status === 'rejected') onStatus(result.error);
  };
  const latestPaste = useRef(paste);
  latestPaste.current = paste;
  const run = (action: ClipboardAction, data?: DataTransfer | null) => {
    if (isBusy() || (action !== 'paste' && !selection.length)) return;
    const active = lifetime.current;
    try {
      const text =
        action === 'paste'
          ? data?.getData('text/plain')
          : copySelection(document, selection);
      if (action !== 'paste' && data) data.setData('text/plain', text!);
      queue.current = queue.current
        .then(async () => {
          if (!active.active) return;
          if (action === 'paste') {
            const value = text ?? (await window.desktop.clipboard.readText());
            if (active.active) latestPaste.current(value);
            return;
          }
          if (!data) await window.desktop.clipboard.writeText(text!);
          if (!active.active) return;
          previous.current = { text: text!, pastes: 0 };
          if (action === 'cut') {
            const result = onEdit((draft) => {
              if (
                isBusy() ||
                JSON.stringify(draft) !== JSON.stringify(document)
              )
                throw new Error(
                  'Selection copied. The board changed before Cut could finish; nothing was removed.',
                );
              deleteSelection(
                selection
                  .filter((id) => id.startsWith('object-'))
                  .map((id) => id.slice(7)),
                selection
                  .filter((id) => id.startsWith('connection-'))
                  .map((id) => id.slice(11)),
              )(draft);
            });
            if (result?.status === 'accepted') onSelect([]);
            else if (result?.status === 'rejected') onStatus(result.error);
          }
        })
        .catch((error) => {
          if (active.active)
            onStatus(
              `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
            );
        });
    } catch (error) {
      onStatus(
        `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const handle = useEffectEvent((event: KeyboardEvent | ClipboardEvent) => {
    if (
      event.defaultPrevented ||
      isEditingText(event.target) ||
      isBusy() ||
      window.document.querySelector('dialog[open]')
    )
      return;
    let action = event.type;
    if (event instanceof KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.repeat
      )
        return;
      action =
        { c: 'copy', x: 'cut', v: 'paste' }[event.key.toLowerCase()] ?? '';
    }
    if (action !== 'copy' && action !== 'cut' && action !== 'paste') return;
    if (action !== 'paste' && !selection.length) return;
    event.preventDefault();
    run(action, 'clipboardData' in event ? event.clipboardData : null);
  });
  useEffect(() => {
    const active = { active: true };
    lifetime.current = active;
    const listener = (event: KeyboardEvent | ClipboardEvent) => handle(event);
    window.addEventListener('keydown', listener);
    window.addEventListener('copy', listener);
    window.addEventListener('cut', listener);
    window.addEventListener('paste', listener);
    return () => {
      active.active = false;
      window.removeEventListener('keydown', listener);
      window.removeEventListener('copy', listener);
      window.removeEventListener('cut', listener);
      window.removeEventListener('paste', listener);
    };
  }, []);
  return run;
}
