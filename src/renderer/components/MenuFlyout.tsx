import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export default function MenuFlyout({
  label,
  active,
  className = '',
  onOpen,
  children,
}: {
  label: string;
  active: boolean;
  className?: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leave.current), []);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = button.current!.getBoundingClientRect();
      const right = button
        .current!.closest('.dropdown-menu')!
        .getBoundingClientRect().right;
      const panel = menu.current!;
      panel.style.left = `${Math.max(18, Math.min(right, window.innerWidth - panel.offsetWidth - 18))}px`;
      panel.style.top = `${Math.max(18, Math.min(rect.top, window.innerHeight - panel.offsetHeight - 18))}px`;
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  });
  useEffect(() => {
    if (!active) menu.current?.hidePopover();
  }, [active]);
  const enter = () => {
    menu.current?.showPopover();
    requestAnimationFrame(() =>
      (
        menu.current?.querySelector<HTMLButtonElement>(
          'button:not(:disabled)',
        ) ?? menu.current
      )?.focus(),
    );
  };
  return (
    <div
      className={`menu-flyout ${className}`}
      onMouseEnter={() => clearTimeout(leave.current)}
      onMouseLeave={() => {
        leave.current = setTimeout(() => menu.current?.hidePopover(), 120);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={enter}
        onMouseEnter={() => menu.current?.showPopover()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            enter();
          }
        }}
      >
        {label}
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        tabIndex={-1}
        className="menu-flyout-panel"
        aria-label={label}
        aria-hidden={!open}
        onToggle={(event) => {
          const showing = event.newState === 'open';
          setOpen(showing);
          if (showing) onOpen?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            menu.current?.hidePopover();
            button.current?.focus();
          } else if (
            ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
          ) {
            event.preventDefault();
            const items = [
              ...menu.current!.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
              ),
            ];
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const index =
              event.key === 'Home' || (current < 0 && event.key === 'ArrowDown')
                ? 0
                : event.key === 'End' || current < 0
                  ? items.length - 1
                  : (current +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      items.length) %
                    items.length;
            items[index]?.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
