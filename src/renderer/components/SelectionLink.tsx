import { useId, useRef, useState } from 'react';
import { validLink } from '../../shared/recursiveDocument';
import type { DocumentEdit } from '../../shared/documentTransactions';
import { patchSelectionStyle } from '../../shared/editorProperties';
import useDocumentDraft from '../hooks/useDocumentDraft';
import FormDialog from './FormDialog';

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
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
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
  return (
    <FormDialog
      title="Item link"
      description="Use an http, https or mailto URL. Clear the field to remove the link."
      initialFocus={input}
      onCancel={onClose}
      onSubmit={apply}
      submitLabel="Save link"
      submitDisabled={!valid}
      actions={
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
        </button>
      }
    >
      <label className="form-dialog-field">
        <span>URL</span>
        <input
          ref={input}
          aria-label="Item link URL"
          aria-invalid={!valid}
          aria-describedby={!valid ? errorId : undefined}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      {!valid && (
        <p role="alert" id={errorId}>
          Enter an absolute URL without credentials or spaces.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </FormDialog>
  );
}
