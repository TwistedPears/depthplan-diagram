import { z } from 'zod';
import {
  createRecursiveDocument,
  validateRecursiveDocument,
  type Json,
  type RecursiveDocument,
} from './recursiveDocument';
import { duplicateSelection, copyScope } from './recursiveDuplication';
import { indexHierarchy } from './recursiveHierarchy';
import { ensureDepthLayout } from './recursiveLayouts';
import { reparentLayouts, worldAt } from './recursiveReparent';
import { collapsedObjects, setCollapsedObjects } from './recursiveVisibility';
import { localPoint, worldPoint } from './connectionGeometry';
import type { DocumentEdit } from './documentTransactions';

const templateId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const templateName = z.string().min(1).max(120).regex(/\S/);
export const templateManifestSchema = z.strictObject({
  formatVersion: z.literal(1),
  id: templateId,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  name: templateName,
  description: z.string().max(4000),
  tags: z.array(z.string().max(80)).max(20),
  guidance: z.string().max(4000),
  author: z.string().max(200).optional(),
  license: z.string().max(200).optional(),
  components: z
    .array(
      z.strictObject({
        id: templateId,
        rootId: z.string().min(1),
        name: templateName,
        parentRole: z.string().max(200),
        guidance: z.string().max(4000),
      }),
    )
    .max(100),
  excludedConnections: z.array(z.string().max(256)).max(10000),
});
export type TemplateManifest = z.infer<typeof templateManifestSchema>;
export type Template = RecursiveDocument & {
  extensions: { template: TemplateManifest };
};
export type TemplateEntry = { document: Template; fingerprint: string };
export const templateByteLimit = 8 * 1024 * 1024;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
/** Template inputs have tighter limits than ordinary documents. No nested libraries. */
export function validateTemplate(value: unknown): asserts value is Template {
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > templateByteLimit
  )
    throw new Error('Template exceeds 8 MiB.');
  const pending: [unknown, number][] = [[value, 0]];
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (depth > 64) throw new Error('Template JSON exceeds 64 levels.');
    if (item && typeof item === 'object')
      for (const v of Object.values(item)) pending.push([v, depth + 1]);
  }
  validateRecursiveDocument(value);
  const parsed = templateManifestSchema.safeParse(value.extensions?.template);
  if (!parsed.success)
    throw new Error(
      'Invalid or unsupported template manifest (expected version 1).',
    );
  const manifest = parsed.data;
  const ids = new Set<string>();
  for (const c of manifest.components) {
    if (ids.has(c.id) || !Object.hasOwn(value.objects, c.rootId))
      throw new Error('Invalid reusable component.');
    ids.add(c.id);
  }
  if (
    Object.keys(value.objects).length > 5000 ||
    Object.keys(value.connections).length > 10000 ||
    [...indexHierarchy(value.objects).entries.values()].some(
      (e) => e.generation > 64,
    ) ||
    Object.values(value.layouts).some(
      (layouts) => Object.keys(layouts).length > 128,
    )
  )
    throw new Error(
      'Template exceeds object, connection, hierarchy or layout limits.',
    );
  for (const folds of [
    value.extensions?.collapsedObjects,
    ...Object.values(value.namedViews ?? {}).map(
      (v) => v.metadata?.collapsedObjects,
    ),
  ])
    if (
      folds !== undefined &&
      (!Array.isArray(folds) ||
        !folds.every(
          (key) => typeof key === 'string' && Object.hasOwn(value.objects, key),
        ))
    )
      throw new Error('Invalid template fold references.');
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'formatVersion',
          'id',
          'metadata',
          'objects',
          'rootDepths',
          'layouts',
          'connections',
          'namedViews',
          'extensions',
        ].includes(key),
    ) ||
    value.connectionRepairs ||
    Object.keys(value.extensions ?? {}).some(
      (key) => !['template', 'collapsedObjects'].includes(key),
    ) ||
    Object.values(value.namedViews ?? {}).some((view) =>
      Object.keys(view.metadata ?? {}).some(
        (key) => key !== 'collapsedObjects',
      ),
    ) ||
    Object.keys(value.metadata).some(
      (key) => !['title', 'created', 'modified'].includes(key),
    )
  )
    throw new Error(
      'Template contains source/session metadata. Create a clean template before sharing.',
    );
}

/** Whitelist document metadata; content links remain visible in the sharing review. */
function cleanDocument(source: RecursiveDocument): RecursiveDocument {
  const document: RecursiveDocument = {
    ...createRecursiveDocument(source.id, source.metadata.title),
    objects: clone(source.objects),
    rootDepths: clone(source.rootDepths),
    layouts: clone(source.layouts),
    connections: clone(source.connections),
    ...(source.namedViews ? { namedViews: clone(source.namedViews) } : {}),
    extensions: {},
  };
  setCollapsedObjects(document, collapsedObjects(source));
  if (document.namedViews)
    for (const view of Object.values(document.namedViews)) {
      const saved = view.metadata?.collapsedObjects;
      delete view.metadata;
      if (Array.isArray(saved))
        view.metadata = {
          collapsedObjects: saved.filter(
            (v) => typeof v === 'string' && Object.hasOwn(document.objects, v),
          ),
        };
    }
  return document;
}

