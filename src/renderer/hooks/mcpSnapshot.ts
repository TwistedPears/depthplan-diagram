import type { RefObject } from 'react';
import type { RecursiveExportHandle } from '../components/RecursiveExport';
import type { ApiResult } from '../../shared/depthApiContract';
import { stateOf } from '../../shared/depthQueries';
import {
  checkHandle,
  editorFailure,
  editorStamp,
  EditorError,
  type EditorSnapshot,
} from '../../shared/editorQueries';
import {
  SNAPSHOT_MAX_BASE64,
  snapshotInput,
} from '../../shared/mcpSnapshotContract';
import { planSnapshot, widenPlan } from '../utils/snapshotRegion';

export function base64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
/** Read-only depthplan_snapshot: same busy rule and render wait as image export. */
export function mcpSnapshot(
  current: () => {
    snapshot: () => EditorSnapshot;
    isBusy: () => boolean;
    exportRef: RefObject<RecursiveExportHandle | null>;
    isActive?: () => boolean;
  },
) {
  return async (input: unknown): Promise<ApiResult<unknown>> => {
    const { snapshot, isBusy, exportRef, isActive } = current();
    const s = snapshot();
    try {
      const args = snapshotInput.parse(input);
      checkHandle(s, args.handle);
      if (!s.document) throw new EditorError('NO_DOCUMENT', 'No board is open');
      if (isActive?.() === false)
        throw new EditorError('BUSY', 'Activate this board before a snapshot');
      if (isBusy())
        throw new EditorError(
          'BUSY',
          'Finish the active edit, draft or operation first',
        );
      const planned = planSnapshot(args, {
        document: s.document,
        camera: s.camera,
        viewport: s.canvas.viewport,
      });
      const render = exportRef.current?.snapshot;
      if (!render) throw new EditorError('BUSY', 'Canvas is not ready');
      const stamp = editorStamp(s);
      const { png, plan } = await render({
        stamp,
        plan: planned,
        refit: (painted) => widenPlan(planned, painted, args.maxPixels),
        permit: () => editorStamp(snapshot()) === stamp,
      }).catch((error: unknown) => {
        // A pending render or an open export dialog is transient, not a bad request.
        throw new EditorError(
          editorStamp(snapshot()) === stamp ? 'BUSY' : 'STALE_REVISION',
          error instanceof Error ? error.message : 'Snapshot failed',
        );
      });
      if (editorStamp(snapshot()) !== stamp)
        throw new EditorError(
          'STALE_REVISION',
          'The board changed during the snapshot',
        );
      const data = base64(png);
      if (data.length > SNAPSHOT_MAX_BASE64)
        throw new EditorError(
          'RESPONSE_TOO_LARGE',
          `The PNG is ${(png.length / 1048576).toFixed(1)} MiB; request a smaller maxPixels or region`,
        );
      return {
        ok: true,
        state: stateOf(s),
        data: {
          scope: plan.scope,
          width: plan.width,
          height: plan.height,
          scale: plan.scale,
          region: plan.region,
          revision: s.revision,
          viewRevision: s.viewRevision,
          bytes: png.length,
          png: data,
        },
      };
    } catch (error) {
      return editorFailure(s, error);
    }
  };
}
