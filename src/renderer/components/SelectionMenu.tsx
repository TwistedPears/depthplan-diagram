import { Fragment, useLayoutEffect, useRef } from 'react';

export type SelectionMenuItem = {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  action: () => void;
};

export default function SelectionMenu({
  x,
  y,
  groups,
  onClose,
}: {
  x: number;
  y: number;
  groups: SelectionMenuItem[][];
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef(window.document.activeElement as HTMLElement | null);
  const close = () => {
    menu.current?.hidePopover();
    trigger.current?.focus();
    onClose();
  };
  useLayoutEffect(() => {
    const node = menu.current!;
    node.showPopover();
    node.style.left = `${Math.max(8, Math.min(x, window.innerWidth - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(y, window.innerHeight - node.offsetHeight - 8))}px`;
    node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  return (
    <div
      ref={menu}
      popover="auto"
      role="menu"
      tabIndex={-1}
      aria-label="Selection actions"
      className="selection-menu"
      data-document-editor
      onToggle={(event) => {
        if (event.newState === 'closed') onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          close();
          return;
        }
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ),
        ];
        const at = buttons.indexOf(
          window.document.activeElement as HTMLButtonElement,
        );
        const next = {
          ArrowDown: (at + 1) % buttons.length,
          ArrowUp: (at + buttons.length - 1) % buttons.length,
          Home: 0,
          End: buttons.length - 1,
        }[event.key];
        if (next !== undefined) {
          event.preventDefault();
          buttons[next]?.focus();
        }
      }}
    >
      {groups
        .filter((group) => group.length)
        .map((group, index) => (
          <Fragment key={group[0].label}>
            {index > 0 && <hr />}
            {group.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                aria-label={item.label}
                tabIndex={-1}
                disabled={item.disabled}
                className={
                  item.label === 'Delete' ? 'selection-delete' : undefined
                }
                onClick={() => {
                  close();
                  item.action();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            ))}
          </Fragment>
        ))}
    </div>
  );
}
