import type { DocumentEdit } from './documentTransactions';
import { editActiveGeometry } from './documentTransactions';
import { activeWorldGeometry, toLocalGeometry } from './recursiveHierarchy';
import { geometryBounds, unionBounds } from './recursiveCamera';
import { topmostObjects } from './recursiveMovement';
import { recursiveScene, type SceneItem } from './recursiveScene';

export type AlignmentAction =
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-top'
  | 'align-middle'
  | 'align-bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical'
  | 'make-same-width'
  | 'make-same-height';
export type StackingAction =
  'bring-to-front' | 'bring-forward' | 'send-backward' | 'send-to-back';

/** Snapshot world bounds before editing: ownership and inactive arrangements never change. */
export function alignObjects(
  ids: string[],
  action: AlignmentAction,
): DocumentEdit {
  return (draft) => {
    const selected = topmostObjects(draft, ids);
    const distribute = action.startsWith('distribute-');
    if (selected.length < (distribute ? 3 : 2)) return;
    const world = activeWorldGeometry(draft);
    const entries = selected.map((id) => {
      const g = world.get(id);
      if (!g) throw new Error('Arrange requires visible shapes.');
      return { id, g, bounds: geometryBounds(g) };
    });
    if (action.startsWith('make-same-')) {
      const dimension = action === 'make-same-width' ? 'width' : 'height';
      const value = entries[0].g[dimension];
      for (const { id } of entries)
        editActiveGeometry(id, { [dimension]: value })(draft);
      return;
    }
    const horizontal = [
      'align-left',
      'align-center',
      'align-right',
      'distribute-horizontal',
    ].includes(action);
    const axis = horizontal ? 'x' : 'y';
    const dimension = horizontal ? 'width' : 'height';
    const union = unionBounds(entries.map((e) => e.bounds))!;
    if (distribute)
      entries.sort(
        (a, b) =>
          a.bounds[axis] - b.bounds[axis] ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    const gap =
      (union[dimension] -
        entries.reduce((sum, e) => sum + e.bounds[dimension], 0)) /
      (entries.length - 1);
    let cursor = union[axis];
    for (const { id, g, bounds } of entries) {
      let position: number;
      if (distribute) {
        position = cursor + bounds[dimension] / 2;
        cursor += bounds[dimension] + gap;
      } else if (action === 'align-left' || action === 'align-top') {
        position = union[axis] + bounds[dimension] / 2;
      } else if (action === 'align-right' || action === 'align-bottom') {
        position = union[axis] + union[dimension] - bounds[dimension] / 2;
      } else position = union[axis] + union[dimension] / 2;
      if (Math.abs(position - g[axis]) < 1e-9) continue;
      const parent = draft.objects[id].parentId;
      const moved = { ...g, [axis]: position };
      const local =
        parent === null ? moved : toLocalGeometry(moved, world.get(parent)!);
      editActiveGeometry(id, { x: local.x, y: local.y })(draft);
    }
  };
}

/** Keep the object-ID interface used by automation. */
export function stackObjects(
  ids: string[],
  action: StackingAction,
): DocumentEdit {
  return stackSelection(
    ids.map((id) => `object-${id}`),
    action,
  );
}

/** Shapes and connections share the scene's paint order in each ownership scope. */
export function stackSelection(
  selection: string[],
  action: StackingAction,
): DocumentEdit {
  return (draft) => {
    const selected = new Set(selection);
    const { paintOrder } = recursiveScene(draft);
    const key = (item: SceneItem) => `${item.kind}-${item.id}`;
    const visible = new Set([...paintOrder.values()].flat().map(key));
    for (const id of selected)
      if (!visible.has(id))
        throw new Error('Stacking requires visible shapes or connections.');
    const isSelected = (item: SceneItem) => selected.has(key(item));
    for (const ordered of paintOrder.values()) {
      if (!ordered.some(isSelected)) continue;
      let next = [...ordered];
      if (action === 'bring-to-front' || action === 'send-to-back') {
        const group = ordered.filter(isSelected);
        const rest = ordered.filter((item) => !isSelected(item));
        next =
          action === 'bring-to-front'
            ? [...rest, ...group]
            : [...group, ...rest];
      } else if (action === 'bring-forward') {
        for (let at = next.length - 2; at >= 0; at--) {
          if (isSelected(next[at]) && !isSelected(next[at + 1]))
            [next[at], next[at + 1]] = [next[at + 1], next[at]];
        }
      } else {
        for (let at = 1; at < next.length; at++) {
          if (isSelected(next[at]) && !isSelected(next[at - 1]))
            [next[at], next[at - 1]] = [next[at - 1], next[at]];
        }
      }
      if (next.every((id, at) => id === ordered[at])) continue;
      next.forEach((item, z) => {
        if (item.kind === 'object') editActiveGeometry(item.id, { z })(draft);
        else draft.connections[item.id].z = z;
      });
    }
  };
}
