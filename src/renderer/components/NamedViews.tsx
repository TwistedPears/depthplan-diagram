import Icon from './Icon';
import useDocumentDraft from '../hooks/useDocumentDraft';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import type { NamedViewAction, NamedViewResult } from '../../shared/namedViews';

export default function NamedViews({
  document,
  onCommand,
  isBusy,
  onBusy,
  onStatus,
}: {
  document: RecursiveDocument;
  onCommand: (action: NamedViewAction) => NamedViewResult;
  isBusy: () => boolean;
  onBusy: (source: string, busy: boolean) => void;
  onStatus: (message: string) => void;
}) {
  const [newName, setNewName] = useState('');
  const [naming, setNaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [context, setContext] = useState<{
    id: string;
    x: number;
    y: number;
    trigger: HTMLButtonElement;
  } | null>(null);
  const bookmarks = useRef<HTMLDetailsElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState('');
  const views = document.namedViews ?? {};
  const execute = (action: NamedViewAction) => {
    const result = onCommand(action);
    const message =
      result.error ??
      (action.type === 'apply'
        ? `Bookmark “${views[action.id].name}” shown.`
        : result.status === 'noop'
          ? 'Bookmark unchanged.'
          : action.type === 'delete'
            ? 'Bookmark deleted.'
            : 'Bookmark saved.');
    setNotice(result.error ?? '');
    onStatus(message);
    return result.status !== 'rejected';
  };
  const addBookmark = () => {
    if (
      newName.trim() &&
      execute({ type: 'create', id: crypto.randomUUID(), name: newName })
    )
      setNewName('');
  };
  useDocumentDraft({
    label: 'bookmark name',
    active: () => !!newName.trim(),
    apply: addBookmark,
    discard: () => setNewName(''),
  });
  const openMenu = (
    id: string,
    trigger: HTMLButtonElement,
    x = trigger.getBoundingClientRect().left,
    y = trigger.getBoundingClientRect().bottom,
  ) => {
    trigger.focus();
    setContext({ id, x, y, trigger });
  };
  const closeMenu = () => {
    menu.current?.hidePopover();
    context?.trigger.focus();
  };
  useEffect(() => {
    const dismiss = (event: Event) => {
      const target = event.target as Node;
      if (
        bookmarks.current?.open &&
        !bookmarks.current.contains(target) &&
        !menu.current?.contains(target)
      )
        bookmarks.current.open = false;
    };
    const controller = new AbortController();
    for (const type of ['pointerdown', 'focusin', 'wheel'])
      window.document.addEventListener(type, dismiss, {
        capture: true,
        passive: true,
        signal: controller.signal,
      });
    return () => controller.abort();
  }, []);
  useLayoutEffect(() => {
    const node = menu.current;
    if (!context || !node) return;
    node.showPopover({ source: context.trigger });
    node.style.left = `${Math.max(8, Math.min(context.x, window.innerWidth - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(context.y, window.innerHeight - node.offsetHeight - 8))}px`;
    node.querySelector('button')?.focus();
  }, [context]);
  const menuCommand = (action: NamedViewAction) => {
    closeMenu();
    execute(action);
  };
  return (
    <>
      <details
        ref={bookmarks}
        className="recursive-bookmarks"
        onToggle={(event) => {
          if (!event.currentTarget.open) {
            menu.current?.hidePopover();
            setContext(null);
            setNotice('');
          }
        }}
      >
        <summary>
          <Icon name="bookmark" /> Bookmarks
        </summary>
        <div className="bookmark-panel">
          {Object.keys(views).length > 0 && (
            <ul className="bookmark-list" aria-label="Bookmarks">
              {Object.values(views).map((view) => (
                <li key={view.id}>
                  <button
                    type="button"
                    className="bookmark-item"
                    data-bookmark-id={view.id}
                    aria-haspopup="menu"
                    title={view.name}
                    onClick={() => {
                      if (execute({ type: 'apply', id: view.id })) {
                        bookmarks.current!.open = false;
                        bookmarks.current!.querySelector('summary')?.focus();
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!event.buttons)
                        openMenu(
                          view.id,
                          event.currentTarget,
                          event.clientX,
                          event.clientY,
                        );
                    }}
                    onPointerUp={(event) => {
                      // macOS fires contextmenu before pointerup, which light-dismisses popovers.
                      if (
                        event.button === 2 ||
                        (event.button === 0 && event.ctrlKey)
                      )
                        openMenu(
                          view.id,
                          event.currentTarget,
                          event.clientX,
                          event.clientY,
                        );
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'ContextMenu' ||
                        (event.shiftKey && event.key === 'F10')
                      ) {
                        event.preventDefault();
                        openMenu(view.id, event.currentTarget);
                      }
                    }}
                  >
                    {view.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {notice && <p role="status">{notice}</p>}
          <form
            className="bookmark-add"
            data-document-editor
            onSubmit={(event) => {
              event.preventDefault();
              addBookmark();
            }}
          >
            <input
              aria-label="New bookmark name"
              placeholder="Add bookmark"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button
              type="submit"
              aria-label="Add bookmark"
              title="Add bookmark"
              disabled={!newName.trim()}
            >
              <Icon name="plus" />
            </button>
          </form>
        </div>
      </details>
      {context && views[context.id] && (
        <div
          ref={menu}
          popover="auto"
          className="bookmark-menu"
          role="menu"
          tabIndex={-1}
          aria-label={`Actions for ${views[context.id].name}`}
          data-document-editor
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Tab') {
              closeMenu();
              return;
            }
            const buttons = Array.from(
              event.currentTarget.querySelectorAll('button'),
            );
            const index = buttons.indexOf(
              window.document.activeElement as HTMLButtonElement,
            );
            const next = {
              ArrowDown: (index + 1) % buttons.length,
              ArrowUp: (index + buttons.length - 1) % buttons.length,
              Home: 0,
              End: buttons.length - 1,
            }[event.key];
            if (next !== undefined) {
              event.preventDefault();
              buttons[next].focus();
            }
          }}
        >
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            title="Replace this bookmark with the current view"
            onClick={() => menuCommand({ type: 'update', id: context.id })}
          >
            Reset View
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            onClick={() => {
              closeMenu();
              if (isBusy()) {
                onStatus(
                  'Finish the current edit or gesture before changing bookmarks.',
                );
                return;
              }
              setNaming({ id: context.id, name: views[context.id].name });
            }}
          >
            Rename
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            onClick={() =>
              menuCommand({
                type: 'duplicate',
                id: context.id,
                newId: crypto.randomUUID(),
              })
            }
          >
            Duplicate
          </button>
          <hr />
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            className="bookmark-delete"
            onClick={() => menuCommand({ type: 'delete', id: context.id })}
          >
            Delete
          </button>
        </div>
      )}
      {naming && (
        <BookmarkName
          key={naming.id}
          initial={naming.name}
          onBusy={onBusy}
          onCancel={() => setNaming(null)}
          onSave={(value) => {
            onBusy('bookmark-name', false);
            if (execute({ type: 'rename', id: naming.id, name: value })) {
              setNaming(null);
            } else onBusy('bookmark-name', true);
          }}
        />
      )}
    </>
  );
}
function BookmarkName({
  initial,
  onBusy,
  onSave,
  onCancel,
}: {
  initial: string;
  onBusy: (source: string, busy: boolean) => void;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initial);
  useDocumentDraft({
    label: 'bookmark name',
    active: () => true,
    apply: () => dialog.current!.querySelector('form')!.requestSubmit(),
    discard: onCancel,
  });
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    onBusy('bookmark-name', true);
    return () => {
      node.close();
      onBusy('bookmark-name', false);
    };
  }, [onBusy]);
  return (
    <dialog
      ref={dialog}
      aria-label="Name bookmark"
      data-document-editor
      onCancel={onCancel}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name);
        }}
      >
        <label>
          Bookmark name{' '}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!name.trim()}>
          Save bookmark
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </dialog>
  );
}
