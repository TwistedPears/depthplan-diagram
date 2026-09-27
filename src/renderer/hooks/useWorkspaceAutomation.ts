import { useRef } from 'react';
import {
  unavailable,
  type AutomationRequest,
} from '../../shared/automationContract';
import type { ApiResult } from '../../shared/depthApiContract';
import { boundedResult, EditorError } from '../../shared/editorQueries';
import { projectOpen, projectQuery } from '../../shared/mcpProjectContract';
import { mcpTools } from '../../shared/mcpRegistry';
import useAutomation, { type AutomationHandlers } from './useAutomation';
import useDocumentSessions, {
  type SessionController,
} from './useDocumentSessions';
import useProjectWorkspace from './useProjectWorkspace';

type Context = {
  appInstanceId: string | null;
  registry: ReturnType<typeof useDocumentSessions>;
  workspace: NonNullable<ReturnType<typeof useProjectWorkspace>>;
};

export function workspaceRouter(current: () => Context) {
  const requests = new Map<
    string,
    { payload: string; result: Promise<ApiResult<unknown>> }
  >();
  // ponytail: retain at most 64 owner workflow readers; snapshot terminal receipts if memory warrants it.
  const operations = new Map<string, NonNullable<SessionController['work']>>();
  const snapshot = () => {
    const { registry, appInstanceId } = current();
    return (
      registry.controllers
        .get(registry.snapshot().activeKey)
        ?.owner.snapshot() ?? {
        appInstanceId,
        document: null,
        sessionId: '',
        revision: 0,
        dirty: false,
      }
    );
  };
  const handle = (controller?: SessionController) => {
    const s = controller?.owner.snapshot();
    return s
      ? { appInstanceId: s.appInstanceId, sessionId: s.sessionId }
      : null;
  };
  const dispatch = async (
    tool: AutomationRequest['tool'],
    input: any,
  ): Promise<ApiResult<unknown>> => {
    const { appInstanceId, registry, workspace } = current();
    if (!appInstanceId)
      throw new EditorError(
        'APP_UNAVAILABLE',
        'Application identity is not ready',
      );
    if (
      (input.handle?.appInstanceId ?? input.appInstanceId ?? appInstanceId) !==
      appInstanceId
    )
      throw new EditorError('STALE_APP', 'Refresh state for the intended app');
    if (tool === 'depthplan_get_access')
      return boundedResult(snapshot(), {
        folders: await window.desktop.mcpFiles.folders(),
      });
    if (tool === 'depthplan_get_project') {
      const { offset, pageSize } = projectQuery.parse(input);
      const project = workspace.project;
      if (!project) return boundedResult(snapshot(), { project: null });
      const end = offset + pageSize;
      return boundedResult(snapshot(), {
        project: {
          handle: { appInstanceId, projectSessionId: project.sessionId },
          id: project.manifest.id,
          name: project.manifest.name,
          location: project.location,
          boards: project.manifest.boards.slice(offset, end).map((board) => {
            const controller = registry.controllers.get(
              workspace.key(board.id),
            );
            return {
              ...board,
              handle: handle(controller),
              status: registry.statuses[workspace.key(board.id)] ?? 'Closed',
            };
          }),
          total: project.manifest.boards.length,
          nextOffset: end < project.manifest.boards.length ? end : null,
          active: handle(
            registry.controllers.get(registry.snapshot().activeKey),
          ),
        },
      });
    }
    if (
      tool === 'depthplan_get_operation' ||
      tool === 'depthplan_cancel_operation' ||
      tool === 'depthplan_decide'
    ) {
      const work = operations.get(input.operationId);
      if (!work)
        throw new EditorError(
          'NOT_FOUND',
          'Operation receipt is unavailable or expired',
        );
      return tool === 'depthplan_get_operation'
        ? work.read(input)
        : tool === 'depthplan_cancel_operation'
          ? work.cancel(input)
          : work.decide(input);
    }
    if (workspace.busy || workspace.dialog)
      throw new EditorError(
        'BUSY',
        'Finish the project transition or dialog first',
      );
    if (tool === 'depthplan_open_board') {
      const args = projectOpen.parse(input),
        project = workspace.project;
      if (!project || args.handle.projectSessionId !== project.sessionId)
        throw new EditorError('STALE_SESSION', 'Refresh the project workspace');
      if (!project.manifest.boards.some((board) => board.id === args.boardId))
        throw new EditorError('NOT_FOUND', 'Board is not a project member');
      const lease = await window.desktop.mcpFiles.lease();
      try {
        let failure: unknown;
        const opened = await workspace.run(async () => {
          try {
            await window.desktop.mcpFiles.check(lease);
            if (
              current().workspace.project?.sessionId !==
              args.handle.projectSessionId
            )
              throw new EditorError(
                'STALE_SESSION',
                'Project changed before opening the board',
              );
            return await workspace.openBoard(args.boardId, lease);
          } catch (error) {
            failure = error;
            throw error;
          }
        });
        if (failure) throw failure;
        if (!opened)
          throw new EditorError(
            'BUSY',
            'Board could not open; inspect project diagnostics and retry',
          );
        return boundedResult(snapshot(), {
          handle: handle(registry.controllers.get(workspace.key(args.boardId))),
          boardId: args.boardId,
        });
      } finally {
        await window.desktop.mcpFiles.release(lease);
      }
    }
    const controller = input.handle
      ? [...registry.controllers.values()].find(
          (c) => c.owner.snapshot().sessionId === input.handle.sessionId,
        )
      : registry.controllers.get(registry.snapshot().activeKey);
    if (!controller)
      throw new EditorError(
        input.handle ? 'STALE_SESSION' : 'NO_DOCUMENT',
        'Open the intended board and refresh its session handle',
      );
    const handler = controller.handlers?.[tool];
    if (!handler)
      throw new EditorError('APP_UNAVAILABLE', 'Board handler is not ready');
    const result = (await handler(input)) as ApiResult<{
      operationId?: string;
    }>;
    if (result.ok && result.data?.operationId && controller.work) {
      operations.set(result.data.operationId, controller.work);
      if (operations.size > 64)
        operations.delete(operations.keys().next().value!);
    }
    return result;
  };
  return async (tool: AutomationRequest['tool'], raw: unknown) => {
    try {
      const input = mcpTools[tool].input.parse(raw) as any;
      if (!input.requestId) return await dispatch(tool, input);
      const key = JSON.stringify([input.handle, input.requestId]);
      const payload = JSON.stringify({ tool, input }),
        prior = requests.get(key);
      if (prior) {
        if (prior.payload !== payload)
          throw new EditorError(
            'REQUEST_ID_REUSED',
            'Use a new requestId for a new operation',
          );
        const result = await prior.result;
        return result.ok
          ? { ...result, data: { ...(result.data as object), replayed: true } }
          : result;
      }
      const result = dispatch(tool, input);
      requests.set(key, { payload, result });
      if (requests.size > 256) requests.delete(requests.keys().next().value!);
      try {
        const reply = await result;
        if (!reply.ok) requests.delete(key);
        return reply;
      } catch (error) {
        requests.delete(key);
        throw error;
      }
    } catch (error) {
      return unavailable(
        error instanceof EditorError ? error.code : 'INVALID_REQUEST',
        error instanceof Error ? error.message.slice(0, 512) : 'Request failed',
      );
    }
  };
}

export default function useWorkspaceAutomation(appInstanceId: string | null) {
  const registry = useDocumentSessions(),
    workspace = useProjectWorkspace()!;
  const current = useRef({ appInstanceId, registry, workspace });
  current.current = { appInstanceId, registry, workspace };
  const router = useRef<ReturnType<typeof workspaceRouter> | null>(null);
  router.current ??= workspaceRouter(() => current.current);
  return useAutomation(
    Object.fromEntries(
      Object.keys(mcpTools).map((tool) => [
        tool,
        (input: unknown) =>
          router.current!(tool as AutomationRequest['tool'], input),
      ]),
    ) as AutomationHandlers,
  );
}