/** Extract every descendant and depth, including a selected object hidden by its ancestors. */
export function templateComponent(source: RecursiveDocument, rootId: string) {
  const { members, hierarchy } = copyScope(source, [`object-${rootId}`]);
  const entry = hierarchy.entries.get(rootId);
  if (!entry) throw new Error('Component no longer exists.');
  const document = cleanDocument(source);
  const excluded: string[] = [];
  const origin = worldAt(
    source,
    entry.root,
    source.rootDepths[entry.root],
    rootId,
  );
  for (const c of Object.values(document.connections)) {
    const ends = [c.start, c.end];
    const touches =
      ends.some((end) => end.kind !== 'free' && members.has(end.objectId)) ||
      members.has(c.ownerId ?? '');
    const internal =
      ends.every((end) => end.kind === 'free' || members.has(end.objectId)) &&
      (members.has(c.ownerId ?? '') ||
        ends.every((end) => end.kind !== 'free' && members.has(end.objectId)));
    if (!internal) {
      if (touches) excluded.push(c.label || c.id);
      delete document.connections[c.id];
    } else if (!members.has(c.ownerId ?? '')) {
      const owner =
        c.ownerId === null
          ? undefined
          : worldAt(
              source,
              entry.root,
              source.rootDepths[entry.root],
              c.ownerId,
            );
      const point = (p: { x: number; y: number }) =>
        localPoint(worldPoint(p, owner), origin);
      c.ownerId = rootId;
      if (c.points) c.points = c.points.map(point);
    }
  }
  document.objects = Object.fromEntries(
    [...members].map((key) => [key, document.objects[key]]),
  );
  document.objects[rootId].parentId = null;
  document.objects[rootId].geometry = {
    ...document.objects[rootId].geometry,
    x: 0,
    y: 0,
  };
  document.rootDepths = {
    [rootId]: Math.max(0, source.rootDepths[entry.root] - entry.generation),
  };
  document.layouts = { [rootId]: {} };
  for (const [depth, layout] of Object.entries(source.layouts[entry.root]).sort(
    ([a], [b]) => Number(a) - Number(b),
  )) {
    const mapped = Math.max(0, Number(depth) - entry.generation);
    document.layouts[rootId][mapped] = Object.fromEntries(
      Object.entries(layout)
        .filter(([key]) => members.has(key))
        .map(([key, g]) => [
          key,
          { ...g, ...(key === rootId ? { x: 0, y: 0 } : {}) },
        ]),
    );
  }
  for (const depth of new Set([
    0,
    document.rootDepths[rootId],
    ...Object.keys(document.layouts[rootId]).map(Number),
  ]))
    ensureDepthLayout(document, rootId, depth);
  delete document.namedViews;
  setCollapsedObjects(
    document,
    new Set([...collapsedObjects(source)].filter((key) => members.has(key))),
  );
  validateRecursiveDocument(document);
  return { document, excluded };
}

export function createTemplate(
  source: RecursiveDocument,
  manifest: TemplateManifest,
  rootId?: string,
): Template {
  const scope = rootId ? templateComponent(source, rootId) : null;
  const document = scope?.document ?? cleanDocument(source);
  document.extensions = {
    ...document.extensions,
    template: clone({
      ...manifest,
      excludedConnections: scope?.excluded ?? manifest.excludedConnections,
    }) as unknown as Json,
  };
  validateTemplate(document);
  return document;
}

export function retainedTemplates(document: RecursiveDocument): Template[] {
  const sources = document.extensions?.templateSources ?? [];
  if (!Array.isArray(sources) || sources.length > 100)
    throw new Error('Invalid retained template library.');
  sources.forEach(validateTemplate);
  return sources as unknown as Template[];
}
function retain(document: RecursiveDocument, template: Template) {
  const sources = retainedTemplates(document);
  const m = template.extensions.template;
  const existing = sources.find(
    (s) =>
      s.extensions.template.id === m.id &&
      s.extensions.template.version === m.version,
  );
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(template))
      throw new Error(
        'This template version conflicts with the copy retained in the document. Import it as a separate copy.',
      );
    return;
  }
  if (sources.length >= 100)
    throw new Error('A document can retain up to 100 template versions.');
  document.extensions = {
    ...document.extensions,
    templateSources: [...sources, clone(template)] as unknown as Json,
  };
}

