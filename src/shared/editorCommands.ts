import type { z } from 'zod';
import {
  editInput,
  bookmarkInput,
  cameraInput,
  cameraSchema,
  selectionInput,
  historyInput,
} from './editorApiContract';
import {
  EditorError,
  checkHandle,
  recursiveDocument,
  boundedResult,
  editorFailure,
  type EditorSnapshot,
} from './editorQueries';
import { createShape, createConnector } from './recursiveCreation';
import {
  editActiveGeometry,
  type DocumentEdit,
  type TransactionResult,
} from './documentTransactions';
import {
  editWorldGeometry,
  selectRootDepth,
  setChildrenExpanded,
} from './recursiveLayouts';
import { editNamedView, resolveNamedViewCamera } from './namedViews';
import { zoomCamera, type Camera } from './recursiveCamera';
import { recursiveScene } from './recursiveScene';
import type { CanvasState } from './editorApiContract';
import {
  controlsInput,
  contentTransferInput,
  richBlockSchema,
} from './editorApiContract';
import { patchObject, patchConnection } from './editorProperties';
import { moveSelection, moveSubtree } from './recursiveMovement';
import { activeWorldGeometry } from './recursiveHierarchy';
import {
  alignObjects,
  stackObjects,
  type AlignmentAction,
  type StackingAction,
} from './recursiveArrangement';
import { deleteSelection } from './recursiveDeletion';
import { editBoundaryPoint } from './recursiveBoundary';
import { createInwardBridge, reattachInwardBridge } from './recursiveBridges';
import {
  deleteBoundaryPoint,
  resolveConnectionRepair,
} from './recursiveConnectionRepair';
import type { RichBlock } from './recursiveDocument';

