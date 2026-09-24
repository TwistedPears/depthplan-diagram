import useDocumentDraft from '../hooks/useDocumentDraft';
import Icon from './Icon';
import { useEffect, useRef, useState } from 'react';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import type { DocumentEdit } from '../../shared/documentTransactions';
import {
  deleteSelection,
  deletionTargets,
} from '../../shared/recursiveDeletion';
import { deleteBoundaryPoint } from '../../shared/recursiveConnectionRepair';
import type { BoundaryReference } from '../../shared/recursiveBridges';
import { isEditingText } from '../hooks/useDocumentHistoryActions';
export default function RecursiveDelete({
  document,
  selection,
  point,
  blocked,
  onEdit,
  onBusyChange,
}: {
  document: RecursiveDocument;
  selection: string[];
  point: BoundaryReference | null;
  blocked: () => boolean;
  onEdit: (edit: DocumentEdit) => void;
  onBusyChange: (source: string, busy: boolean) => void;
}) {
  const [pending, setPending] = useState<{
    base: RecursiveDocument;
    ids: string[];
    connections: string[];
    count: number;
    descendants: number;
    hidden: number;
  } | null>(null);
  const confirm = () => {
    if (!pending || pending.base !== document) return;
    onEdit(deleteSelection(pending.ids, pending.connections));
    setPending(null);
  };
  useDocumentDraft({
    label: 'deletion confirmation',
    apply: confirm,
    active: () => !!pending,
    discard: () => setPending(null),
  });
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    onBusyChange('delete-confirmation', !!pending);
    if (pending) dialog.current!.showModal();
    return () => onBusyChange('delete-confirmation', false);
  }, [pending, onBusyChange]);
  useEffect(() => {
    if (pending && pending.base !== document) setPending(null);
  }, [document, pending]);
  const request = () => {
    if (blocked() || pending || window.document.querySelector('dialog[open]'))
      return;
    if (point) {
      onEdit(deleteBoundaryPoint(point.objectId, point.pointId));
      return;
    }
    const ids = selection
      .filter((id) => id.startsWith('object-'))
      .map((id) => id.slice(7));
    const connections = selection
      .filter((id) => id.startsWith('connection-'))
      .map((id) => id.slice(11));
    const targets = deletionTargets(document, ids);
    if (targets.descendants)
      setPending({
        base: document,
        ids,
        connections,
        count: targets.objects.size,
        descendants: targets.descendants,
        hidden: targets.hidden,
      });
    else onEdit(deleteSelection(ids, connections));
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !['Delete', 'Backspace'].includes(event.key) ||
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditingText(event.target)
      )
        return;
      if (blocked() || pending || window.document.querySelector('dialog[open]'))
        return;
      event.preventDefault();
      request();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return (
    <>
      <button
        type="button"
        aria-label={point ? 'Delete boundary point' : 'Delete selected'}
        title={point ? 'Delete boundary point' : 'Delete selected'}
        disabled={!selection.length && !point}
        onClick={request}
      >
        <Icon name="delete" />
      </button>
      {pending && (
        <dialog
          ref={dialog}
          data-document-editor
          aria-label="Delete subtree"
          onCancel={(event) => {
            event.preventDefault();
            setPending(null);
          }}
        >
          <h2>Delete selected objects?</h2>
          <p>
            {pending.count} objects, including {pending.descendants} descendants
            ({pending.hidden} hidden), and {pending.connections.length} selected
            connections will be deleted. You can Undo this action.
          </p>
          <button type="button" onClick={() => setPending(null)}>
            Cancel
          </button>
          <button type="button" onClick={confirm}>
            Delete subtree
          </button>
        </dialog>
      )}
    </>
  );
}