export function newFromTemplate(source: Template): RecursiveDocument {
  validateTemplate(source);
  const document = createRecursiveDocument(
    crypto.randomUUID(),
    source.extensions.template.name,
  );
  const copy = duplicateSelection(
    source,
    [
      ...Object.keys(source.rootDepths).map((key) => `object-${key}`),
      ...Object.keys(source.connections).map((key) => `connection-${key}`),
    ],
    0,
  );
  copy.edit(document);
  const remap = (key: string) => copy.objects.get(key);
  document.namedViews = {};
  for (const view of Object.values(source.namedViews ?? {})) {
    const id = crypto.randomUUID();
    document.namedViews[id] = {
      ...clone(view),
      id,
      rootDepths: Object.fromEntries(
        Object.entries(view.rootDepths)
          .filter(([key]) => remap(key))
          .map(([key, depth]) => [remap(key)!, depth]),
      ),
      ...(view.layouts
        ? {
            layouts: Object.fromEntries(
              Object.entries(view.layouts)
                .filter(([root]) => remap(root))
                .map(([root, layout]) => [
                  remap(root)!,
                  Object.fromEntries(
                    Object.entries(layout)
                      .filter(([key]) => remap(key))
                      .map(([key, g]) => [
                        remap(key)!,
                        {
                          ...g,
                          parentId:
                            g.parentId === null
                              ? null
                              : (remap(g.parentId) ?? null),
                        },
                      ]),
                  ),
                ]),
            ),
          }
        : {}),
      metadata: {
        collapsedObjects: (
          (view.metadata?.collapsedObjects as string[]) ?? []
        ).flatMap((key) => (remap(key) ? [remap(key)!] : [])),
      },
    };
  }
  retain(document, source);
  validateRecursiveDocument(document);
  return document;
}

export function insertTemplate(
  source: Template,
  componentId: string,
  parentId: string | null,
  point = { x: 24, y: 24 },
) {
  validateTemplate(source);
  const component = source.extensions.template.components.find(
    (c) => c.id === componentId,
  );
  if (!component) throw new Error('Select an available component.');
  const extracted = templateComponent(source, component.rootId);
  const copy = duplicateSelection(
    extracted.document,
    [`object-${component.rootId}`],
    0,
  );
  const instance = createRecursiveDocument(crypto.randomUUID(), 'Component');
  copy.edit(instance);
  const root = copy.objects.get(component.rootId)!;
  const edit: DocumentEdit = (draft) => {
    if (parentId !== null && !Object.hasOwn(draft.objects, parentId))
      throw new Error('Destination no longer exists.');
    if (![point.x, point.y].every(Number.isFinite))
      throw new Error('Invalid insertion position.');
    const depths = { ...draft.rootDepths };
    const archive = draft.extensions?.layoutArchive;
    for (const collection of ['objects', 'connections'] as const)
      for (const key of Object.keys(instance[collection]))
        if (Object.hasOwn(draft[collection], key))
          throw new Error('Duplicate instance ID.');
    Object.assign(draft.objects, clone(instance.objects));
    Object.assign(draft.connections, clone(instance.connections));
    Object.assign(draft.rootDepths, clone(instance.rootDepths));
    Object.assign(draft.layouts, clone(instance.layouts));
    setCollapsedObjects(
      draft,
      new Set([...collapsedObjects(draft), ...collapsedObjects(instance)]),
    );
    if (parentId !== null) reparentLayouts(root, parentId)(draft);
    const hierarchy = indexHierarchy(draft.objects);
    const target = hierarchy.entries.get(root)!;
    // Incoming top-level geometry is relative to the destination, even when rotated or hidden.
    draft.objects[root].geometry = {
      ...extracted.document.objects[component.rootId].geometry,
      ...point,
    };
    for (const [depth, layout] of Object.entries(draft.layouts[target.root])) {
      if (!layout[root]) continue;
      const localDepth = Math.max(0, Number(depth) - target.generation);
      const authored =
        extracted.document.layouts[component.rootId][localDepth]?.[
          component.rootId
        ] ?? extracted.document.objects[component.rootId].geometry;
      layout[root] = { ...authored, ...point };
    }
    Object.assign(draft.rootDepths, depths);
    if (draft.extensions) {
      if (archive === undefined) delete draft.extensions.layoutArchive;
      else draft.extensions.layoutArchive = archive;
    }
    retain(draft, source);
  };
  return {
    edit,
    selection: copy.selection,
    rootId: root,
    excluded: extracted.excluded,
  };
}

export function templateLinks(document: RecursiveDocument): string[] {
  const links = new Set<string>();
  JSON.stringify(document.objects, (key, value) => {
    if (key === 'link' && typeof value === 'string') links.add(value);
    if (key === 'projectLink')
      links.add(`Project link: ${JSON.stringify(value)}`);
    return value;
  });
  return [...links];
}
