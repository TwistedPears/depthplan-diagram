import {
  createRecursiveDocument,
  isRecord,
  validateRecursiveDocument,
  type RecursiveDocument,
} from './recursiveDocument';
import { transactDocument } from './documentTransactions';
import { moveSelection } from './recursiveMovement';
import { endpointWorld, savedWorldGeometry } from './recursiveConnectionRepair';
import { worldPoint } from './connectionGeometry';
import {
  collapsedObjects,
  setCollapsedObjects,
  recursiveVisibility,
} from './recursiveVisibility';
import { copyScope, duplicateSelection } from './recursiveDuplication';

const prefix = 'DepthPlan clipboard v1\n';

/** A portable document containing only the copied subtrees and their wiring. */
export function copySelection(
  document: RecursiveDocument,
  selection: string[],
) {
  const { tops: roots, members, connections } = copyScope(document, selection);
  const tops = [...roots];
  const result = transactDocument(document, (draft) => {
    for (const c of Object.values(document.connections)) {
      if (!connections.has(c.id)) {
        delete draft.connections[c.id];
        continue;
      }
      // Connections outside the copied containers become root-level paths.
      if (c.ownerId === null || !members.has(c.ownerId)) {
        const copied = draft.connections[c.id];
        copied.ownerId = null;
        for (const key of ['start', 'end'] as const) {
          const end = c[key];
          if (end.kind === 'free' || !members.has(end.objectId))
            copied[key] = { kind: 'free', ...endpointWorld(document, c, end) };
        }
        if (c.points)
          copied.points = c.points.map((p) =>
            worldPoint(
              p,
              c.ownerId === null
                ? undefined
                : savedWorldGeometry(document, c.ownerId),
            ),
          );
      }
    }
    moveSelection(
      tops,
      { x: 0, y: 0 },
      new Map(tops.map((id) => [id, null])),
    )(draft);
    draft.objects = Object.fromEntries(
      [...members].map((id) => [id, draft.objects[id]]),
    );
    draft.rootDepths = Object.fromEntries(
      tops.map((id) => [id, draft.rootDepths[id]]),
    );
    draft.layouts = Object.fromEntries(
      tops.map((id) => [id, draft.layouts[id]]),
    );
    const folds = new Set(
      [...collapsedObjects(draft)].filter((id) => members.has(id)),
    );
    draft.extensions = {
      clipboardParents: Object.fromEntries(
        tops.map((id) => [id, document.objects[id].parentId]),
      ),
    };
    delete draft.namedViews;
    delete draft.connectionRepairs;
    draft.metadata = createRecursiveDocument(document.id, 'Clipboard').metadata;
    setCollapsedObjects(draft, folds);
  });
  if (result.status === 'rejected') throw new Error(result.error);
  return prefix + JSON.stringify(result.document);
}

export function readSelection(text: string): RecursiveDocument | null {
  if (!text.startsWith(prefix)) return null;
  const document: unknown = JSON.parse(text.slice(prefix.length));
  validateRecursiveDocument(document);
  return document;
}

/** Retain an available parent in the same document; otherwise paste on the canvas. */
export function pasteSelection(source: RecursiveDocument, offset: number) {
  const roots = Object.keys(source.rootDepths);
  const copy = duplicateSelection(
    source,
    [
      ...roots.map((id) => `object-${id}`),
      ...Object.keys(source.connections).map((id) => `connection-${id}`),
    ],
    offset,
  );
  return {
    selection: copy.selection,
    edit: (draft: RecursiveDocument) => {
      const expanded = recursiveVisibility(draft).expanded;
      copy.edit(draft);
      const owners = source.extensions?.clipboardParents;
      if (source.id !== draft.id || !isRecord(owners)) return;
      const parents = new Map<string, string>();
      roots.forEach((id, i) => {
        const parent = owners[id];
        if (typeof parent === 'string' && expanded.has(parent))
          parents.set(copy.selection[i].slice(7), parent);
      });
      if (parents.size)
        moveSelection([...parents.keys()], { x: 0, y: 0 }, parents)(draft);
    },
  };
}
