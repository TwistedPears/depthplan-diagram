import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import FormDialog from './FormDialog';
import RecursiveScene from './RecursiveScene';
import type useDocumentState from '../hooks/useDocumentState';
import { bundledTemplates } from '../../shared/bundledTemplates';
import {
  createTemplate,
  insertTemplate,
  retainedTemplates,
  templateComponent,
  templateLinks,
  templateManifestSchema,
  type Template,
  type TemplateEntry,
  type TemplateManifest,
} from '../../shared/templates';
import { type RecursiveDocument } from '../../shared/recursiveDocument';
import { recursiveScene } from '../../shared/recursiveScene';
import { fitCamera, sceneBounds } from '../../shared/recursiveCamera';
import { selectRootDepth } from '../../shared/recursiveLayouts';
import { editNamedView, resolveNamedViewCamera } from '../../shared/namedViews';
import { transactDocument } from '../../shared/documentTransactions';

function Preview({
  document,
  view,
}: {
  document: RecursiveDocument;
  view: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(1, entry.contentRect.width)),
    );
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, []);
  const scene = useMemo(() => recursiveScene(document), [document]);
  const camera =
    resolveNamedViewCamera(document.namedViews?.[view], {
      width,
      height: 300,
    }) ??
    fitCamera(sceneBounds(document, scene).bounds, { width, height: 300 }, 24);
  return (
    <div
      ref={container}
      className="template-preview"
      role="img"
      aria-label={`Preview of ${document.metadata.title}`}
    >
      <Stage
        width={width}
        height={300}
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
  onClose,
  onOpen,
  onStatus,
}: {
  owner: ReturnType<typeof useDocumentState>;
  onClose: () => void;
  onOpen: (document: Template, editing: boolean) => void;
  onStatus: (message: string) => void;
}) {
  const current = owner.document!;
  const [personal, setPersonal] = useState<TemplateEntry[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('bundled:bundled-erd');
  const [componentId, setComponentId] = useState('');
  const [view, setView] = useState('authored');
  const selectedObject = owner.canvas.selected.filter((key) =>
    key.startsWith('object-'),
  );
  const selection =
    selectedObject.length === 1 &&
    Object.hasOwn(current.objects, selectedObject[0].slice(7))
      ? selectedObject[0].slice(7)
      : '';
  const [parent, setParent] = useState(selection);
  const [inserted, setInserted] = useState('');
  const [authoring, setAuthoring] = useState<'document' | 'component' | null>(
    null,
  );
  const [authorDraft, setAuthorDraft] = useState<
    TemplateManifest | undefined
  >();
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
    if (result.warnings.length) setNotice(result.warnings.join('\n'));
  };
  useEffect(() => {
    owner.setBusy('templates', true);
    void run(refresh);
    return () => owner.setBusy('templates', false);
    // One library instance belongs to one editor session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const retained = useMemo(() => {
    try {
      return { sources: retainedTemplates(current), error: '' };
    } catch (e) {
      return { sources: [], error: String(e) };
    }
  }, [current]);
  const entries = [
    ...bundledTemplates.map((document) => ({
      key: `bundled:${document.extensions.template.id}`,
      document,
      label: 'Bundled',
      fingerprint: '',
    })),
    ...personal.map((entry) => ({
      ...entry,
      key: `personal:${entry.document.extensions.template.id}`,
      label: 'Personal',
    })),
    ...retained.sources.map((document) => ({
      key: `document:${document.extensions.template.id}:${document.extensions.template.version}`,
      document,
      label: 'In this document',
      fingerprint: '',
    })),
  ];
  const active = entries.find((e) => e.key === selected);
  const template = active?.document;
  const manifest = template?.extensions.template;
  const component = manifest?.components.find((c) => c.id === componentId);
  const preview = useMemo(() => {
    if (!template) return null;
    const source = component
      ? templateComponent(template, component.rootId).document
      : template;
    const result = transactDocument(source, (draft) => {
      if (view === 'collapsed' || view === 'expanded')
        for (const root of Object.keys(draft.rootDepths))
          selectRootDepth(root, view === 'collapsed' ? 0 : 'all')(draft);
      else if (view !== 'authored' && !component)
        editNamedView({ type: 'apply', id: view })(draft);
    });
    return result.document;
  }, [template, component, view]);
  const capture = (document: Template, expected?: string) => {
    setAuthorDraft(document.extensions.template);
    setReview({ document, expected, action: 'save' });
  };
  const duplicate =
    review &&
    entries.some(
      (e) =>
        e.document.extensions.template.id ===
        review.document.extensions.template.id,
    );
  if (review) {
    const m = review.document.extensions.template;
    const links = templateLinks(review.document);
    return (
      <FormDialog
        title={
          review.action === 'export' ? 'Export template' : 'Review template'
        }
        description="Review the portable content before continuing."
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
              let document = review.document;
              if (review.action === 'import' && duplicate)
                document = createTemplate(document, {
                  ...m,
                  id: crypto.randomUUID(),
                  version: 1,
                  name: `${m.name} copy`,
                });
              const saved = await window.desktop.templates.save(
                document,
                review.expected,
              );
              await refresh();
              setSelected(`personal:${saved.document.extensions.template.id}`);
              setComponentId('');
              setView('authored');
            }
            setReview(null);
            setAuthoring(null);
            setNotice(
              review.action === 'export'
                ? 'Template exported.'
                : 'Template saved to your library. Existing instances are unchanged.',
            );
          })
        }
      >
        <p>
          <strong>{m.name}</strong> · version {m.version} ·{' '}
          {Object.keys(review.document.objects).length} objects ·{' '}
          {Object.keys(review.document.connections).length} connections ·{' '}
          {Object.keys(review.document.namedViews ?? {}).length} bookmarks
        </p>
        <p>{m.description}</p>
        <p>{m.guidance}</p>
        <p>
          Reusable components:{' '}
          {m.components.map((c) => c.name).join(', ') || 'None'}
        </p>
        <p>
          Excluded connections: {m.excludedConnections.join(', ') || 'None'}
        </p>
        <p>Content links: {links.join(', ') || 'None'}</p>
        {review.action === 'import' && duplicate && (
          <p>
            A template with this ID is already available. Import creates a
            separate copy with a new ID; it will not replace your entry.
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
        rootId={authoring === 'component' ? selection : undefined}
        personal={personal}
        initial={authorDraft}
        onCancel={() => setAuthoring(null)}
        onSave={capture}
      />
    );
  if (removing)
    return (
      <FormDialog
        title="Remove personal template"
        description={`Remove ${removing.document.extensions.template.name} from this library? Placed objects and definitions retained in documents stay available.`}
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
            setSelected('bundled:bundled-erd');
            setComponentId('');
          })
        }
      >
        {error && <p role="alert">{error}</p>}
      </FormDialog>
    );
  return (
    <FormDialog
      title="Templates"
      className="template-library"
      description="Start a diagram or add an independent component. Personal copies stay on this computer; portable files can be shared."
      onCancel={onClose}
      cancelDisabled={busy}
    >
      <div className="form-dialog-inline-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setAuthorDraft(undefined);
            setAuthoring('document');
          }}
        >
          Create from document
        </button>
        <button
          type="button"
          disabled={busy || !selection}
          onClick={() => {
            setAuthorDraft(undefined);
            setAuthoring('component');
          }}
        >
          Create from selection
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
      <label className="form-dialog-field">
        Filter by name or tag
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label className="form-dialog-field">
        Template
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setComponentId('');
            setView('authored');
          }}
        >
          <option value="">Choose a template</option>
          {entries
            .filter((e) =>
              `${e.document.extensions.template.name} ${e.document.extensions.template.tags.join(' ')}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((e) => (
              <option key={e.key} value={e.key}>
                {e.label} · {e.document.extensions.template.name} · v
                {e.document.extensions.template.version}
              </option>
            ))}
        </select>
      </label>
      {template && manifest && (
        <>
          <p>{manifest.description}</p>
          <div className="template-controls">
            <label className="form-dialog-field">
              Reusable component
              <select
                value={componentId}
                onChange={(e) => {
                  setComponentId(e.target.value);
                  setView('authored');
                }}
              >
                <option value="">Whole starter diagram</option>
                {manifest.components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-dialog-field">
              Preview view
              <select value={view} onChange={(e) => setView(e.target.value)}>
                <option value="authored">As authored</option>
                <option value="collapsed">Collapsed</option>
                <option value="expanded">Expanded</option>
                {!component &&
                  Object.values(template.namedViews ?? {}).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {preview && <Preview document={preview} view={view} />}
          <p>{component?.guidance ?? manifest.guidance}</p>
          {component && (
            <>
              <p>
                Recommended parent:{' '}
                {component.parentRole || 'Any canvas or parent'}. You can use
                any destination.
              </p>
              <p>
                Excluded external connections:{' '}
                {templateComponent(template, component.rootId).excluded.join(
                  ', ',
                ) || 'None'}
              </p>
              <label className="form-dialog-field">
                Destination
                <select
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                >
                  <option value="">Canvas</option>
                  {Object.values(current.objects).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name || o.type} ({o.id.slice(0, 8)})
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <div className="form-dialog-inline-actions">
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => {
                if (!component) {
                  onOpen(template, false);
                  return;
                }
                try {
                  const count = Object.values(current.objects).filter(
                    (o) => o.parentId === (parent || null),
                  ).length;
                  const point = parent
                    ? { x: 24 + count * 24, y: 24 + count * 24 }
                    : {
                        x:
                          (owner.canvas.viewport.width / 2 - owner.camera.x) /
                            owner.camera.scale +
                          count * 24,
                        y:
                          (owner.canvas.viewport.height / 2 - owner.camera.y) /
                            owner.camera.scale +
                          count * 24,
                      };
                  const insertion = insertTemplate(
                    template,
                    component.id,
                    parent || null,
                    point,
                  );
                  const result = owner.transact(insertion.edit);
                  if (result?.status === 'rejected')
                    throw new Error(result.error);
                  owner.setCanvas((canvas) => ({
                    ...canvas,
                    selected: insertion.selection,
                    selectedPoint: null,
                    tool: 'pointer',
                  }));
                  setInserted(insertion.rootId);
                  setNotice(
                    'Component added. Reveal it to open its ancestors and focus the new item.',
                  );
                  setError('');
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {component ? 'Add component' : 'New from template'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpen(template, true)}
            >
              {active?.label === 'Personal'
                ? 'Edit template'
                : 'Customize a copy'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setReview({ document: template, action: 'export' })
              }
            >
              Export template
            </button>
            {active?.label === 'Personal' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setRemoving(active)}
              >
                Remove
              </button>
            )}
            {inserted && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  owner.setBusy('templates', false);
                  onClose();
                  try {
                    owner.focusEntity('objects', inserted);
                  } catch (e) {
                    onStatus(String(e));
                  }
                }}
              >
                Reveal inserted item
              </button>
            )}
          </div>
        </>
      )}
      {(error || retained.error) && (
        <p role="alert">{error || retained.error}</p>
      )}
      {notice && <p role="status">{notice}</p>}
    </FormDialog>
  );
}

function TemplateAuthor({
  document,
  rootId,
  personal,
  initial,
  onCancel,
  onSave,
}: {
  document: RecursiveDocument;
  rootId?: string;
  personal: TemplateEntry[];
  initial?: TemplateManifest;
  onCancel: () => void;
  onSave: (document: Template, expected?: string) => void;
}) {
  const parsed = templateManifestSchema.safeParse(
    document.extensions?.template,
  );
  const original = !rootId && parsed.success ? parsed.data : undefined;
  const existing = personal.find(
    (entry) => entry.document.extensions.template.id === original?.id,
  );
  const values = initial ?? original;
  const [name, setName] = useState(
    values?.name ??
      (rootId ? document.objects[rootId].name : document.metadata.title),
  );
  const [description, setDescription] = useState(values?.description ?? '');
  const [guidance, setGuidance] = useState(values?.guidance ?? '');
  const [tags, setTags] = useState(values?.tags.join(', ') ?? '');
  const [components, setComponents] = useState<TemplateManifest['components']>(
    values?.components ??
      (rootId
        ? [
            {
              id: crypto.randomUUID(),
              rootId,
              name: document.objects[rootId].name || 'Component',
              parentRole: '',
              guidance: '',
            },
          ]
        : []),
  );
  const [pattern, setPattern] = useState('');
  const [error, setError] = useState('');
  const scope = rootId
    ? templateComponent(document, rootId).document
    : document;
  const save = (update: boolean) => {
    try {
      const manifest: TemplateManifest = {
        formatVersion: 1,
        id: update ? original!.id : crypto.randomUUID(),
        version: update
          ? existing!.document.extensions.template.version + 1
          : 1,
        name: name.trim(),
        description,
        guidance,
        tags: tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        components,
        excludedConnections: original?.excludedConnections ?? [],
        ...(original?.author ? { author: original.author } : {}),
        ...(original?.license ? { license: original.license } : {}),
      };
      onSave(
        createTemplate(document, manifest, rootId),
        update ? existing!.fingerprint : undefined,
      );
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <FormDialog
      title="Create or update template"
      description="Include the complete document or selected subtree, even hidden children. Choose authored examples to make reusable components."
      onCancel={onCancel}
      submitLabel="Save personal copy"
      onSubmit={() => save(false)}
      actions={
        existing && (
          <button type="button" onClick={() => save(true)}>
            Update library entry
          </button>
        )
      }
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
        How to add another item
        <textarea
          maxLength={4000}
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
        />
      </label>
      <label className="form-dialog-field">
        Tags (comma separated)
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <label className="form-dialog-field">
        Example object
        <select value={pattern} onChange={(e) => setPattern(e.target.value)}>
          <option value="">Choose an example</option>
          {Object.values(scope.objects)
            .filter((o) => !components.some((c) => c.rootId === o.id))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name || o.type}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!pattern}
        onClick={() => {
          setComponents([
            ...components,
            {
              id: crypto.randomUUID(),
              rootId: pattern,
              name: document.objects[pattern].name || 'Component',
              parentRole: '',
              guidance: '',
            },
          ]);
          setPattern('');
        }}
      >
        Add reusable pattern
      </button>
      {components.map((c, i) => (
        <fieldset key={c.id}>
          <legend>{c.name}</legend>
          {(['name', 'parentRole', 'guidance'] as const).map((key) => (
            <label className="form-dialog-field" key={key}>
              {key === 'parentRole'
                ? 'Recommended parent'
                : key === 'guidance'
                  ? 'Naming and usage guidance'
                  : 'Component name'}
              <input
                value={c[key]}
                onChange={(e) =>
                  setComponents(
                    components.map((item, n) =>
                      n === i ? { ...item, [key]: e.target.value } : item,
                    ),
                  )
                }
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => setComponents(components.filter((_, n) => n !== i))}
          >
            Remove pattern
          </button>
        </fieldset>
      ))}
      {error && <p role="alert">{error}</p>}
    </FormDialog>
  );
}
