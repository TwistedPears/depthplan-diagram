import {
  useLayoutEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import Icon from './Icon';

/** Mount to open; the owner unmounts the dialog when canceled or submitted. */
export default function FormDialog({
  title,
  description,
  children,
  submitLabel,
  onSubmit,
  onCancel,
  submitDisabled = false,
  cancelLabel = onSubmit ? 'Cancel' : 'Close',
  cancelDisabled = false,
  destructive = false,
  actions,
  className = '',
  initialFocus,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  submitLabel?: ReactNode;
  onSubmit?: () => void;
  onCancel: () => void;
  submitDisabled?: boolean;
  cancelLabel?: string;
  cancelDisabled?: boolean;
  destructive?: boolean;
  actions?: ReactNode;
  className?: string;
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptionId = useId();

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    initialFocus?.current?.focus();
    return () => element.close();
  }, [initialFocus]);

  return (
    <dialog
      ref={dialog}
      className={`form-dialog ${className}`.trim()}
      data-document-editor
      aria-label={title}
      aria-describedby={descriptionId}
      closedby="any"
      onCancel={(event) => {
        event.preventDefault();
        if (!cancelDisabled) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitDisabled) onSubmit?.();
        }}
      >
        <header className="form-dialog-header">
          <div>
            <h2>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <button
            type="button"
            className="form-dialog-close"
            aria-label={`Close ${title.toLowerCase()}`}
            title="Close"
            disabled={cancelDisabled}
            onClick={onCancel}
          >
            <Icon name="xmark" />
          </button>
        </header>
        {children && <div className="form-dialog-fields">{children}</div>}
        <footer className="form-dialog-actions">
          {actions}
          <button type="button" disabled={cancelDisabled} onClick={onCancel}>
            {cancelLabel}
          </button>
          {onSubmit && (
            <button
              type="submit"
              className={destructive ? 'danger-button' : 'primary-button'}
              disabled={submitDisabled}
            >
              {submitLabel}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
