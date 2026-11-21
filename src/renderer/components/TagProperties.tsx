import { useCallback, useState } from 'react';
import Icon from './Icon';
import type { DocumentEdit } from '../../shared/documentTransactions';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import { patchObject } from '../../shared/editorProperties';
import {
  editTagDefinition,
  entityTags,
  isLegend,
  setEntityTags,
} from '../../shared/tags';

const palette = ['#d97706', '#2563eb', '#16a34a', '#64748b', '#9333ea'];

/** Assign tags to the selection, manage the document tag set and mark a legend. */
export default function TagProperties({
  document,
  selection,
  onEdit,
}: {
  document: RecursiveDocument;
  selection: string[];
  onEdit: (edit: DocumentEdit) => void;
}) {
  const [draft, setDraft] = useState<{ name: string; color: string } | null>(
    null,
  );
  const focusOnOpen = useCallback((input: HTMLInputElement | null) => {
    input?.focus();
  }, []);
  const definitions = Object.values(document.tagDefinitions ?? {});
  const objects = selection.flatMap((key) =>
    key.startsWith('object-') ? [key.slice(7)] : [],
  );
  const connections = selection.flatMap((key) =>
    key.startsWith('connection-') ? [key.slice(11)] : [],
  );
  const entities = [
    ...objects.map((id) => document.objects[id]),
    ...connections.map((id) => document.connections[id]),
  ].filter(Boolean);
  const assigned = definitions.filter((tag) =>
    entities.some((entity) =>
      entityTags(document.tagDefinitions, entity).includes(tag),
    ),
  );
  const tag = (mode: 'add' | 'remove', id: string) =>
    onEdit(setEntityTags(mode, [id], objects, connections));
  const legendObject =
    objects.length === 1 && !connections.length
      ? document.objects[objects[0]]
      : undefined;
  const create = () => {
    if (!draft?.name.trim()) return;
    const id = crypto.randomUUID();
    onEdit((doc) => {
      editTagDefinition('create', id, draft)(doc);
      setEntityTags('add', [id], objects, connections)(doc);
    });
    setDraft(null);
  };
  return (
    <fieldset className="property-group tag-properties">
      <legend>Tags</legend>
      {assigned.length > 0 && (
        <ul className="tag-chips" aria-label="Assigned tags">
          {assigned.map((item) => (
            <li key={item.id} style={{ borderColor: item.color }}>
              <span className="tag-dot" style={{ background: item.color }} />
              {item.name}
              <button
                type="button"
                aria-label={`Remove tag ${item.name}`}
                title={`Remove tag ${item.name}`}
                onClick={() => tag('remove', item.id)}
              >
                <Icon name="xmark" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft ? (
        <div className="tag-new">
          <input
            aria-label="New tag name"
            placeholder="Tag name"
            value={draft.name}
            ref={focusOnOpen}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
              if (event.key === 'Escape') {
                event.stopPropagation();
                setDraft(null);
              }
            }}
          />
          <input
            type="color"
            aria-label="New tag color"
            value={draft.color}
            onChange={(event) =>
              setDraft({ ...draft, color: event.target.value })
            }
          />
          <button type="button" onClick={create}>
            Add
          </button>
        </div>
      ) : (
        <select
          aria-label="Add tag"
          value=""
          onChange={(event) => {
            const value = event.target.value;
            if (value === '__new')
              setDraft({
                name: '',
                color: palette[definitions.length % palette.length],
              });
            else if (value) tag('add', value);
          }}
        >
          <option value="">Add tag…</option>
          {definitions
            .filter(
              (item) =>
                !entities.every((entity) => entity.tags?.includes(item.id)),
            )
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          <option value="__new">New tag…</option>
        </select>
      )}
      {legendObject && (
        <label className="tag-legend-toggle">
          <input
            type="checkbox"
            checked={isLegend(legendObject)}
            onChange={(event) =>
              onEdit(
                patchObject(legendObject.id, {
                  style: { legend: event.target.checked },
                }),
              )
            }
          />
          Show tag legend
        </label>
      )}
      {definitions.length > 0 && (
        <details className="tag-manage">
          <summary>Manage tags</summary>
          <ul>
            {definitions.map((item) => (
              <li key={item.id}>
                <input
                  type="color"
                  aria-label={`${item.name} color`}
                  value={
                    /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#000000'
                  }
                  onChange={(event) =>
                    onEdit(
                      editTagDefinition('update', item.id, {
                        color: event.target.value,
                      }),
                    )
                  }
                />
                <input
                  aria-label={`${item.name} name`}
                  defaultValue={item.name}
                  key={item.name}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== item.name)
                      onEdit(editTagDefinition('update', item.id, { name }));
                    else event.target.value = item.name;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <select
                  aria-label={`${item.name} line style`}
                  value={item.strokeStyle ?? ''}
                  onChange={(event) =>
                    onEdit(
                      editTagDefinition('update', item.id, {
                        strokeStyle: (event.target.value as 'dashed') || null,
                      }),
                    )
                  }
                >
                  <option value="">Line: keep</option>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
                <button
                  type="button"
                  aria-label={`Delete tag ${item.name}`}
                  title={`Delete tag ${item.name} from the document`}
                  onClick={() => onEdit(editTagDefinition('delete', item.id))}
                >
                  <Icon name="delete" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </fieldset>
  );
}
