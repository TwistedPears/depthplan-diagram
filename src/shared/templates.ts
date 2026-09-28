import { z } from 'zod';
import {
  createRecursiveDocument,
  validateRecursiveDocument,
  type Json,
  type RecursiveDocument,
} from './recursiveDocument';
import { duplicateSelection } from './recursiveDuplication';
import { copySelection, readSelection } from './recursiveClipboard';
import { indexHierarchy } from './recursiveHierarchy';
import { intersectsBounds, sceneBounds } from './recursiveCamera';
import { collapsedObjects, setCollapsedObjects } from './recursiveVisibility';
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

export function createTemplate(
  source: RecursiveDocument,
  manifest: TemplateManifest,
  selection?: string[],
): Template {
  const content = selection
    ? readSelection(copySelection(source, selection))!
    : source;
  const document = cleanDocument(content);
  document.extensions = {
    ...document.extensions,
    template: clone({
      ...manifest,
      excludedConnections: selection
        ? Object.values(source.connections)
            .filter(
              (connection) =>
                !Object.hasOwn(content.connections, connection.id) &&
                [connection.start, connection.end].some(
                  (end) =>
                    end.kind !== 'free' &&
                    Object.hasOwn(content.objects, end.objectId),
                ),
            )
            .map((connection) => connection.label || connection.id)
        : manifest.excludedConnections,
    }) as unknown as Json,
  };
  validateTemplate(document);
  return document;
}

/** Insert ordinary objects near the current view, clearing existing painted content. */
export function insertTemplate(
  source: Template,
  destination: RecursiveDocument,
  center = { x: 0, y: 0 },
) {
  validateTemplate(source);
  if (![center.x, center.y].every(Number.isFinite))
    throw new Error('Invalid insertion position.');
  const copy = duplicateSelection(
    source,
    [
      ...Object.keys(source.rootDepths).map((id) => `object-${id}`),
      ...Object.keys(source.connections).map((id) => `connection-${id}`),
    ],
    0,
  );
  const instance = createRecursiveDocument(
    crypto.randomUUID(),
    'Template sample',
  );
  copy.edit(instance);
  const original = sceneBounds(instance).bounds;
  if (!original) throw new Error('This template has no content to insert.');
  const bounds = {
    ...original,
    x: center.x - original.width / 2,
    y: center.y - original.height / 2,
  };
  const occupied = sceneBounds(destination);
  // ponytail: scan one row; use a 2D search only if closer placement is needed.
  for (const box of [
    ...occupied.objects.values(),
    ...occupied.connections.values(),
  ].sort((a, b) => a.x - b.x)) {
    if (
      intersectsBounds(bounds, {
        x: box.x - 48,
        y: box.y - 48,
        width: box.width + 96,
        height: box.height + 96,
      })
    )
      bounds.x = box.x + box.width + 48;
  }
  const dx = bounds.x - original.x,
    dy = bounds.y - original.y;
  for (const root of Object.keys(instance.rootDepths)) {
    instance.objects[root].geometry.x += dx;
    instance.objects[root].geometry.y += dy;
    for (const layout of Object.values(instance.layouts[root])) {
      layout[root].x += dx;
      layout[root].y += dy;
    }
  }
  for (const connection of Object.values(instance.connections)) {
    if (connection.ownerId !== null) continue;
    for (const endpoint of [connection.start, connection.end])
      if (endpoint.kind === 'free') {
        endpoint.x += dx;
        endpoint.y += dy;
      }
    for (const point of connection.points ?? []) {
      point.x += dx;
      point.y += dy;
    }
  }
  const edit: DocumentEdit = (draft) => {
    for (const collection of ['objects', 'connections'] as const) {
      for (const id of Object.keys(instance[collection]))
        if (Object.hasOwn(draft[collection], id))
          throw new Error('Duplicate instance ID.');
      Object.assign(draft[collection], clone(instance[collection]));
    }
    Object.assign(draft.rootDepths, clone(instance.rootDepths));
    Object.assign(draft.layouts, clone(instance.layouts));
    setCollapsedObjects(
      draft,
      new Set([...collapsedObjects(draft), ...collapsedObjects(instance)]),
    );
  };
  return { edit, selection: copy.selection, bounds };
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