type Owner = {
  snapshot: () => EditorSnapshot;
  busyReasons: () => string[];
  transact: (edit: DocumentEdit, camera?: Camera) => TransactionResult | null;
  setCamera: (camera: Camera) => void;
  setCanvas: (canvas: CanvasState) => void;
  fit: () => void;
  undo: () => unknown;
  redo: () => unknown;
};
export const commandSchemas = {
  controls: controlsInput,
  content: contentTransferInput,
  edit: editInput,
  bookmarks: bookmarkInput,
  camera: cameraInput,
  selection: selectionInput,
  history: historyInput,
};
export function compileEdits(
  input: z.infer<typeof editInput>,
  snapshot: EditorSnapshot,
  content: (id: string) => RichBlock[] = () => {
    throw new Error('Content transfer is unavailable');
  },
) {
  const camera = { ...(input.camera ?? snapshot.camera) };
  const tracksCamera =
    !!input.camera ||
    input.actions.some(
      (a) => a.type === 'bookmark' && a.action.type === 'apply',
    );
  const edit: DocumentEdit = (draft) => {
    for (const action of input.actions) {
      switch (action.type) {
        case 'edit_object': {
          if (action.content && action.contentTransfer)
            throw new Error('Provide content or contentTransfer, not both');
          const { type: _type, id, contentTransfer, ...patch } = action;
          patchObject(id, {
            ...patch,
            ...(contentTransfer ? { content: content(contentTransfer) } : {}),
          })(draft);
          break;
        }
        case 'edit_connection': {
          const { type: _type, id, ...patch } = action;
          patchConnection(id, patch)(draft);
          break;
        }
        case 'move':
          moveSelection(action.ids, action.delta, new Map())(draft);
          break;
        case 'reparent': {
          const point =
            action.position ?? activeWorldGeometry(draft).get(action.id);
          if (!point) throw new Error('Reparent requires a visible object');
          moveSubtree(action.id, action.parentId, point)(draft);
          break;
        }
        case 'delete':
          if (
            action.objects.some((id) => !Object.hasOwn(draft.objects, id)) ||
            action.connections.some(
              (id) => !Object.hasOwn(draft.connections, id),
            )
          )
            throw new Error('Delete target no longer exists');
          deleteSelection(action.objects, action.connections)(draft);
          break;
        case 'arrange':
          if (
            action.action.startsWith('bring-') ||
            action.action.startsWith('send-')
          )
            stackObjects(action.ids, action.action as StackingAction)(draft);
          else
            alignObjects(action.ids, action.action as AlignmentAction)(draft);
          break;
        case 'boundary':
          if (action.action === 'delete')
            deleteBoundaryPoint(action.objectId, action.pointId)(draft);
          else {
            if (!action.point)
              throw new Error('Boundary create/update requires a point');
            editBoundaryPoint(
              action.objectId,
              action.pointId,
              action.point,
              action.action === 'create',
            )(draft);
          }
          break;
        case 'bridge':
          createInwardBridge(
            action.id,
            action.kind,
            action.source,
            action.target,
            action.point,
          )(draft);
          break;
        case 'reattach_bridge':
          reattachInwardBridge(action.id, action.target, action.point)(draft);
          break;
        case 'repair':
          resolveConnectionRepair(action.id, action.replacementId)(draft);
          break;
        case 'create_object':
          createShape(
            action.id,
            action.shape,
            action.geometry,
            action.parentId,
          )(draft);
          draft.objects[action.id].name = action.name;
          break;
        case 'geometry': {
          const patch = { ...action.patch };
          if (patch.rotation !== undefined)
            patch.rotation = ((patch.rotation % 360) + 360) % 360;
          (action.space === 'world' ? editWorldGeometry : editActiveGeometry)(
            action.id,
            patch,
          )(draft);
          break;
        }
        case 'create_connection':
          createConnector(
            action.id,
            action.kind,
            action.start,
            action.end,
            action.startTarget,
            action.endTarget,
            action.points,
          )(draft);
          break;
        case 'depth':
          selectRootDepth(action.rootId, action.depth)(draft);
          break;
        case 'children':
          setChildrenExpanded(action.id, action.expanded)(draft);
          break;
        case 'bookmark': {
          const command = action.action;
          editNamedView(
            command.type === 'reset' ? { ...command, type: 'update' } : command,
            camera,
            snapshot.canvas.viewport,
          )(draft);
          if (command.type === 'apply')
            Object.assign(
              camera,
              resolveNamedViewCamera(
                draft.namedViews?.[command.id],
                snapshot.canvas.viewport,
              ),
            );
          break;
        }
      }
    }
  };
  // The transaction executes the edit before reading the final camera. A rejection publishes neither.
  const createdIds = input.actions.flatMap((action) =>
    action.type === 'create_object' ||
    action.type === 'create_connection' ||
    action.type === 'bridge'
      ? [action.id]
      : action.type === 'boundary' && action.action === 'create'
        ? [action.pointId]
        : action.type === 'bookmark' && action.action.type === 'create'
          ? [action.action.id]
          : action.type === 'bookmark' && action.action.type === 'duplicate'
            ? [action.action.newId]
            : [],
  );
  return { edit, camera: tracksCamera ? camera : undefined, createdIds };
}
export function createEditorCommands(owner: Owner) {
  const setCamera = (camera: Camera) =>
    owner.setCamera(cameraSchema.parse(camera));
  let session = '';
  const receipts = new Map<
    string,
    { payload: string; data: Record<string, unknown> }
  >();
  const transfers = new Map<
    string,
    {
      text: string;
      length: number;
      revision: number;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const discard = (id: string) => {
    const transfer = transfers.get(id);
    if (transfer) clearTimeout(transfer.timer);
    transfers.delete(id);
  };
  const dispose = () => {
    for (const id of transfers.keys()) discard(id);
  };
  const command = (kind: keyof typeof commandSchemas, input: unknown) => {
    const before = owner.snapshot();
    try {
      const args = commandSchemas[kind].parse(input);
      checkHandle(before, args.handle);
      recursiveDocument(before);
      if (session !== before.sessionId) {
        session = before.sessionId;
        receipts.clear();
        dispose();
      }
      const payload = JSON.stringify({ kind, args });
      const previous = receipts.get(args.requestId);
      if (previous) {
        if (previous.payload !== payload)
          throw new EditorError(
            'REQUEST_ID_REUSED',
            'Use a new requestId for a different command',
          );
        return boundedResult(before, {
          ...previous.data,
          changed: false,
          replayed: true,
        });
      }
      if (owner.busyReasons().length)
        throw new EditorError(
          'BUSY',
          'Finish or explicitly resolve the current draft or operation',
        );
      if (args.expectedRevision !== before.revision)
        throw new EditorError('STALE_REVISION', 'Refresh state before editing');
      if (args.expectedViewRevision !== before.viewRevision)
        throw new EditorError(
          'STALE_VIEW',
          'The camera or selection changed; refresh state',
        );
      let createdIds: string[] = [];
      if (kind === 'edit' || kind === 'bookmarks') {
        const command =
          kind === 'edit'
            ? editInput.parse(input)
            : {
                ...args,
                actions: [
                  {
                    type: 'bookmark' as const,
                    action: bookmarkInput.parse(input).action,
                  },
                ],
              };
        const compiled = compileEdits(command, before, (id) => {
          const transfer = transfers.get(id);
          if (
            !transfer ||
            transfer.revision !== before.revision ||
            transfer.text.length !== transfer.length
          )
            throw new Error('Content transfer is incomplete, expired or stale');
          return richBlockSchema.array().parse(JSON.parse(transfer.text));
        });
        createdIds = compiled.createdIds;
        const result = owner.transact(compiled.edit, compiled.camera);
        if (!result || result.status === 'rejected')
          throw new EditorError(
            'INVALID_REQUEST',
            result?.error ?? 'Edit was not applied',
          );
        for (const action of command.actions)
          if (action.type === 'edit_object' && action.contentTransfer)
            discard(action.contentTransfer);
      } else if (kind === 'content') {
        const { action } = contentTransferInput.parse(input);
        if (action.type === 'discard') discard(action.id);
        else if (action.type === 'begin') {
          if (transfers.has(action.id) || transfers.size >= 4)
            throw new Error(
              'Transfer already exists or four-transfer limit reached',
            );
          const timer = setTimeout(
            () => transfers.delete(action.id),
            5 * 60 * 1000,
          );
          if (typeof timer === 'object') timer.unref?.();
          transfers.set(action.id, {
            text: '',
            length: action.totalLength,
            revision: before.revision,
            timer,
          });
        } else {
          const transfer = transfers.get(action.id);
          if (!transfer || transfer.revision !== before.revision)
            throw new Error('Content transfer expired or document changed');
          if (
            action.offset !== transfer.text.length ||
            action.offset + action.text.length > transfer.length
          )
            throw new Error(
              'Append must match the next offset and declared length',
            );
          transfer.text += action.text;
        }
      } else if (kind === 'controls') {
        owner.setCanvas({
          ...before.canvas,
          ...controlsInput.parse(input).patch,
        });
      } else if (kind === 'camera') {
        const { action } = cameraInput.parse(input);
        const c = before.camera,
          size = before.canvas.viewport;
        switch (action.type) {
          case 'set':
            setCamera(action.camera);
            break;
          case 'pan':
            setCamera({
              ...c,
              x: c.x + action.delta.x,
              y: c.y + action.delta.y,
            });
            break;
          case 'zoom':
            setCamera(
              zoomCamera(
                c,
                action.anchor ?? { x: size.width / 2, y: size.height / 2 },
                action.scale,
              ),
            );
            break;
          case 'reset':
            setCamera({ x: 0, y: 0, scale: 1 });
            break;
          case 'fit':
            owner.fit();
            break;
        }
      } else if (kind === 'selection') {
        const command = selectionInput.parse(input),
          doc = recursiveDocument(before);
        const scene = recursiveScene(doc);
        const visible = new Set(
          [...scene.world.keys()].map((id) => `object-${id}`),
        );
        for (const connections of scene.connections.values())
          for (const { id } of connections) visible.add(`connection-${id}`);
        let ids = [
          ...command.objects.map((id) => `object-${id}`),
          ...command.connections.map((id) => `connection-${id}`),
        ];
        if (command.action === 'parent') {
          if (command.objects.length !== 1 || command.connections.length)
            throw new EditorError(
              'INVALID_REQUEST',
              'Parent selection requires one object',
            );
          const object = doc.objects[command.objects[0]];
          if (!object)
            throw new EditorError('NOT_FOUND', 'Object does not exist');
          ids = object.parentId ? [`object-${object.parentId}`] : [];
        }
        if (ids.some((id) => !visible.has(id)))
          throw new EditorError(
            'NOT_FOUND',
            'Selection requires visible items',
          );
        if (
          command.point &&
          (!scene.world.has(command.point.objectId) ||
            !doc.objects[command.point.objectId]?.boundaryPoints?.[
              command.point.pointId
            ])
        )
          throw new EditorError('NOT_FOUND', 'Boundary point is unavailable');
        const selected =
          command.action === 'all'
            ? [...visible]
            : command.action === 'clear'
              ? []
              : command.action === 'add'
                ? [...new Set([...before.canvas.selected, ...ids])]
                : command.action === 'remove'
                  ? before.canvas.selected.filter((id) => !ids.includes(id))
                  : ids;
        owner.setCanvas({
          ...before.canvas,
          selected,
          selectedPoint: command.point ?? null,
        });
      } else {
        const { direction } = historyInput.parse(input);
        owner[direction]();
      }
      const after = owner.snapshot();
      const data = {
        createdIds,
        changed:
          after.revision !== before.revision ||
          after.viewRevision !== before.viewRevision,
        appliedRevision: after.revision,
        viewRevision: after.viewRevision,
        replayed: false,
      };
      receipts.set(args.requestId, { payload, data });
      if (receipts.size > 256) receipts.delete(receipts.keys().next().value!);
      return boundedResult(after, data);
    } catch (error) {
      return editorFailure(owner.snapshot(), error);
    }
  };
  return Object.assign(command, { dispose });
}
