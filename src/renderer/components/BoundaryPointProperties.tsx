import useDocumentDraft from '../hooks/useDocumentDraft';
import { useEffect, useRef, useState } from 'react';
import type { BoundaryPoint } from '../../shared/recursiveDocument';
export default function BoundaryPointProperties({
  point,
  id,
  onApply,
  onClose,
}: {
  point: BoundaryPoint;
  id: string;
  onApply: (point: BoundaryPoint) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useDocumentDraft({
    label: 'boundary point properties',
    active: () => true,
    apply: () => dialog.current!.querySelector('form')!.requestSubmit(),
    discard: onClose,
  });
  const [side, setSide] = useState(point.side),
    [offset, setOffset] = useState(String(point.offset));
  const value = Number(offset),
    valid =
      offset.trim() !== '' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1;
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      data-document-editor
      aria-label="Boundary point properties"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            onApply({ side, offset: value });
            onClose();
          }
        }}
      >
        <h2>Boundary point</h2>
        <p>{id}</p>
        <label>
          Side
          <select
            aria-label="Side"
            value={side}
            onChange={(event) =>
              setSide(event.target.value as BoundaryPoint['side'])
            }
          >
            {(['top', 'right', 'bottom', 'left'] as const).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Offset
          <input
            type="number"
            min="0"
            max="1"
            step="any"
            required
            value={offset}
            onChange={(event) => setOffset(event.target.value)}
            aria-invalid={!valid}
          />
        </label>
        <p>
          Position is shared at all depths. Drag the orange circle to reposition
          it on the canvas. Use Line or Arrow to connect to it.
        </p>
        <button type="submit" disabled={!valid}>
          Apply point
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </dialog>
  );
}
