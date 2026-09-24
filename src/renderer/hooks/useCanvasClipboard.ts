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
  const previous = useRef({ text: '', pastes: 0 });
  const paste = useEffectEvent((text: string) => {
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
  });
  const handle = useEffectEvent(
    (event: KeyboardEvent | ClipboardEvent, active: () => boolean) => {
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
        action = { c: 'copy', v: 'paste' }[event.key.toLowerCase()] ?? '';
      }
      if (action !== 'copy' && action !== 'paste') return;
      if (action === 'copy' && !selection.length) return;
      event.preventDefault();
      try {
        const data = 'clipboardData' in event ? event.clipboardData : null;
        const text =
          action === 'copy'
            ? copySelection(document, selection)
            : data?.getData('text/plain');
        if (action === 'copy' && data) data.setData('text/plain', text!);
        queue.current = queue.current
          .then(async () => {
            if (!active()) return;
            if (action === 'copy') {
              if (!data) await window.desktop.clipboard.writeText(text!);
              previous.current = { text: text!, pastes: 0 };
            } else {
              const value = text ?? (await window.desktop.clipboard.readText());
              if (active()) paste(value);
            }
          })
          .catch((error) => {
            if (active())
              onStatus(
                `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
              );
          });
      } catch (error) {
        onStatus(
          `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
  useEffect(() => {
    let active = true;
    const listener = (event: KeyboardEvent | ClipboardEvent) =>
      handle(event, () => active);
    window.addEventListener('keydown', listener);
    window.addEventListener('copy', listener);
    window.addEventListener('paste', listener);
    return () => {
      active = false;
      window.removeEventListener('keydown', listener);
      window.removeEventListener('copy', listener);
      window.removeEventListener('paste', listener);
    };
  }, []);
}
