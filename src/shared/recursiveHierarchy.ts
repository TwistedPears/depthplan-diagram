import type {
  DiagramObject,
  Geometry,
  RecursiveDocument,
} from './recursiveDocument';

export function indexHierarchy(objects: Record<string, DiagramObject>) {
  const children = new Map<string | null, string[]>();
  for (const [id, object] of Object.entries(objects)) {
    if (
      id !== object.id ||
      (object.parentId !== null && !Object.hasOwn(objects, object.parentId))
    )
      throw new Error(`Invalid parent or identity ${id}`);
    if (!children.has(object.parentId)) children.set(object.parentId, []);
    children.get(object.parentId)!.push(id);
  }
  const roots = children.get(null) ?? [];
  const entries = new Map<string, { root: string; generation: number }>();
  const byRoot = new Map<string, string[]>();
  const maximum = new Map<string, number>();
  const queue = roots.map((id) => ({ id, root: id, generation: 0 }));
  for (let at = 0; at < queue.length; at++) {
    const { id, root, generation } = queue[at];
    entries.set(id, { root, generation });
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(id);
    maximum.set(root, generation);
    for (const child of children.get(id) ?? [])
      queue.push({ id: child, root, generation: generation + 1 });
  }
  if (entries.size !== Object.keys(objects).length)
    throw new Error('Containment cycle');
  return { entries, children, roots, byRoot, maximum };
}

const radians = (r: number) => (r * Math.PI) / 180;
export function toWorldGeometry(local: Geometry, parent: Geometry): Geometry {
  const angle = radians(parent.rotation);
  return {
    ...local,
    x: parent.x + local.x * Math.cos(angle) - local.y * Math.sin(angle),
    y: parent.y + local.x * Math.sin(angle) + local.y * Math.cos(angle),
    rotation: (parent.rotation + local.rotation) % 360,
  };
}
export function toLocalGeometry(world: Geometry, parent: Geometry): Geometry {
  const angle = radians(-parent.rotation),
    dx = world.x - parent.x,
    dy = world.y - parent.y;
  return {
    ...world,
    x: dx * Math.cos(angle) - dy * Math.sin(angle),
    y: dx * Math.sin(angle) + dy * Math.cos(angle),
    rotation: (((world.rotation - parent.rotation) % 360) + 360) % 360,
  };
}
/** Resolve only materialized active geometry; no seed fallback or implicit layout edits. */
export function activeWorldGeometry(
  document: RecursiveDocument,
  hierarchy = indexHierarchy(document.objects),
): Map<string, Geometry> {
  const result = new Map<string, Geometry>();
  for (const [id, { root, generation }] of hierarchy.entries) {
    if (generation > document.rootDepths[root]) continue;
    const local = document.layouts[root][document.rootDepths[root]][id];
    if (!local) throw new Error(`Missing active geometry ${id}`);
    const parentId = document.objects[id].parentId;
    result.set(
      id,
      parentId === null
        ? { ...local }
        : toWorldGeometry(local, result.get(parentId)!),
    );
  }
  return result;
}
