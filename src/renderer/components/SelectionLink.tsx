import { useEffect, useRef, useState } from 'react';
import { validLink } from '../../shared/recursiveDocument';
import type { DocumentEdit } from '../../shared/documentTransactions';
import { patchSelectionStyle } from '../../shared/editorProperties';
import useDocumentDraft from '../hooks/useDocumentDraft';

export default function SelectionLink({
  target,
  value,
  onEdit,
  onClose,
}: {
  target: string;
  value: string;
  onEdit: (edit: DocumentEdit) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState(value);
  const [error, setError] = useState('');
  const valid = url.trim() === '' || validLink(url.trim());
  const apply = () => {
    if (!valid) return;
    onEdit(patchSelectionStyle([target], { link: url.trim() || null }));
    onClose();
  };
  useDocumentDraft({
    label: 'item link',
    active: () => url !== value,
    apply,
    discard: onClose,
  });
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      data-document-editor
      aria-label="Item link"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <h2>Item link</h2>
        <label>
          URL{' '}
          <input
            aria-label="Item link URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <p>
          Use an http, https or mailto URL. Clear the field to remove the link.
        </p>
        {!valid && (
          <p role="alert">
            Enter an absolute URL without credentials or spaces.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={onClose}>
          Cancel
        </button>{' '}
        <button
          type="button"
          disabled={!validLink(url.trim())}
          onClick={() => {
            void window.desktop
              .openLink(url.trim())
              .catch((error) => setError(String(error)));
          }}
        >
          Open link
        </button>{' '}
        <button type="submit" disabled={!valid}>
          Save link
        </button>
      </form>
    </dialog>
  );
}
