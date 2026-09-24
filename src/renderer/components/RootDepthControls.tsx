import Icon from './Icon';
import useDocumentDraft from '../hooks/useDocumentDraft';
import { memo, useEffect, useLayoutEffect, useState } from 'react';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import {
  rootDepthBounds,
  collapsedObjects,
} from '../../shared/recursiveVisibility';
import { indexHierarchy } from '../../shared/recursiveHierarchy';
import { objectLabel } from '../../shared/recursiveScene';

function RootDepthControl({
  label,
  id,
  current,
  maximum,
  locallyCollapsed,
  onSelect,
  onBusyChange,
}: {
  label: string;
  id: string;
  current: number;
  maximum: number;
  locallyCollapsed: boolean;
  onSelect: (rootId: string, depth: number | 'all') => void;
  onBusyChange?: (source: string, busy: boolean) => void;
}) {
  const [edit, setEdit] = useState({
    value: String(current),
    base: current,
    maximum,
  });
  const draft =
    edit.base === current && edit.maximum === maximum
      ? edit.value
      : String(current);
  const setDraft = (value: string) =>
    setEdit({ value, base: current, maximum });
  useEffect(
    () => setEdit({ value: String(current), base: current, maximum }),
    [current, maximum],
  );
  const value = Number(draft);
  const valid =
    draft.trim() !== '' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum;
  const changed = draft !== String(current);
  useDocumentDraft({
    label: `${label} depth`,
    active: () => changed,
    apply: () => {
      if (valid) {
        onSelect(id, value);
        setDraft(String(value));
      }
    },
    discard: () => setDraft(String(current)),
  });
  useLayoutEffect(() => {
    onBusyChange?.(`depth-draft:${id}`, changed);
    return () => onBusyChange?.(`depth-draft:${id}`, false);
  }, [id, changed, onBusyChange]);
  return (
    <form
      aria-label={`${label} depth controls`}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) {
          onSelect(id, value);
          setDraft(String(value));
        }
      }}
      className="root-depth-form"
    >
      <label className="root-depth-label">
        {label} depth{' '}
        <input
          aria-label={`${label} depth`}
          type="number"
          min={0}
          max={maximum}
          step={1}
          required
          value={draft}
          aria-invalid={!valid}
          style={{ width: 60 }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(String(current));
            }
          }}
        />
      </label>
      <div className="depth-range">
        Current D{current} / maximum D{maximum}
        {maximum === 0 ? ' · leaf' : ''}
        {locallyCollapsed ? ' · branches hidden locally' : ''}
      </div>
      <button
        type="submit"
        aria-label={`Set ${label} depth`}
        disabled={!valid || (value === current && !locallyCollapsed)}
      >
        Set depth
      </button>{' '}
      <button
        type="button"
        aria-label={`Reveal all for ${label}`}
        disabled={current === maximum && !locallyCollapsed}
        onClick={() => {
          onSelect(id, 'all');
          setDraft(String(maximum));
        }}
      >
        Reveal all
      </button>
      {changed && (
        <button type="button" onClick={() => setDraft(String(current))}>
          Cancel depth edit
        </button>
      )}
      {!valid && (
        <small role="status">
          Enter a whole number from 0 to {maximum}, or Escape to cancel.
        </small>
      )}
    </form>
  );
}
export default memo(function RootDepthControls({
  document,
  onSelect,
  onBusyChange,
}: {
  document: RecursiveDocument;
  onSelect: (rootId: string, depth: number | 'all') => void;
  onBusyChange?: (source: string, busy: boolean) => void;
}) {
  const roots = rootDepthBounds(document);
  const hierarchy = indexHierarchy(document.objects);
  const locallyCollapsed = new Set(
    [...collapsedObjects(document)].map(
      (id) => hierarchy.entries.get(id)!.root,
    ),
  );
  const names = new Map<string, number>();
  roots.forEach(({ id }) => {
    const name = objectLabel(document.objects[id]);
    names.set(name, (names.get(name) ?? 0) + 1);
  });
  return (
    <details className="depth-navigator" aria-label="Root depths">
      <summary>
        <Icon name="layer-group" /> Depth{' '}
        <span className="depth-count">
          {roots.length} {roots.length === 1 ? 'root' : 'roots'}
        </span>
      </summary>
      <div className="depth-panel">
        <h2>Levels of detail</h2>
        <p className="panel-description">
          Choose how much of each root to reveal.
        </p>
        {!roots.length && (
          <p>Draw a shape, then add children to build deeper levels.</p>
        )}
        {roots.map(({ id, selected, maximum }) => {
          const name = objectLabel(document.objects[id]);
          const label = names.get(name)! > 1 ? `${name} (${id})` : name;
          return (
            <RootDepthControl
              key={id}
              id={id}
              label={label}
              current={selected}
              maximum={maximum}
              locallyCollapsed={locallyCollapsed.has(id)}
              onSelect={onSelect}
              onBusyChange={onBusyChange}
            />
          );
        })}
      </div>
    </details>
  );
});
