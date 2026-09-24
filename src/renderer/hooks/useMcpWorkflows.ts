import { useEffect, useRef, useState, type RefObject } from 'react';
import type { z } from 'zod';
import type useDocumentState from './useDocumentState';
import type useDocumentFiles from './useDocumentFiles';
import type useDocumentTransitions from './useDocumentTransitions';
import type { TransitionAccess } from './useDocumentTransitions';
import type { RecursiveExportHandle } from '../components/RecursiveExport';
import type {
  RecoveryCandidate,
  RecoveryEntry,
} from '../../shared/recoveryContract';
import {
  fileInput,
  exportInput,
  operationReadInput,
  operationCancelInput,
  decisionInput,
  recoveryInput,
  fileTools,
  type FileLease,
} from '../../shared/mcpFileContract';
import {
  boundedResult,
  checkHandle,
  editorFailure,
  editorStamp,
  EditorError,
} from '../../shared/editorQueries';
type Context = {
  owner: ReturnType<typeof useDocumentState>;
  files: ReturnType<typeof useDocumentFiles>;
  transitions: ReturnType<typeof useDocumentTransitions>;
  exportRef: RefObject<RecursiveExportHandle | null>;
  hasDrafts: () => boolean;
  onStatus: (message: string) => void;
};
type Decision = {
  id: string;
  kind: string;
  label: string;
  choices: string[];
  state: { sessionId: string; revision: number; viewRevision: number };
};
type Reply = z.infer<typeof decisionInput>;
type Operation = {
  id: string;
  kind: string;
  status: 'running' | 'needs-decision' | 'completed' | 'canceled' | 'failed';
  cancelRequested: boolean;
  lease?: FileLease;
  decision?: Decision;
  detail?: unknown;
  reply?: (value: Reply | null) => void;
  result?: unknown;
  error?: string;
};
const summary = ({
  reply: _reply,
  detail: _detail,
  lease: _lease,
  ...operation
}: Operation) => operation;

