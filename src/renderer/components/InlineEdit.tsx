import { useLayoutEffect, useRef, type ButtonHTMLAttributes } from 'react';

/** Enter/blur commits once; Escape discards without letting blur save it. */
export default function InlineEdit({
  value,
  label,
  editing,
  onEditing,
  onSave,
  unsaved = false,
  ...button
}: {
  value: string;
  label: string;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  onSave: (value: string) => Promise<boolean>;
  unsaved?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const input = useRef<HTMLInputElement>(null);
  const display = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const finished = useRef(false);
  useLayoutEffect(() => {
    if (editing) {
      finished.current = false;
      input.current?.focus();
      input.current?.select();
    } else if (returnFocus.current) {
      display.current?.focus();
      returnFocus.current = false;
    }
  }, [editing]);
  const commit = async () => {
    if (finished.current) return;
    finished.current = true;
    const next = input.current!.value.trim();
    if (next === value || (await onSave(next))) onEditing(false);
    else finished.current = false;
  };
  return editing ? (
    <input
      ref={input}
      className="inline-edit-input"
      aria-label={label}
      defaultValue={value}
      data-inline-edit
      onBlur={() => {
        returnFocus.current = false;
        void commit();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          returnFocus.current = true;
          finished.current = true;
          onEditing(false);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          returnFocus.current = true;
          void commit();
        }
      }}
    />
  ) : (
    <button
      {...button}
      ref={display}
      type="button"
      className={`inline-edit ${button.className ?? ''}`}
      title={`${value}${unsaved ? ' — Unsaved' : ''}`}
      aria-label={button['aria-label'] ?? `Edit ${label.toLowerCase()}`}
      onDoubleClick={() => onEditing(true)}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          onEditing(true);
        } else button.onKeyDown?.(event);
      }}
    >
      <span>{value}</span>
      {unsaved && <sup aria-label="Unsaved">*</sup>}
    </button>
  );
}
