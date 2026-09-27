import { useId, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon';
import type { RecentProject } from '../../shared/projectContract';
import useProjectWorkspace from '../hooks/useProjectWorkspace';

export default function RecentProjects({ onAction }: { onAction: () => void }) {
  const workspace = useProjectWorkspace()!;
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RecentProject[]>([]);
  const [error, setError] = useState('');
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
  }, [open, entries, error]);
  const load = () => {
    setError('');
    void window.desktop.projects
      .recents()
      .then((result) => {
        if (result.status === 'success') setEntries(result.entries);
        else if (result.status === 'error') setError(result.error);
      })
      .catch((e) => setError(String(e)));
  };
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
    <div className="recent-projects">
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
        Open Recent <Icon name="chevron-right" />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        tabIndex={-1}
        className="recent-projects-menu"
        aria-label="Open Recent"
        aria-hidden={!open}
        onToggle={(event) => {
          const showing = event.newState === 'open';
          setOpen(showing);
          if (showing) load();
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
        {!entries.length && <p>No recent projects.</p>}
        {entries.slice(0, 5).map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="menuitem"
            disabled={workspace.busy}
            title={entry.location}
            aria-label={
              entry.available ? `Open ${entry.name}` : `Locate ${entry.name}…`
            }
            onClick={() => {
              menu.current?.hidePopover();
              onAction();
              void workspace.openProject(() =>
                window.desktop.projects.openRecent(entry.key, !entry.available),
              );
            }}
          >
            {entry.name}
            {!entry.available && ' (locate…)'}
            <small>{entry.location}</small>
          </button>
        ))}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
