import { type DocumentEdit } from './documentTransactions';
import {
  type RecursiveDocument,
  type Geometry,
  type Json,
  validateGeometry,
  isRecord,
} from './recursiveDocument';
import {
  indexHierarchy,
  toWorldGeometry,
  toLocalGeometry,
} from './recursiveHierarchy';
import { ensureDepthLayout } from './recursiveLayouts';

type Layout = Record<string, Geometry>;
interface Archive {
  moveId: string;
  sourceRootId: string;
  sourceDepth: number;
  subtreeRootId: string;
  sourceParentId: string | null;
  destinationParentId: string | null;
  geometry: Layout;
  seed: Geometry;
  destinationRootId: string;
  destinationDepth: number | null;
  createdLayout?: Layout;
}
function archives(document: RecursiveDocument): Archive[] {
  const value = document.extensions?.layoutArchive ?? [];
  if (!Array.isArray(value)) throw new Error('Invalid layout archive');
  for (const r of value) {
    if (
      !isRecord(r) ||
      typeof r.moveId !== 'string' ||
      typeof r.sourceRootId !== 'string' ||
      typeof r.destinationRootId !== 'string' ||
      typeof r.subtreeRootId !== 'string' ||
      !(r.sourceParentId === null || typeof r.sourceParentId === 'string') ||
      !(
        r.destinationParentId === null ||
        typeof r.destinationParentId === 'string'
      ) ||
      !Number.isSafeInteger(r.sourceDepth) ||
      Number(r.sourceDepth) < 0 ||
      !(
        r.destinationDepth === null ||
        (Number.isSafeInteger(r.destinationDepth) &&
          Number(r.destinationDepth) >= 0)
      ) ||
      !isRecord(r.geometry)
    )
      throw new Error('Invalid layout archive record');
    validateGeometry(r.seed);
    for (const g of Object.values(r.geometry)) validateGeometry(g);
    if (r.createdLayout !== undefined) {
      if (!isRecord(r.createdLayout))
        throw new Error('Invalid archived layout');
      for (const g of Object.values(r.createdLayout)) validateGeometry(g);
    }
  }
  return value as unknown as Archive[];
}
export function worldAt(
  document: RecursiveDocument,
  root: string,
  depth: number,
  id: string,
): Geometry {
  const chain: string[] = [];
  for (
    let cursor: string | null = id;
    cursor !== null;
    cursor = document.objects[cursor].parentId
  )
    chain.push(cursor);
  const depths = Object.keys(document.layouts[root])
    .map(Number)
    .sort((a, b) => Math.abs(a - depth) - Math.abs(b - depth) || a - b);
  let world: Geometry | undefined;
  for (const cursor of chain.reverse()) {
    const nearest = depths.find((d) =>
      Object.hasOwn(document.layouts[root][d], cursor),
    );
    const g =
      nearest === undefined
        ? document.objects[cursor].geometry
        : document.layouts[root][nearest][cursor];
    world = world ? toWorldGeometry(g, world) : { ...g };
  }
  return world!;
}
const copyLayout = (layout: Layout): Layout =>
  Object.fromEntries(Object.entries(layout).map(([id, g]) => [id, { ...g }]));

