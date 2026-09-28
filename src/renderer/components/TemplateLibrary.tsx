import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import FormDialog from './FormDialog';
import RecursiveScene from './RecursiveScene';
import type useDocumentState from '../hooks/useDocumentState';
import {
  bundledTemplates,
  templateCategories,
} from '../../shared/bundledTemplates';
import {
  createTemplate,
  insertTemplate,
  templateLinks,
  type Template,
  type TemplateEntry,
  type TemplateManifest,
} from '../../shared/templates';
import { type RecursiveDocument } from '../../shared/recursiveDocument';
import { recursiveScene } from '../../shared/recursiveScene';
import { fitCamera, sceneBounds } from '../../shared/recursiveCamera';

function Preview({
  document,
  height = 180,
}: {
  document: RecursiveDocument;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(1, entry.contentRect.width)),
    );
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, []);
  const scene = useMemo(() => recursiveScene(document), [document]);
  const bounds = useMemo(
    () => sceneBounds(document, scene).bounds,
    [document, scene],
  );
  const camera = fitCamera(bounds, { width, height }, 20);
  return (
    <div
      ref={container}
      className="template-preview"
      style={{ height }}
      role="img"
      aria-label={`Preview of ${document.metadata.title}`}
    >
      <Stage
        width={width}
        height={height}
        x={camera.x}
        y={camera.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
        listening={false}
      >
        <Layer>
          <RecursiveScene
            document={document}
            scene={scene}
            scale={camera.scale}
            onError={console.error}
          />
        </Layer>
      </Stage>
    </div>
  );
}

