import {
  type RecursiveDocument,
  type Geometry,
  isRecord,
  validId,
} from './recursiveDocument';
import { indexHierarchy } from './recursiveHierarchy';
import { recursiveVisibility } from './recursiveVisibility';

type Placement = Pick<Geometry, 'x' | 'y'> &
  Partial<Pick<Geometry, 'width' | 'height'>> & {
    parentId: string | null;
  };
type Arrangement = {
  context: string;
  expanded: string[];
  objects: Record<string, Placement>;
};
type ExpansionLayouts = {
  version: 2;
  depths: Record<string, number>;
  states: Record<string, Arrangement>;
  displaced: Record<string, string[]>;
};

// Like the reparent archive, this optional extension is checked when consumed.
// Unknown JSON extensions continue to round-trip through native file validation.
function memory(document: RecursiveDocument): ExpansionLayouts | undefined {
  const value = document.extensions?.expansionLayouts;
  if (value === undefined) return undefined;
  const invalid = () => {
    throw new Error('Invalid expansion layouts');
  };
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !isRecord(value.depths) ||
    !isRecord(value.states)
  )
    return invalid();
  for (const [id, depth] of Object.entries(value.depths))
    if (!validId(id) || !Number.isSafeInteger(depth) || Number(depth) < 0)
      invalid();
  for (const [key, state] of Object.entries(value.states)) {
    if (
      !isRecord(state) ||
      typeof state.context !== 'string' ||
      !Array.isArray(state.expanded) ||
      !state.expanded.every(validId) ||
      !isRecord(state.objects) ||
      key !== JSON.stringify([state.context, state.expanded])
    )
      return invalid();
    for (const [id, g] of Object.entries(state.objects))
      if (
        !validId(id) ||
        !isRecord(g) ||
        !(g.parentId === null || validId(g.parentId)) ||
        !['x', 'y'].every(
          (field) => typeof g[field] === 'number' && Number.isFinite(g[field]),
        ) ||
        !['width', 'height'].every(
          (field) =>
            (value.version === 2 && g[field] === undefined) ||
            (typeof g[field] === 'number' &&
              Number.isFinite(g[field]) &&
              g[field] > 0),
        )
      )
        invalid();
  }
  if (value.version === 1) {
    // Old snapshots cannot distinguish automatic displacement from unrelated
    // manual edits. Retain branch layouts and relearn neighbor displacement.
    const branches = new Set(
      Object.values(value.states).flatMap((s) => (s as Arrangement).expanded),
    );
    const { owned } = branchScope(document, [...branches]);
    for (const state of Object.values(value.states) as Arrangement[])
      for (const id of Object.keys(state.objects))
        if (!owned.has(id)) delete state.objects[id];
    value.version = 2;
    value.displaced = {};
  }
  if (!isRecord(value.displaced)) return invalid();
  for (const [id, neighbors] of Object.entries(value.displaced))
    if (!validId(id) || !Array.isArray(neighbors) || !neighbors.every(validId))
      invalid();
  return value as ExpansionLayouts;
}

/** Only the toggled subtree and its ancestors own state-specific sizes. */
function branchScope(document: RecursiveDocument, branches: string[]) {
  const hierarchy = indexHierarchy(document.objects);
  const scope = new Set<string>();
  const pending = [...branches];
  for (const id of pending) {
    if (scope.has(id) || !document.objects[id]) continue;
    scope.add(id);
    pending.push(...(hierarchy.children.get(id) ?? []));
  }
  const subtree = new Set(scope);
  for (const id of branches)
    for (
      let parent = document.objects[id]?.parentId;
      parent != null;
      parent = document.objects[parent].parentId
    )
      scope.add(parent);
  return { owned: scope, subtree };
}

function context(cache: ExpansionLayouts) {
  return JSON.stringify(
    Object.entries(cache.depths).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  );
}
function stateKey(scope: string, expanded: string[]) {
  return JSON.stringify([scope, expanded]);
}

