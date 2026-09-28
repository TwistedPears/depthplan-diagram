import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import FormDialog from './FormDialog';
import RecursiveScene from './RecursiveScene';
import type useDocumentState from '../hooks/useDocumentState';
import { bundledTemplates } from '../../shared/bundledTemplates';
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

const categories = [
  { label: 'Data modelling', tag: 'ERD' },
  { label: 'Infrastructure', tag: 'infrastructure' },
  { label: 'Industrial systems', tag: 'industrial' },
];

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
  const [authorDraft, setAuthorDraft] = useState<TemplateManifest>();
  const [review, setReview] = useState<{
    document: Template;
    action: 'import' | 'export' | 'save';
    expected?: string;
  } | null>(null);
  const [removing, setRemoving] = useState<TemplateEntry | null>(null);
  const selection = owner.canvas.selected;
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
    const useCases = categories
      .filter(({ tag }) =>
        manifest.tags.some(
          (value) => value.toLowerCase() === tag.toLowerCase(),
        ),
      )
      .map(({ label }) => label);
    return (
      (category === 'All templates' ||
        (category === 'My templates' && label === category) ||
        useCases.includes(category)) &&
      `${manifest.name} ${manifest.description} ${manifest.tags.join(' ')} ${useCases.join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    );
  });

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
          setReview(null);
          setError('');
        }}
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
              await refresh();
              setSelected('');
              setCategory('My templates');
              setQuery('');
            }
            setReview(null);
            setAuthoring(null);
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
  if (authoring)
    return (
      <TemplateAuthor
        document={current}
        selection={authoring === 'selection' ? selection : undefined}
        personal={personal}
        busy={busy}
        libraryError={error}
        initial={authorDraft}
        onCancel={() => setAuthoring(null)}
        onSave={(document, expected) => {
          setAuthorDraft(document.extensions.template);
          setReview({ document, expected, action: 'save' });
        }}
      />
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
          setSelected('');
          setError('');
        }}
        cancelLabel="Back to gallery"
        cancelDisabled={busy}
        submitDisabled={busy}
        submitLabel="Insert template"
        onSubmit={() => insert(active.document)}
        actions={
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
        }
      >
        <Preview document={active.document} height={360} />
        <p>
          Added to open space on this board. Every shape and connection is yours
          to edit.
        </p>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </FormDialog>
    );
  return (
    <FormDialog
      title="Templates"
      description="A starting point for your next diagram. Insert an example, then make it your own."
      className="template-library"
      onCancel={onClose}
      cancelLabel={false}
      cancelDisabled={busy}
      initialFocus={search}
    >
      <div className="template-gallery-layout">
        <aside className="template-sidebar">
          <nav aria-label="Template categories">
            {['All templates', 'My templates'].map((label) => (
              <button
                type="button"
                key={label}
                aria-pressed={category === label}
                onClick={() => setCategory(label)}
              >
                {label}
              </button>
            ))}
            <h3>Use cases</h3>
            {categories.map(({ label }) => (
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
          <div className="template-library-actions">
            <h3>Your templates</h3>
            <button
              type="button"
              disabled={
                busy ||
                (!Object.keys(current.objects).length &&
                  !Object.keys(current.connections).length)
              }
              onClick={() => {
                setAuthorDraft(undefined);
                setAuthoring('board');
              }}
            >
              Save board as template
            </button>
            <button
              type="button"
              disabled={busy || !selection.length}
              onClick={() => {
                setAuthorDraft(undefined);
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
                  aria-label={`Insert ${entry.document.extensions.template.name}`}
                  disabled={busy}
                  onClick={() => insert(entry.document)}
                >
                  Insert template
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </FormDialog>
  );
}

function TemplateAuthor({
  document,
  selection,
  personal,
  busy,
  libraryError,
  initial,
  onCancel,
  onSave,
}: {
  document: RecursiveDocument;
  selection?: string[];
  personal: TemplateEntry[];
  busy: boolean;
  libraryError: string;
  initial?: TemplateManifest;
  onCancel: () => void;
  onSave: (document: Template, expected?: string) => void;
}) {
  const [name, setName] = useState(
    initial?.name ??
      (selection?.length === 1 && selection[0].startsWith('object-')
        ? document.objects[selection[0].slice(7)].name
        : document.metadata.title),
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '');
  const [replacement, setReplacement] = useState(
    initial &&
      personal.some((e) => e.document.extensions.template.id === initial.id)
      ? initial.id
      : '',
  );
  const [error, setError] = useState('');
  return (
    <FormDialog
      title="Save template"
      description="Save an editable example to your personal gallery."
      submitDisabled={busy || !!libraryError}
      onCancel={onCancel}
      submitLabel={replacement ? 'Review replacement' : 'Review template'}
      onSubmit={() => {
        try {
          const existing = personal.find(
            (e) => e.document.extensions.template.id === replacement,
          );
          const manifest: TemplateManifest = {
            formatVersion: 1,
            id:
              existing?.document.extensions.template.id ?? crypto.randomUUID(),
            version: existing
              ? existing.document.extensions.template.version + 1
              : 1,
            name: name.trim(),
            description,
            tags: tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            guidance: '',
            components: [],
            excludedConnections: [],
          };
          onSave(
            createTemplate(document, manifest, selection),
            existing?.fingerprint,
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }}
    >
      <label className="form-dialog-field">
        Template name
        <input
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="form-dialog-field">
        Description
        <textarea
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="form-dialog-field">
        Tags (comma separated)
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      {!!personal.length && (
        <label className="form-dialog-field">
          Save as
          <select
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
          >
            <option value="">New template</option>
            {personal.map((entry) => (
              <option
                key={entry.document.extensions.template.id}
                value={entry.document.extensions.template.id}
              >
                Replace {entry.document.extensions.template.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {replacement && (
        <p>
          The saved template will be replaced. Objects on your boards will stay
          unchanged.
        </p>
      )}
      {busy && <p role="status">Loading personal templates…</p>}
      {(error || libraryError) && <p role="alert">{error || libraryError}</p>}
    </FormDialog>
  );
}
