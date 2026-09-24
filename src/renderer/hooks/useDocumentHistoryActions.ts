import { useEffect } from 'react';

export function isEditingText(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [data-document-editor]',
    )
  );
}

export default function useDocumentHistoryActions(
  recursive: boolean,
  undo: () => void,
  redo: () => void,
) {
  useEffect(() => {
    const menu = (direction: 'undo' | 'redo') => {
      const editor = document.querySelector('[data-rich-editor]');
      if (
        editor &&
        !(document.activeElement instanceof HTMLInputElement) &&
        (!(document.activeElement instanceof HTMLTextAreaElement) ||
          document.activeElement.hasAttribute('data-code-source'))
      ) {
        editor.dispatchEvent(
          new CustomEvent('editor-history', { detail: direction }),
        );
      } else if (!recursive || isEditingText(document.activeElement)) {
        window.desktop.editHistory(direction);
      } else (direction === 'undo' ? undo : redo)();
    };
    const unbindUndo = window.desktop.events.on('menu:undo', () =>
      menu('undo'),
    );
    const unbindRedo = window.desktop.events.on('menu:redo', () =>
      menu('redo'),
    );
    const keydown = (event: KeyboardEvent) => {
      if (
        !recursive ||
        event.defaultPrevented ||
        isEditingText(event.target) ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      )
        return;
      const key = event.key.toLowerCase();
      if (key === 'z' || (key === 'y' && event.ctrlKey)) {
        event.preventDefault();
        (event.shiftKey || key === 'y' ? redo : undo)();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      unbindUndo();
      unbindRedo();
      window.removeEventListener('keydown', keydown);
    };
  }, [recursive, undo, redo]);
}