function workflows(current: () => Context, changed: () => void) {
  const operations = new Map<string, Operation>();
  const requests = new Map<string, { payload: string; id: string }>();
  let active: Operation | null = null;
  let recoveryVersion = 0;
  const snapshot = () => current().owner.snapshot();
  const permit = (op: Operation) => !op.cancelRequested;
  const cancel = (op: Operation) => {
    if (!['running', 'needs-decision'].includes(op.status)) return;
    op.cancelRequested = true;
    if (op.lease)
      void window.desktop.mcpFiles.release(op.lease).catch(() => {});
    op.reply?.(null);
    changed();
  };
  const requirePermit = (op: Operation) => {
    if (!permit(op)) throw new Error('Operation canceled');
  };
  const decision = async (
    op: Operation,
    kind: string,
    label: string,
    choices: string[],
    detail?: unknown,
  ) => {
    requirePermit(op);
    const s = snapshot();
    op.status = 'needs-decision';
    op.decision = {
      id: crypto.randomUUID(),
      kind,
      label,
      choices,
      state: {
        sessionId: s.sessionId,
        revision: s.revision,
        viewRevision: s.viewRevision,
      },
    };
    op.detail = detail;
    const value = new Promise<Reply | null>((resolve) => {
      op.reply = resolve;
    });
    current().onStatus(`MCP ${kind}: awaiting a decision`);
    changed();
    const reply = await value;
    delete op.reply;
    delete op.decision;
    op.status = 'running';
    changed();
    if (!reply || reply.choice === 'cancel') {
      op.cancelRequested = true;
      return null;
    }
    return reply;
  };
  const execute = async (
    op: Operation,
    kind: 'files' | 'export' | 'recovery',
    input: unknown,
  ) => {
    const context = current(),
      captured = snapshot();
    const api = window.desktop.mcpFiles;
    const lease = (op.lease = await api.lease());
    requirePermit(op);
    if (editorStamp(snapshot()) !== editorStamp(captured))
      throw new Error('Document or view changed before the operation started');
    let savePath: string | undefined;
    const targetForWrite = async (path: string, expected?: string | null) => {
      let target = path;
      for (;;) {
        requirePermit(op);
        const observed = await api.inspect(target, lease);
        if (
          (expected === undefined && observed.fingerprint !== null) ||
          (expected !== undefined && observed.fingerprint !== expected)
        ) {
          const choice = await decision(
            op,
            'file conflict',
            `File ${observed.path} already exists or changed`,
            ['overwrite', 'save-as', 'cancel'],
            observed,
          );
          if (!choice) return null;
          if (choice.choice === 'save-as') {
            if (!choice.path)
              throw new Error('Save As requires an explicit path');
            target = choice.path;
            expected = undefined;
            continue;
          }
        }
        requirePermit(op);
        return observed;
      }
    };
    const access: TransitionAccess = {
      ignoreBusy: 'mcp-operation',
      permit: () => permit(op),
      confirm: async (kind, label, canApply) => {
        const reply = await decision(
          op,
          kind === 'document' ? 'unsaved changes' : 'draft',
          label,
          canApply ? ['save', 'discard', 'cancel'] : ['discard', 'cancel'],
        );
        if (reply?.path) savePath = reply.path;
        return reply && (reply.choice === 'save' || reply.choice === 'discard')
          ? reply.choice
          : 'cancel';
      },
      write: async (document, sourceId) => {
        const source = snapshot().source;
        let target = savePath ?? (sourceId ? source?.path : undefined);
        if (!target) {
          const reply = await decision(
            op,
            'save location',
            'Choose a path inside an approved folder',
            ['save-as', 'cancel'],
          );
          if (!reply) return { status: 'canceled' };
          target = reply.path;
        }
        if (!target) throw new Error('Saving requires an explicit path');
        const observed = await targetForWrite(
          target,
          sourceId && source?.path === target ? source.fingerprint : undefined,
        );
        if (!observed) return { status: 'canceled' };
        requirePermit(op);
        const result = await api.write({
          kind: 'save',
          data: document,
          path: observed.path,
          expected: observed.fingerprint,
          lease,
        });
        if (!result.source)
          throw new Error('Save did not return a source record');
        return { status: 'success', source: result.source };
      },
    };
    if (kind === 'files') {
      const { action } = fileInput.parse(input);
      if (action.type === 'save' || action.type === 'save_as') {
        savePath = action.path;
        const result = await context.files.save(
          action.type === 'save_as',
          access,
        );
        if (result.status === 'error') throw new Error(result.error);
        if (result.status !== 'success') return false;
        return { source: snapshot().source, savedRevision: captured.revision };
      }
      const path = action.type === 'open' ? action.path : captured.source?.path;
      if (action.type !== 'new') {
        if (!path) throw new Error('This document has no file to reload');
        access.read = async () => ({
          status: 'success',
          ...(await api.read(path, lease)),
        });
      }
      const accepted = await context.transitions.request(
        action.type,
        undefined,
        access,
      );
      if (!accepted && context.transitions.lastResult()?.status === 'error')
        throw new Error(context.transitions.lastResult()?.error);
      return accepted
        ? {
            handle: {
              appInstanceId: snapshot().appInstanceId,
              sessionId: snapshot().sessionId,
            },
            source: snapshot().source,
          }
        : false;
    }
    if (kind === 'export') {
      const args = exportInput.parse(input);
      if (!captured.document) throw new Error('No document is open');
      const observed = await targetForWrite(args.path);
      if (!observed) return false;
      let data: unknown = captured.document;
      if (args.format !== 'json') {
        const capture = context.exportRef.current?.capture;
        if (!capture) throw new Error('Canvas is not ready');
        data = await capture({
          stamp: editorStamp(captured),
          document: captured.document,
          selection: captured.canvas.selected,
          scope: args.scope,
          format: args.format,
          permit: () =>
            permit(op) && editorStamp(snapshot()) === editorStamp(captured),
        });
      }
      requirePermit(op);
      if (editorStamp(snapshot()) !== editorStamp(captured))
        throw new Error('Export view changed during capture');
      return api.write({
        kind: args.format,
        path: observed.path,
        expected: observed.fingerprint,
        data,
        lease,
      });
    }
    const args = recoveryInput.parse(input);
    if (args.action === 'discard') {
      await api.recovery('discard', args.id, lease);
      return { discarded: args.id };
    }
    const candidate = (await api.recovery(
      'prepare',
      args.id,
      lease,
    )) as RecoveryCandidate;
    let accepted = false;
    try {
      const reply = await decision(
        op,
        'recovery',
        'Review recovered work before replacing the current document',
        ['accept', 'cancel'],
        candidate,
      );
      if (!reply) return false;
      await api.check(lease);
      accepted = await context.transitions.request(
        'restore',
        () =>
          context.owner.replace(candidate.document, {
            dirty: true,
            source: candidate.source,
            sessionId: candidate.sessionId,
          }),
        access,
      );
      if (!accepted && context.transitions.lastResult()?.status === 'error')
        throw new Error(context.transitions.lastResult()?.error);
      return accepted
        ? { recovered: args.id, sessionId: snapshot().sessionId }
        : false;
    } finally {
      if (!accepted) await window.desktop.recovery.release(args.id);
    }
  };
  const start = (kind: 'files' | 'export' | 'recovery', input: unknown) => {
    const s = snapshot();
    try {
      const args = {
        files: fileInput,
        export: exportInput,
        recovery: recoveryInput,
      }[kind].parse(input);
      if (args.handle.appInstanceId !== s.appInstanceId)
        throw new EditorError(
          'STALE_APP',
          'Refresh state for the intended app',
        );
      const payload = JSON.stringify({ kind, args }),
        prior = requests.get(args.requestId);
      if (prior) {
        if (prior.payload !== payload)
          throw new EditorError(
            'REQUEST_ID_REUSED',
            'Use a new requestId for a new operation',
          );
        if (!operations.has(prior.id))
          throw new Error(
            'Operation receipt expired; reconcile current state before retrying',
          );
        return boundedResult(s, { operationId: prior.id, replayed: true });
      }
      checkHandle(s, args.handle);
      if (
        args.expectedRevision !== s.revision ||
        args.expectedViewRevision !== s.viewRevision
      )
        throw new EditorError(
          'STALE_REVISION',
          'Refresh document and view state before starting',
        );
      if (active || current().owner.isBusy() || current().hasDrafts())
        throw new EditorError(
          'BUSY',
          'Finish the active edit or operation first',
        );
      const op: Operation = {
        id: crypto.randomUUID(),
        kind,
        status: 'running',
        cancelRequested: false,
      };
      active = op;
      operations.set(op.id, op);
      requests.set(args.requestId, { payload, id: op.id });
      if (operations.size > 64)
        operations.delete(operations.keys().next().value!);
      if (requests.size > 256) requests.delete(requests.keys().next().value!);
      current().owner.setBusy('mcp-operation', true);
      changed();
      void execute(op, kind, args)
        .then((result) => {
          op.status = result === false ? 'canceled' : 'completed';
          if (kind === 'recovery' && result !== false) recoveryVersion++;
          if (result !== false) op.result = result;
        })
        .catch((error) => {
          op.status = op.cancelRequested ? 'canceled' : 'failed';
          op.error = (
            error instanceof Error ? error.message : String(error)
          ).slice(0, 512);
        })
        .finally(() => {
          if (op.lease)
            void window.desktop.mcpFiles.release(op.lease).catch(() => {});
          delete op.detail;
          delete op.reply;
          delete op.decision;
          active = null;
          current().owner.setBusy('mcp-operation', false);
          current().onStatus(
            `MCP ${kind} ${op.status}${op.error ? `: ${op.error}` : ''}`,
          );
          changed();
        });
      return boundedResult(s, { operationId: op.id, replayed: false });
    } catch (error) {
      return editorFailure(s, error);
    }
  };
  const operation = (appInstanceId: string, id: string) => {
    if (snapshot().appInstanceId !== appInstanceId)
      throw new EditorError('STALE_APP', 'Refresh current app state');
    const value = operations.get(id);
    if (!value)
      throw new EditorError(
        'NOT_FOUND',
        'Operation receipt is unavailable or expired',
      );
    return value;
  };
  return {
    start,
    recoveryVersion: () => recoveryVersion,
    active: () => active && summary(active),
    cancelActive: () => {
      if (active) cancel(active);
    },
    read: (input: unknown) => {
      try {
        const args = operationReadInput.parse(input),
          op = operation(args.appInstanceId, args.operationId);
        const detail =
          args.offset === undefined ? null : JSON.stringify(op.detail ?? null);
        if (detail && args.offset! > detail.length)
          throw new Error('Detail offset exceeds its length');
        const text = detail?.slice(args.offset!, args.offset! + args.length);
        const next = args.offset! + (text?.length ?? 0);
        return boundedResult(snapshot(), {
          ...summary(op),
          ...(detail
            ? {
                detailText: text,
                totalLength: detail.length,
                nextOffset: next < detail.length ? next : null,
              }
            : {}),
        });
      } catch (error) {
        return editorFailure(snapshot(), error);
      }
    },
    cancel: (input: unknown) => {
      try {
        const args = operationCancelInput.parse(input),
          op = operation(args.appInstanceId, args.operationId);
        cancel(op);
        return boundedResult(snapshot(), summary(op));
      } catch (error) {
        return editorFailure(snapshot(), error);
      }
    },
    decide: (input: unknown) => {
      const s = snapshot();
      try {
        const args = decisionInput.parse(input),
          op = operation(args.handle.appInstanceId, args.operationId);
        const payload = JSON.stringify({ kind: 'decision', args });
        const prior = requests.get(args.requestId);
        if (prior) {
          if (prior.payload !== payload)
            throw new EditorError(
              'REQUEST_ID_REUSED',
              'Use a new requestId for a new decision',
            );
          return boundedResult(s, {
            operationId: prior.id,
            accepted: true,
            replayed: true,
          });
        }
        checkHandle(s, args.handle);
        const d = op.decision;
        if (!d || d.id !== args.decisionId)
          throw new EditorError(
            'STALE_REVISION',
            'Decision changed; inspect the operation',
          );
        if (
          args.expectedRevision !== s.revision ||
          args.expectedViewRevision !== s.viewRevision ||
          d.state.revision !== s.revision ||
          d.state.viewRevision !== s.viewRevision ||
          d.state.sessionId !== s.sessionId
        ) {
          cancel(op);
          throw new EditorError(
            'STALE_REVISION',
            'State changed; this operation was canceled without replacing it',
          );
        }
        if (!d.choices.includes(args.choice))
          throw new Error('Choose one of the offered decisions');
        if (args.choice === 'save-as' && !args.path)
          throw new Error('Save As requires an explicit path');
        const reply = op.reply;
        delete op.reply;
        delete op.decision;
        requests.set(args.requestId, { payload, id: op.id });
        if (requests.size > 256) requests.delete(requests.keys().next().value!);
        reply?.(args);
        return boundedResult(s, { operationId: op.id, accepted: true });
      } catch (error) {
        return editorFailure(s, error);
      }
    },
    access: async () => {
      try {
        return boundedResult(snapshot(), {
          folders: await window.desktop.mcpFiles.folders(),
        });
      } catch (error) {
        return editorFailure(snapshot(), error);
      }
    },
    recovery: async (input: unknown) => {
      try {
        const args = fileTools.depthplan_get_recovery.input.parse(input),
          api = window.desktop.mcpFiles;
        const lease = await api.lease();
        let data: { entries: RecoveryEntry[]; warnings: string[] };
        try {
          data = (await api.recovery('list', null, lease)) as typeof data;
        } finally {
          await api.release(lease);
        }
        const end = args.offset + args.pageSize;
        return boundedResult(snapshot(), {
          entries: data.entries.slice(args.offset, end),
          warnings: data.warnings,
          nextOffset: end < data.entries.length ? end : null,
        });
      } catch (error) {
        return editorFailure(snapshot(), error);
      }
    },
  };
}

export default function useMcpWorkflows(context: Context) {
  const [, update] = useState(0);
  const current = useRef(context);
  current.current = context;
  const instance = useRef<ReturnType<typeof workflows> | null>(null);
  if (!instance.current)
    instance.current = workflows(
      () => current.current,
      () => update((value) => value + 1),
    );
  const api = instance.current;
  useEffect(() => {
    const remove = window.desktop.mcpFiles?.onRevoked(api.cancelActive);
    return () => {
      remove?.();
      api.cancelActive();
    };
  }, [api]);
  return { ...api, activeOperation: api.active() };
}
