import type {
  CheckpointRequest,
  RecoveryWriter,
} from '../../shared/recoveryContract';
type Pending = {
  latest?: CheckpointRequest;
  seen: number;
  covered: number;
  closed: boolean;
  lastSuccess: number;
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>;
};
/** One in-flight write per session; accepted revisions replace the pending snapshot. */
export class RecoveryScheduler {
  private sessions = new Map<string, Pending>();
  constructor(
    private writer: RecoveryWriter,
    private status: (message: string) => void,
  ) {}
  update(request: CheckpointRequest) {
    let state = this.sessions.get(request.sessionId);
    if (!state) {
      state = { seen: -1, covered: -1, closed: false, lastSuccess: Date.now() };
      this.sessions.set(request.sessionId, state);
    }
    if (state.closed || request.revision <= Math.max(state.seen, state.covered))
      return;
    state.seen = request.revision;
    state.latest = request;
    this.schedule(state);
  }
  private schedule(state: Pending) {
    clearTimeout(state.timer);
    if (state.closed || state.running || !state.latest) return;
    state.timer = setTimeout(
      () => {
        void this.write(state);
      },
      Math.max(0, Math.min(1000, state.lastSuccess + 5000 - Date.now())),
    );
  }
  private async write(state: Pending) {
    const request = state.latest;
    if (!request || state.closed) return;
    state.latest = undefined;
    const slow = setTimeout(
      () =>
        this.status(
          'Recovery is delayed. Save your document to protect recent edits.',
        ),
      5000,
    );
    state.running = (async () => {
      try {
        await this.writer.write(request);
        state.lastSuccess = Date.now();
        this.status('');
      } catch (error) {
        this.status(
          `Recovery unavailable: ${error instanceof Error ? error.message : String(error)}. Save your document and check available disk space.`,
        );
        if (!state.latest && !state.closed && request.revision > state.covered)
          state.latest = request;
        // Failed storage retries after idle, not a zero-delay loop past the deadline.
        state.lastSuccess = Date.now();
      } finally {
        clearTimeout(slow);
      }
    })();
    await state.running;
    state.running = undefined;
    this.schedule(state);
  }
  async remove(sessionId: string, throughRevision?: number) {
    const state = this.sessions.get(sessionId);
    const wasClosed = state?.closed,
      latest = state?.latest;
    if (state) {
      if (throughRevision === undefined) state.closed = true;
      else state.covered = Math.max(state.covered, throughRevision);
      if (
        state.closed ||
        (state.latest && state.latest.revision <= state.covered)
      )
        state.latest = undefined;
      clearTimeout(state.timer);
      await state.running;
    }
    try {
      await this.writer.remove(sessionId, throughRevision);
    } catch (error) {
      if (state) {
        state.closed = !!wasClosed;
        if (!state.latest) state.latest = latest;
        this.schedule(state);
      }
      throw error;
    }
    if (state) this.schedule(state);
  }
  dispose() {
    for (const state of this.sessions.values()) {
      state.closed = true;
      clearTimeout(state.timer);
    }
  }
}