function capture(
  document: RecursiveDocument,
  cache: ExpansionLayouts,
): Arrangement {
  const objects: Record<string, Placement> = {};
  for (const [root, depth] of Object.entries(document.rootDepths))
    for (const [id, { x, y, width, height }] of Object.entries(
      document.layouts[root][depth],
    ))
      objects[id] = {
        x,
        y,
        width,
        height,
        parentId: document.objects[id].parentId,
      };
  return {
    context: context(cache),
    expanded: [...recursiveVisibility(document).expanded].sort(),
    objects,
  };
}

function save(
  cache: ExpansionLayouts,
  snapshot: Arrangement,
  scope: Set<string>,
  neighbors: Set<string>,
) {
  const key = stateKey(snapshot.context, snapshot.expanded);
  const state = (cache.states[key] ??= { ...snapshot, objects: {} });
  for (const id of new Set([
    ...Object.keys(state.objects),
    ...scope,
    ...neighbors,
  ])) {
    const g = snapshot.objects[id];
    if (!g) continue;
    state.objects[id] =
      scope.has(id) || state.objects[id]?.width !== undefined
        ? { ...g }
        : { x: g.x, y: g.y, parentId: g.parentId };
  }
}

/** Capture transient geometry; persist only the branch and its known effects. */
export function rememberExpansionLayout(
  document: RecursiveDocument,
  branches: string[] = [],
) {
  let cache = memory(document);
  if (!cache) {
    cache = {
      version: 2,
      depths: { ...document.rootDepths },
      states: {},
      displaced: {},
    };
    document.extensions = { ...document.extensions, expansionLayouts: cache };
  }
  const snapshot = capture(document, cache);
  const { owned, subtree } = branchScope(document, branches);
  save(
    cache,
    snapshot,
    owned,
    new Set([...subtree].flatMap((id) => cache.displaced[id] ?? [])),
  );
  return snapshot;
}

/** Include neighbors only when this transition actually moved them. */
export function rememberExpansionTransition(
  document: RecursiveDocument,
  before: Arrangement,
  branches: string[],
) {
  const cache = memory(document)!;
  const after = capture(document, cache);
  const { owned, subtree } = branchScope(document, branches);
  const neighbors = new Set(
    [...subtree].flatMap((id) => cache.displaced[id] ?? []),
  );
  for (const [id, g] of Object.entries(after.objects)) {
    const old = before.objects[id];
    if (
      !owned.has(id) &&
      old &&
      old.parentId === g.parentId &&
      (old.x !== g.x || old.y !== g.y)
    )
      neighbors.add(id);
  }
  // A later nested expansion can reach a neighbor for the first time. Earlier
  // collapsed states still need its position from before that displacement.
  for (const id of neighbors) {
    const g = before.objects[id];
    if (!g) continue;
    for (const state of Object.values(cache.states))
      if (state.context === before.context)
        state.objects[id] ??= { x: g.x, y: g.y, parentId: g.parentId };
  }
  for (const id of branches) cache.displaced[id] = [...neighbors].sort();
  save(cache, before, owned, neighbors);
  save(cache, after, owned, neighbors);
}

/** Depth controls and real bookmarks establish an authoritative arrangement. */
export function resetExpansionContext(document: RecursiveDocument) {
  const cache = memory(document);
  if (!cache) return;
  cache.depths = { ...document.rootDepths };
  rememberExpansionLayout(document);
}

/** Restore a visited state, or the closest retained baseline for a new one.
 * New openings check collisions; a known collapse restores its exact placement. */