export default function TemplateLibrary({
  owner,
  initialAuthoring = null,
  onClose,
  onStatus,
}: {
  owner: ReturnType<typeof useDocumentState>;
  initialAuthoring?: 'selection' | null;
  onClose: () => void;
  onStatus: (message: string) => void;
}) {
  const current = owner.document!;
  const [personal, setPersonal] = useState<TemplateEntry[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const locked = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All templates');
  const [selected, setSelected] = useState('');
  const [authoring, setAuthoring] = useState<'board' | 'selection' | null>(
    initialAuthoring,
  );
  const selection = owner.canvas.selected;
  const selectionName =
    selection.length === 1 && selection[0].startsWith('object-')
      ? current.objects[selection[0].slice(7)].name
      : current.metadata.title;
  const [draft, setDraft] = useState({
    name: initialAuthoring ? selectionName : current.metadata.title,
    description: '',
    tags: '',
  });
  const [replacement, setReplacement] = useState<TemplateEntry | null>(null);
  const [picking, setPicking] = useState(false);
  const [review, setReview] = useState<{
    document: Template;
    action: 'import' | 'export' | 'save';
    expected?: string;
  } | null>(null);
  const [removing, setRemoving] = useState<TemplateEntry | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const refresh = async () => {
    const result = await window.desktop.templates.list();
    setPersonal(result.entries);
    setNotice(result.warnings.join('\n'));
  };
  useEffect(() => {
    owner.setBusy('templates', true);
    void run(refresh);
    return () => owner.setBusy('templates', false);
    // One gallery instance belongs to one editor session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const entries = [
    ...bundledTemplates.map((document) => ({
      key: `bundled:${document.extensions.template.id}`,
      document,
      label: 'Built-in',
      fingerprint: '',
    })),
    ...personal.map((entry) => ({
      ...entry,
      key: `personal:${entry.document.extensions.template.id}`,
      label: 'My templates',
    })),
  ];
  const active = entries.find((entry) => entry.key === selected);
  const visible = entries.filter(({ document, label }) => {
    const manifest = document.extensions.template;
    return (
      (category === 'All templates' ||
        (category === 'My templates' && label === category) ||
        manifest.tags.includes(category)) &&
      `${manifest.name} ${manifest.description} ${manifest.tags.join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    );
  });
  const pickTemplate = () => {
    setPicking(true);
    setCategory('My templates');
    setQuery('');
  };
  const chooseTemplate = (entry: TemplateEntry) => {
    const manifest = entry.document.extensions.template;
    setReplacement(entry);
    setDraft({
      name: manifest.name,
      description: manifest.description,
      tags: manifest.tags.join(', '),
    });
    setPicking(false);
    setSelected('');
  };

  const insert = (template: Template) => {
    if (locked.current) return;
    try {
      const { viewport } = owner.canvas;
      const insertion = insertTemplate(template, current, {
        x: (viewport.width / 2 - owner.camera.x) / owner.camera.scale,
        y: (viewport.height / 2 - owner.camera.y) / owner.camera.scale,
      });
      const result = owner.transact(
        insertion.edit,
        fitCamera(insertion.bounds, viewport, 100),
      );
      if (result?.status !== 'accepted')
        throw new Error(
          result?.status === 'rejected'
            ? result.error
            : 'Template could not be inserted.',
        );
      owner.setCanvas((canvas) => ({
        ...canvas,
        selected: insertion.selection,
        selectedPoint: null,
        tool: 'pointer',
        selectionCollapsed: true,
      }));
      onClose();
      onStatus(
        `${template.extensions.template.name} inserted. Edit it with the usual board tools.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  if (review) {
    const manifest = review.document.extensions.template;
    const duplicate = entries.some(
      (entry) => entry.document.extensions.template.id === manifest.id,
    );
    const links = templateLinks(review.document);
    return (
      <FormDialog
        title={
          review.action === 'export' ? 'Export template' : 'Review template'
        }
        description="Check the content before saving or sharing."
        cancelDisabled={busy}
        submitDisabled={busy}
        submitLabel={
          review.action === 'export'
            ? 'Export file'
            : review.action === 'import' && duplicate
              ? 'Import separate copy'
              : 'Save to library'
        }
        onCancel={() => {
          if (review.action === 'save') return onClose();
          setReview(null);
          setError('');
        }}
        actions={
          review.action === 'save' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError('');
              }}
            >
              Back to template
            </button>
          )
        }
        onSubmit={() =>
          void run(async () => {
            if (review.action === 'export') {
              if (!(await window.desktop.templates.export(review.document)))
                return;
            } else {
              const document =
                review.action === 'import' && duplicate
                  ? createTemplate(review.document, {
                      ...manifest,
                      id: crypto.randomUUID(),
                      version: 1,
                      name: `${manifest.name} copy`,
                    })
                  : review.document;
              await window.desktop.templates.save(document, review.expected);
              if (review.action === 'save') {
                onClose();
                onStatus(
                  replacement
                    ? 'Template updated.'
                    : 'Template saved to your library.',
                );
                return;
              }
              await refresh();
              setSelected('');
              setCategory('My templates');
              setQuery('');
            }
            setReview(null);
            setNotice(
              review.action === 'export'
                ? 'Template exported.'
                : 'Template saved to your library.',
            );
          })
        }
      >
        <p>
          <strong>{manifest.name}</strong> ·{' '}
          {Object.keys(review.document.objects).length} shapes ·{' '}
          {Object.keys(review.document.connections).length} connections
        </p>
        <p>{manifest.description}</p>
        {review.action === 'save' && replacement && (
          <p>
            Replaces {replacement.document.extensions.template.name} in My
            templates.
          </p>
        )}
        {!!manifest.excludedConnections.length && (
          <p>
            Connections outside the selection are excluded:{' '}
            {manifest.excludedConnections.join(', ')}
          </p>
        )}
        {!!links.length && <p>Content links: {links.join(', ')}</p>}
        {review.action === 'import' && duplicate && (
          <p>
            A template with this ID is already available. Import creates a
            separate copy; it will not replace your entry.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </FormDialog>
    );
  }
  if (authoring && !picking)
    return (
      <FormDialog
        title="Save template"
        description="Save an editable example to your personal gallery."
        submitDisabled={busy}
        onCancel={onClose}
        submitLabel={replacement ? 'Review replacement' : 'Review template'}
        onSubmit={() => {
          setError('');
          try {
            const existing = replacement?.document.extensions.template;
            const manifest: TemplateManifest = {
              formatVersion: 1,
              id: existing?.id ?? crypto.randomUUID(),
              version: existing ? existing.version + 1 : 1,
              name: draft.name.trim(),
              description: draft.description,
              tags: draft.tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
              guidance: '',
              components: [],
              excludedConnections: [],
            };
            setReview({
              document: createTemplate(
                current,
                manifest,
                authoring === 'selection' ? selection : undefined,
              ),
              expected: replacement?.fingerprint,
              action: 'save',
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <label className="form-dialog-field">
          Save as
          <select
            value={replacement ? 'update' : 'new'}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value === 'new') setReplacement(null);
              else pickTemplate();
            }}
          >
            <option value="new">New template</option>
            <option value="update">Update existing template</option>
          </select>
        </label>
        {replacement && (
          <div>
            <p>
              Updating {replacement.document.extensions.template.name}. Objects
              on your boards will stay unchanged.
            </p>
            <button type="button" onClick={pickTemplate}>
              Choose another template
            </button>
          </div>
        )}
        <label className="form-dialog-field">
          Template name
          <input
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="form-dialog-field">
          Description
          <textarea
            maxLength={4000}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </label>
        <label className="form-dialog-field">
          Tags (comma separated)
          <input
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          />
        </label>
        {busy && <p role="status">Loading personal templates…</p>}
        {error && <p role="alert">{error}</p>}
      </FormDialog>
    );
  if (removing)
    return (
      <FormDialog
        title="Remove personal template"
        description={`Remove ${removing.document.extensions.template.name} from your gallery? Objects already inserted on boards stay unchanged.`}
        onCancel={() => {
          setRemoving(null);
          setError('');
        }}
        cancelDisabled={busy}
        submitDisabled={busy}
        submitLabel="Remove"
        destructive
        onSubmit={() =>
          void run(async () => {
            await window.desktop.templates.remove(
              removing.document.extensions.template.id,
              removing.fingerprint,
            );
            await refresh();
            setRemoving(null);
            setSelected('');
          })
        }
      >
        {error && <p role="alert">{error}</p>}
      </FormDialog>
    );
  if (active)
    return (
      <FormDialog
        title={active.document.extensions.template.name}
        description={active.document.extensions.template.description}
        className="template-details"
        onCancel={() => {
          if (picking) return onClose();
          setSelected('');
          setError('');
        }}
        cancelLabel={picking ? 'Cancel' : 'Back to gallery'}
        cancelDisabled={busy}
        submitDisabled={busy}
        submitLabel={picking ? 'Choose template' : 'Insert template'}
        onSubmit={() =>
          picking ? chooseTemplate(active) : insert(active.document)
        }
        actions={
          picking ? (
            <button type="button" onClick={() => setSelected('')}>
              Back to gallery
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setReview({ document: active.document, action: 'export' })
                }
              >
                Export template
              </button>
              {active.label === 'My templates' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRemoving(active)}
                >
                  Remove
                </button>
              )}
            </>
          )
        }
      >
        <Preview document={active.document} height={560} />
        <p>
          {picking
            ? 'Choose this template to replace its saved content with your current example.'
            : 'Added to open space on this board. Every shape and connection is yours to edit.'}
        </p>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </FormDialog>
    );
  return (
    <FormDialog
      title="Templates"
      description={
        picking
          ? 'Choose a personal template to update with your current example.'
          : 'A starting point for your next diagram. Insert an example, then make it your own.'
      }
      className="template-library"
      onCancel={onClose}
      cancelLabel={picking ? 'Cancel' : false}
      cancelDisabled={busy}
      initialFocus={search}
      actions={
        picking && (
          <button type="button" onClick={() => setPicking(false)}>
            Back to template
          </button>
        )
      }
    >
      <div className="template-gallery-layout">
        <aside className="template-sidebar">
          <nav aria-label="Template categories">
            {(picking
              ? ['My templates']
              : ['All templates', 'My templates']
            ).map((label) => (
              <button
                type="button"
                key={label}
                aria-pressed={category === label}
                onClick={() => setCategory(label)}
              >
                {label}
              </button>
            ))}
            {!picking && <h3>Use cases</h3>}
            {!picking &&
              templateCategories.map((label) => (
                <button
                  type="button"
                  key={label}
                  aria-pressed={category === label}
                  onClick={() => setCategory(label)}
                >
                  {label}
                </button>
              ))}
          </nav>
          {!picking && (
            <div className="template-library-actions">
              <h3>Your templates</h3>
              <button
                type="button"
                disabled={
                  busy ||
                  (!Object.keys(current.objects).length &&
                    !Object.keys(current.connections).length)
                }
                onClick={() => setAuthoring('board')}
              >
                Save board as template
              </button>
              <button
                type="button"
                disabled={busy || !selection.length}
                onClick={() => {
                  setDraft({ ...draft, name: selectionName });
                  setAuthoring('selection');
                }}
              >
                Save selection
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const entry = await window.desktop.templates.import();
                    if (entry)
                      setReview({ document: entry.document, action: 'import' });
                  })
                }
              >
                Import template
              </button>
            </div>
          )}
        </aside>
        <section
          className="template-gallery"
          aria-label="Template gallery"
          aria-busy={busy}
        >
          <label className="form-dialog-field">
            <input
              ref={search}
              aria-label="Search templates"
              type="search"
              placeholder="Search templates by name or category"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="template-gallery-heading">
            <h3>{category}</h3>
            <span>
              {visible.length} {visible.length === 1 ? 'template' : 'templates'}
            </span>
          </div>
          {busy && <p role="status">Loading templates…</p>}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {!busy && !visible.length && (
            <div className="template-empty">
              <h3>{query ? 'No matching templates' : 'No templates yet'}</h3>
              <p>
                {query
                  ? 'Try a different search or category.'
                  : picking
                    ? 'Go back and choose New template to save your first example.'
                    : 'Save a board or import a template to add it here.'}
              </p>
            </div>
          )}
          <div className="template-grid">
            {visible.map((entry) => (
              <article className="template-card" key={entry.key}>
                <button
                  type="button"
                  className="template-card-preview"
                  aria-label={`Preview ${entry.document.extensions.template.name}`}
                  onClick={() => {
                    setSelected(entry.key);
                    setError('');
                  }}
                >
                  <Preview document={entry.document} />
                  <span className="template-card-source">{entry.label}</span>
                  <span className="template-card-title">
                    {entry.document.extensions.template.name}
                  </span>
                </button>
                <p>{entry.document.extensions.template.description}</p>
                <button
                  type="button"
                  className="primary-button"
                  aria-label={`${picking ? 'Choose' : 'Insert'} ${entry.document.extensions.template.name}`}
                  disabled={busy}
                  onClick={() =>
                    picking ? chooseTemplate(entry) : insert(entry.document)
                  }
                >
                  {picking ? 'Choose template' : 'Insert template'}
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </FormDialog>
  );
}
