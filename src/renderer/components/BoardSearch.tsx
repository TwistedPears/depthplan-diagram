import { useEffect, useRef, useState } from 'react';
import useProjectWorkspace from '../hooks/useProjectWorkspace';
import Icon from './Icon';

export default function BoardSearch({
  onSearch,
  onOpen,
}: {
  onSearch?: (query: string) => void;
  onOpen?: () => void;
}) {
  const workspace = useProjectWorkspace();
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const label = workspace?.project ? 'Search boards' : 'Search objects';
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  return (
    <>
      <button
        ref={button}
        id="object-search-toggle"
        type="button"
        className={`tool-button ${open ? 'active' : ''}`}
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-controls="object-search-form"
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <Icon name="magnifying-glass" />
      </button>
      <form
        id="object-search-form"
        className="object-search-form"
        role="search"
        hidden={!open}
        onSubmit={(event) => {
          event.preventDefault();
          const query = input.current?.value.trim() ?? '';
          if (workspace?.project)
            workspace.setDialog({ kind: 'search', query });
          else onSearch?.(query);
        }}
      >
        <input
          ref={input}
          id="object-search-input"
          type="search"
          maxLength={1024}
          aria-label={
            workspace?.project ? 'Search all boards' : 'Search object text'
          }
          placeholder={
            workspace?.project
              ? 'Search all boards… Press Enter'
              : 'Search object text… Press Enter'
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
              button.current?.focus();
            }
          }}
        />
      </form>
    </>
  );
}