export function restoreExpansionLayout(
  document: RecursiveDocument,
  branches: string[],
) {
  const cache = memory(document)!;
  const { expanded, visible } = recursiveVisibility(document);
  const scope = context(cache);
  const exact = cache.states[stateKey(scope, [...expanded].sort())];
  const candidates = Object.entries(cache.states).filter(
    ([, s]) => s.context === scope,
  );
  // Prefer the largest subset: opening A, then B, then closing A derives B
  // from the original baseline instead of retaining A's displacement.
  // A missing subset (e.g. the first collapse in an old file) uses its nearest state.
  const rank = (s: Arrangement) =>
    s.expanded.filter((id) => expanded.has(id)).length -
    s.expanded.filter((id) => !expanded.has(id)).length * (expanded.size + 1);
  candidates.sort(
    ([ka, a], [kb, b]) => rank(b) - rank(a) || (ka < kb ? -1 : ka > kb ? 1 : 0),
  );
  const saved = exact ?? candidates[0]?.[1];
  const { owned, subtree } = branchScope(document, branches);
  const affected = new Set([
    ...owned,
    ...[...subtree].flatMap((id) => cache.displaced[id] ?? []),
  ]);
  // Unrelated disclosures do not create a new layout for this branch. Sparse
  // states may have only its displacement, so borrow sizes from a matching visit.
  const signature = (ids: string[]) =>
    JSON.stringify(ids.filter((id) => owned.has(id)));
  const target = signature([...expanded].sort());
  const matching = candidates
    .map(([, state]) => state)
    .filter((state) => signature(state.expanded) === target);
  const dirty = new Set(
    [...expanded].filter(
      (id) => owned.has(id) && !(matching[0] ?? saved)?.expanded.includes(id),
    ),
  );
  if (!exact)
    for (const id of branches)
      for (
        let parent = document.objects[id]?.parentId;
        parent != null;
        parent = document.objects[parent].parentId
      )
        if (expanded.has(parent)) dirty.add(parent);
  const hierarchy = indexHierarchy(document.objects);
  const restored = new Set<string>();
  for (const [id, { root }] of hierarchy.entries) {
    if (!affected.has(id)) continue;
    const layout = document.layouts[root][document.rootDepths[root]];
    const g = layout[id];
    if (!g) continue;
    const placements = (owned.has(id) && matching.length ? matching : [saved])
      .map((state) => state?.objects[id])
      .filter(
        (g): g is Placement =>
          !!g && g.parentId === document.objects[id].parentId,
      );
    const placement = placements[0];
    if (placement) {
      if (exact) restored.add(id);
      g.x = placement.x;
      g.y = placement.y;
      if (owned.has(id)) {
        const size = placements.find(
          (p) => p.width !== undefined && p.height !== undefined,
        );
        if (size) {
          // A saved ancestor size may no longer contain its live children.
          // Refit shrinking containers before publishing the restored layout.
          if (
            !subtree.has(id) &&
            expanded.has(id) &&
            (size.width! < g.width || size.height! < g.height)
          )
            dirty.add(id);
          Object.assign(g, { width: size.width, height: size.height });
        } else if (visible.has(id)) dirty.add(id);
      }
    } else if (owned.has(id) && visible.has(id)) {
      // New/reparented geometry comes from its current layout, never old ownership.
      dirty.add(id);
    }
  }
  return {
    restored,
    fit: dirty,
    changed: new Set([
      ...dirty,
      ...branches.filter((id) => expanded.has(id) || !exact),
    ]),
  };
}

/** Prune changed identities on structural edits, including delete then ID reuse.
 * Surviving placements remain useful; incomplete states are repaired on visit. */
export function reconcileExpansionLayouts(
  before: RecursiveDocument,
  document: RecursiveDocument,
) {
  if (!document.extensions?.expansionLayouts) return;
  const changed = new Set(
    Object.keys(before.objects).filter(
      (id) =>
        !document.objects[id] ||
        before.objects[id].parentId !== document.objects[id].parentId,
    ),
  );
  if (!changed.size) return;
  const cache = memory(document)!;
  for (const state of Object.values(cache.states))
    for (const id of changed) delete state.objects[id];
  for (const id of changed) delete cache.displaced[id];
  for (const id of Object.keys(cache.displaced))
    cache.displaced[id] = cache.displaced[id].filter(
      (neighbor) => !changed.has(neighbor),
    );
  // depths identifies the last explicit depth selection, not live topology.
  // Keeping that context also keeps unrelated remembered arrangements reachable.
}
