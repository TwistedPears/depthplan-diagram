import {
  setDepthInput,
  revealAllInput,
  stateSchema,
  type ApiErrorCode,
  type ApiResult,
  type CommandData,
} from './depthApiContract';
import { stateOf, type QuerySnapshot } from './depthQueries';
import { indexHierarchy } from './recursiveHierarchy';
import type { TransactionResult } from './documentTransactions';

/** Session-scoped retry identities around the same synchronous transition used by the UI. */
export function createDepthCommands(owner: {
  snapshot: () => QuerySnapshot;
  selectDepth: (
    rootId: string,
    depth: number | 'all',
  ) => TransactionResult | null;
  busy: () => boolean;
}) {
  let session = '';
  const retained = new Map<string, { payload: string; revision: number }>();
  return (
    operation: 'set' | 'all',
    request: unknown,
  ): ApiResult<CommandData> => {
    const snapshot = owner.snapshot();
    const state = stateOf(snapshot);
    const stateValid = state === null || stateSchema.safeParse(state).success;
    const fail = (
      code: ApiErrorCode,
      message: string,
    ): ApiResult<CommandData> => ({
      ok: false,
      state: stateValid ? state : null,
      error: {
        code,
        message,
        retryable: code === 'BUSY' || code === 'APP_UNAVAILABLE',
      },
    });
    if (!snapshot.appInstanceId)
      return fail('APP_UNAVAILABLE', 'Application identity is not ready');
    if (!stateValid)
      return fail('RESPONSE_TOO_LARGE', 'Document identity exceeds API bounds');
    const parsed = (
      operation === 'set' ? setDepthInput : revealAllInput
    ).safeParse(request);
    if (!parsed.success)
      return fail('INVALID_REQUEST', 'Invalid depth command arguments');
    const args = parsed.data;
    if (args.handle.appInstanceId !== snapshot.appInstanceId)
      return fail('STALE_APP', 'Refresh context for the intended application');
    if (args.handle.sessionId !== snapshot.sessionId)
      return fail('STALE_SESSION', 'Refresh context for the current document');
    if (session !== snapshot.sessionId) {
      retained.clear();
      session = snapshot.sessionId;
    }
    const document = snapshot.document;
    if (!document) return fail('NO_DOCUMENT', 'No document is open');
    if (!Object.hasOwn(document.objects, args.rootId))
      return fail('NOT_FOUND', 'Object does not exist in this document');
    if (document.objects[args.rootId].parentId !== null)
      return fail('NOT_ROOT', 'Select a top-level root');
    const maximum = indexHierarchy(document.objects).maximum.get(args.rootId)!;
    const payload = JSON.stringify({ operation, ...args });
    const previous = retained.get(args.requestId);
    if (previous && previous.payload !== payload)
      return fail(
        'REQUEST_ID_REUSED',
        'Use a new request ID for a new intended command',
      );
    if (owner.busy())
      return fail(
        'BUSY',
        'Finish or cancel the active edit or document transition',
      );
    if (previous)
      return {
        ok: true,
        state,
        data: {
          rootId: args.rootId,
          selectedDepth: document.rootDepths[args.rootId],
          maximumDepth: maximum,
          changed: false,
          replayed: true,
          appliedRevision: previous.revision,
        },
      };
    if (args.expectedRevision !== snapshot.revision)
      return fail('STALE_REVISION', 'Refresh context and reassess the command');
    const depth = 'depth' in args ? (args.depth as number) : 'all';
    if (depth !== 'all' && depth > maximum)
      return fail('INVALID_DEPTH', 'Depth exceeds the current root maximum');
    try {
      const result = owner.selectDepth(args.rootId, depth);
      if (!result || result.status === 'rejected')
        return fail('INTERNAL_ERROR', 'Depth transition could not be applied');
      const current = owner.snapshot();
      retained.set(args.requestId, { payload, revision: current.revision });
      if (retained.size > 256) retained.delete(retained.keys().next().value!);
      return {
        ok: true,
        state: stateOf(current),
        data: {
          rootId: args.rootId,
          selectedDepth: result.document.rootDepths[args.rootId],
          maximumDepth: maximum,
          changed: result.status === 'accepted',
          replayed: false,
          appliedRevision: current.revision,
        },
      };
    } catch {
      return fail('INTERNAL_ERROR', 'Depth transition could not be applied');
    }
  };
}
