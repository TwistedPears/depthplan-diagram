import { Immer } from 'immer';
import { indexHierarchy } from './recursiveHierarchy';
import { reconcileExpansionLayouts } from './expansionLayouts';
import {
  type RecursiveDocument,
  type DiagramObject,
  type Geometry,
  validateRecursiveDocument,
} from './recursiveDocument';

/** Drafts are mutable only during this synchronous callback. */
export type DocumentEdit = (draft: RecursiveDocument) => void;
// Command data is detached below; never freeze caller-owned payloads.
const { produce } = new Immer({ autoFreeze: false });
/** Reconcile a detached JSON tree, sharing unchanged branches with the prior snapshot. */
function shareSnapshot(before: any, draft: any): any {
  if (draft === null || typeof draft !== 'object') return draft;
  const keys = Object.keys(draft);
  const previous = before !== null && typeof before === 'object' ? before : {};
  const oldKeys = Object.keys(previous);
  let same =
    before !== null &&
    typeof before === 'object' &&
    Array.isArray(before) === Array.isArray(draft) &&
    keys.length === oldKeys.length;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const old = Object.hasOwn(previous, key) ? previous[key] : undefined;
    const value = shareSnapshot(old, draft[key]);
    draft[key] = value;
    same &&= key === oldKeys[i] && value === old;
  }
  return same ? before : draft;
}

/** Most commands change one top-level map; do not parse the other maps again. */
function detachChanges(document: RecursiveDocument, draft: RecursiveDocument) {
  // Preserve JSON normalization for the unusual command with a root toJSON hook.
  if (typeof (draft as any).toJSON === 'function')
    return shareSnapshot(document, JSON.parse(JSON.stringify(draft)));
  const fields = Object.entries(draft).map(([key, value]) => {
    const old = Object.hasOwn(document, key)
      ? (document as any)[key]
      : undefined;
    if (value === old) return [key, old];
    // The wrapper preserves the key passed to command-supplied toJSON hooks.
    const encoded = JSON.stringify({ [key]: value });
    return [
      key,
      encoded === JSON.stringify({ [key]: old })
        ? old
        : shareSnapshot(old, JSON.parse(encoded)[key]),
    ];
  });
  const previous = Object.keys(document);
  return fields.length === previous.length &&
    fields.every(
      ([key, value], i) =>
        key === previous[i] && value === (document as any)[key],
    )
    ? document
    : (Object.fromEntries(fields) as RecursiveDocument);
}
export type TransactionResult =
  | {
      status: 'accepted';
      before: RecursiveDocument;
      document: RecursiveDocument;
    }
  | { status: 'noop'; document: RecursiveDocument }
  | { status: 'rejected'; document: RecursiveDocument; error: string };

/** One compound edit, one validated snapshot. The caller owns history/session state. */
export function transactDocument(
  document: RecursiveDocument,
  edit: DocumentEdit,
  now = new Date().toISOString(),
): TransactionResult {
  try {
    const draft = produce(document, (editable) => {
      edit(editable);
      reconcileExpansionLayouts(document, editable);
      if (editable.id !== document.id)
        throw new Error('An edit cannot replace document identity');
      // modified is derived, so touching it alone is not a document edit.
      editable.metadata.modified = document.metadata.modified;
    });
    validateRecursiveDocument(draft);
    // Normalize command-supplied JSON values just as persisted documents are normalized.
    const next = detachChanges(document, draft);
    if (next === document) return { status: 'noop', document };
    next.metadata = { ...next.metadata, modified: now };
    return { status: 'accepted', before: document, document: next };
  } catch (error) {
    return {
      status: 'rejected',
      document,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function editObject(
  id: string,
  patch: Partial<Pick<DiagramObject, 'name' | 'content' | 'style'>>,
): DocumentEdit {
  return (draft) => {
    if (!Object.hasOwn(draft.objects, id))
      throw new Error(`Missing object ${id}`);
    Object.assign(draft.objects[id], patch);
  };
}

export function editActiveGeometry(
  id: string,
  patch: Partial<Geometry>,
): DocumentEdit {
  return (draft) => {
    const entry = indexHierarchy(draft.objects).entries.get(id);
    if (!entry) throw new Error(`Missing object ${id}`);
    const layout = draft.layouts[entry.root][draft.rootDepths[entry.root]];
    if (!Object.hasOwn(layout, id))
      throw new Error(`Object ${id} has no active geometry`);
    Object.assign(layout[id], patch);
  };
}