/** Ownership plus every saved arrangement, atomically. Gesture/reference repair is layered by callers. */
export function reparentLayouts(
  id: string,
  parentId: string | null,
): DocumentEdit {
  const moveId = crypto.randomUUID();
  return (draft) => {
    const before = indexHierarchy(draft.objects);
    const entry = before.entries.get(id);
    if (!entry || (parentId !== null && !before.entries.has(parentId)))
      throw new Error('Missing reparent target');
    const oldParent = draft.objects[id].parentId;
    if (oldParent === parentId) return;
    const subtree = new Set([id]);
    for (const member of subtree)
      for (const child of before.children.get(member) ?? []) subtree.add(child);
    if (parentId !== null && subtree.has(parentId))
      throw new Error('Containment cycle');
    const sourceRoot = entry.root;
    const destinationRoot =
      parentId === null ? id : before.entries.get(parentId)!.root;
    const newGeneration =
      parentId === null ? 0 : before.entries.get(parentId)!.generation + 1;
    const selected = draft.rootDepths[sourceRoot];
    const source = draft.layouts[sourceRoot];
    const seed = { ...draft.objects[id].geometry };
    const activeWorld = worldAt(draft, sourceRoot, selected, id);
    const oldArchive = archives(draft);
    const inverse = oldArchive
      .filter(
        (r) =>
          r.subtreeRootId === id &&
          r.sourceParentId === parentId &&
          r.destinationParentId === oldParent &&
          r.sourceRootId === destinationRoot &&
          r.destinationRootId === sourceRoot,
      )
      .at(-1);
    const restoring = inverse
      ? oldArchive.filter((r) => r.moveId === inverse.moveId)
      : [];
    const archive = oldArchive.filter((r) => !restoring.includes(r));
    const records = Object.entries(source).map(([depth, layout]) => {
      const geometry = Object.fromEntries(
        Object.entries(layout)
          .filter(([key]) => subtree.has(key))
          .map(([key, g]) => [key, { ...g }]),
      );
      return {
        depth: Number(depth),
        geometry,
        world: geometry[id]
          ? worldAt(draft, sourceRoot, Number(depth), id)
          : undefined,
      };
    });
    // Source records are retained as provenance, including hidden and negative mappings.
    for (const layout of Object.values(source))
      for (const member of subtree) delete layout[member];
    for (const record of restoring) {
      if (record.createdLayout && record.destinationDepth !== null) {
        const current = source[record.destinationDepth];
        const base = Object.fromEntries(
          Object.entries(record.createdLayout).filter(
            ([key]) => !subtree.has(key),
          ),
        );
        if (current && JSON.stringify(current) === JSON.stringify(base))
          delete source[record.destinationDepth];
      }
    }
    draft.objects[id].parentId = parentId;
    if (id === sourceRoot) {
      delete draft.layouts[sourceRoot];
      delete draft.rootDepths[sourceRoot];
    }
    if (parentId === null) {
      draft.layouts[id] = { 0: { [id]: { ...activeWorld } } };
      draft.rootDepths[id] = Math.max(0, selected - entry.generation);
    }
    const after = indexHierarchy(draft.objects);
    for (const { depth, geometry, world } of records) {
      if (!Object.keys(geometry).length) continue;
      const mapped = depth - entry.generation + newGeneration;
      const record: Archive = {
        moveId,
        sourceRootId: sourceRoot,
        sourceDepth: depth,
        subtreeRootId: id,
        sourceParentId: oldParent,
        destinationParentId: parentId,
        geometry,
        seed,
        destinationRootId: destinationRoot,
        destinationDepth: mapped < 0 ? null : mapped,
      };
      archive.push(record);
      if (mapped < 0 || restoring.length) continue;
      const created = !Object.hasOwn(draft.layouts[destinationRoot], mapped);
      const destination = ensureDepthLayout(draft, destinationRoot, mapped);
      if (created) record.createdLayout = copyLayout(destination);
      const incoming = copyLayout(geometry);
      if (world)
        incoming[id] =
          parentId === null
            ? world
            : toLocalGeometry(
                world,
                worldAt(draft, destinationRoot, mapped, parentId),
              );
      Object.assign(destination, incoming);
    }
    for (const record of restoring) {
      const destination = ensureDepthLayout(
        draft,
        destinationRoot,
        record.sourceDepth,
      );
      for (const [member, g] of Object.entries(record.geometry))
        if (subtree.has(member)) destination[member] = { ...g };
    }
    draft.rootDepths[destinationRoot] = Math.max(
      draft.rootDepths[destinationRoot],
      newGeneration,
    );
    for (const root of new Set([sourceRoot, destinationRoot])) {
      if (!after.maximum.has(root)) continue;
      draft.rootDepths[root] = Math.min(
        draft.rootDepths[root],
        after.maximum.get(root)!,
      );
      ensureDepthLayout(draft, root, 0);
      ensureDepthLayout(draft, root, draft.rootDepths[root]);
      for (const depth of Object.keys(draft.layouts[root]))
        ensureDepthLayout(draft, root, Number(depth));
    }
    const targetLayout =
      draft.layouts[destinationRoot][draft.rootDepths[destinationRoot]];
    // Seeds also change coordinate basis; inverse provenance avoids floating-point drift.
    draft.objects[id].geometry = inverse
      ? { ...inverse.seed }
      : { ...targetLayout[id] };
    draft.extensions = {
      ...draft.extensions,
      layoutArchive: archive as unknown as Json,
    };
  };
}

/** Deleted IDs must not reappear through a later inverse move. */
export function pruneLayoutArchive(
  document: RecursiveDocument,
  deleted: Set<string>,
) {
  if (!document.extensions?.layoutArchive || !deleted.size) return;
  const records = archives(document).filter(
    (record) =>
      ![
        record.sourceRootId,
        record.destinationRootId,
        record.subtreeRootId,
        record.sourceParentId,
        record.destinationParentId,
      ].some((id) => id !== null && deleted.has(id)),
  );
  for (const record of records)
    for (const layout of [record.geometry, record.createdLayout])
      if (layout) for (const id of deleted) delete layout[id];
  document.extensions.layoutArchive = records as unknown as Json;
}
