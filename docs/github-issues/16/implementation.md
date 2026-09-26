# Issue #16 — project persistence and recovery

Each board owner schedules its accepted content after
one second idle or five seconds of continuous edits. Background writes keep
editing enabled; save acknowledgments update only their captured document. Save
All uses the same file controller, retains drafts and does not load unopened
boards. Failures persist and pause that board until explicit resolution.

Conflict actions provide retry, independent copy with fresh document identity,
guarded reload and native overwrite confirmation tied to the observed source and
manifest versions. Manifest reload guards removed/repathed sessions and keeps
unchanged sessions. Settings drafts remain available after reconciliation.

Closing flushes eligible accepted edits, then presents one review for remaining
work. Rows offer individual review/discard, retry and Save a copy. No checkpoint
or session is retired before every required decision succeeds; Keep open retains
the entire workspace. Draft handling reuses the existing Apply/Discard/Cancel
guard rather than accepting text implicitly.

Native recovery attaches trusted project ID, canonical location and board identity
to each session checkpoint, including when the project folder is unavailable.
Restoring preserves provenance in subsequent checkpoints and requires the existing
safe source confirmation or independent destination. Drafts and undo are not
claimed as crash recoverable.

Visual direction inherits FormDialog and existing project navigation. The new
conflict and aggregate-close dialogs use named board rows and explicit actions;
compact layouts scroll fields while retaining the footer.

Validation: 499 tests across 62 Jest suites, 30 native tests, typecheck and lint
pass. The native two-board journey passes autosave, external conflict, independent
copy, explicit overwrite cancel/accept, manifest reconciliation, policy-off
checkpoints, forced termination, two-board recovery discovery and safe recovered
Save As. Captures at 1440×1000, 1024×728 and 900×640 are in the local
`depthplan-tauri-smoke-BHuWRz` evidence directory. Hosted checks remain the epic's
final gate.

Correctness review also fixed automation generation initialization when the
active owner changes; a stale status snapshot cannot revive revoked or disposed
listeners. Standalone MCP replacement/file workflows reject project owners until
the explicit project routing in #18, preventing recovery from acquiring automatic
project source authority through an unrelated session.

Ponytail review removed the duplicated home/fallback loop by reusing `openHome`;
net 15 lines removed. No added dependencies or speculative persistence layers.
The fresh Impeccable finish reviewer returned **ship** for all six supplied
conflict/close captures with no material fixes. The incumbent visual system is
preserved.
